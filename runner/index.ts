import type { ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { RELAY_STEPS, VPS_AGENTS } from "../lib/agents";
import { AGENT_LABELS, BOT_MARK, repoFromLabel, repoNotes, replyPrefix, DATA_DIR, WORK_DIR, type AgentKey } from "../lib/config";
import { repoBase } from "../lib/github";
import { agentIssues, comment, issueComments, moveToStateType, type LinearIssue } from "../lib/linear";
import { recordClaudeUsage } from "../lib/usage";
import { pendingImports, releaseReservation } from "../lib/handoff";
import { appendLog, claimInbox, listJobs, writeHeartbeat, writeJob, type Job, type NewChat, type Turn } from "../lib/store";
import { killTree, runAgent } from "./agents";
import { brainTick } from "./brain";
import { ensurePullRequest, ensureWorktree, publishBranch, pushBranch, removeWorktree } from "./git";
import { handoffPreamble, jobFromHandoff, prepareHandoff, writeExport, type ExportManifest } from "./handoff";

// The runner owns every job file. It polls Linear for `agent:claude` / `agent:codex` issues, takes
// untracked chats from the dashboard inbox, runs one turn per agent at a time, pushes the branch,
// opens a PR and (for Linear jobs) reports back on the issue.

// Exactly one runner may own the job files and schedules: a second one (a deploy overlap, a manual
// start) exits. A lock left by a dead process is taken over.
const LOCK = path.join(DATA_DIR, "runner.lock");
fs.mkdirSync(DATA_DIR, { recursive: true });
try {
  fs.writeFileSync(LOCK, String(process.pid), { flag: "wx" });
} catch {
  const pid = Number(fs.readFileSync(LOCK, "utf8"));
  let alive = false;
  try {
    if (pid && pid !== process.pid) process.kill(pid, 0);
    alive = !!pid && pid !== process.pid;
  } catch {
    /* gone */
  }
  if (alive) {
    console.error(`Another runner (pid ${pid}) is running — exiting.`);
    process.exit(1);
  }
  fs.writeFileSync(LOCK, String(process.pid));
}
const releaseLock = () => {
  try {
    if (Number(fs.readFileSync(LOCK, "utf8")) === process.pid) fs.rmSync(LOCK);
  } catch {
    /* already gone */
  }
};
process.on("exit", releaseLock);
for (const sig of ["SIGTERM", "SIGINT"] as const) process.on(sig, () => process.exit(0));

const TICK_MS = 3_000;
const SYNC_MS = 30_000;

const jobs = new Map<string, Job>(listJobs().map((j) => [j.id, j]));
const active = new Map<AgentKey, { id: string; child?: ChildProcess }>();
let lastSync = 0;
let forceSync = true;

const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);
const save = (job: Job) => {
  jobs.set(job.id, job);
  writeJob(job);
};
const isActive = (job: Job) => active.get(job.agent)?.id === job.id;

// Jobs that were mid-turn when the runner last stopped are not replayed (the agent may already have
// acted): they're marked interrupted and show up in the Inbox for Lind to resend.
for (const job of jobs.values()) {
  if (job.status === "running") {
    const last = job.turns.at(-1);
    if (last && !last.endedAt) Object.assign(last, { endedAt: new Date().toISOString(), ok: false, result: "Interrupted by a runner restart." });
    job.status = "failed";
    job.error = "Interrupted by a runner restart — send your message again to continue.";
    save(job);
  }
}

function repoOf(issue: LinearIssue) {
  for (const l of issue.labels?.nodes ?? []) {
    const repo = repoFromLabel(l.name);
    if (repo) return repo;
  }
  return null;
}

const branchFor = (id: string) => `agent/${id.toLowerCase()}`;

async function newLinearJob(issue: LinearIssue, agent: AgentKey) {
  const repo = repoOf(issue);
  const now = new Date().toISOString();
  const existing = await issueComments(issue.id).catch(() => []);
  const job: Job = {
    id: issue.identifier,
    agent,
    issueId: issue.id,
    issueUrl: issue.url,
    title: issue.title,
    description: issue.description ?? "",
    repo: repo ?? "",
    base: repo ? await repoBase(repo) : undefined,
    branch: branchFor(issue.identifier),
    status: repo ? "queued" : "failed",
    pending: repo ? { prompt: "", source: "linear" } : undefined,
    turns: [],
    seenCommentIds: existing.map((c) => c.id),
    createdAt: now,
    updatedAt: now,
    error: repo ? undefined : "No repo label. Add a label like repo:383lajme.",
  };
  save(job);
  log("new job", job.id, agent, job.status);
  if (!repo) await comment(issue.id, `${BOT_MARK} ${job.error}`).catch(() => {});
}

async function sync() {
  for (const agent of VPS_AGENTS) {
    for (const issue of await agentIssues(agent, 50)) {
      const done = issue.state?.type === "completed" || issue.state?.type === "canceled";
      const job = jobs.get(issue.identifier);

      if (!job) {
        if (!done) await newLinearJob(issue, agent);
        continue;
      }

      if (done && job.status !== "closed" && !isActive(job)) {
        job.status = "closed";
        job.pending = undefined;
        save(job);
        await removeWorktree(job.repo, job.id).catch((e) => log("worktree cleanup", job.id, e.message));
        continue;
      }

      // A "no repo label" job starts once the label is added.
      if (job.status === "failed" && !job.turns.length && repoOf(issue)) {
        job.repo = repoOf(issue)!;
        job.base = await repoBase(job.repo);
        job.status = "queued";
        job.error = undefined;
        job.pending = { prompt: "", source: "linear" };
        save(job);
      }

      // Linear comments starting with "@claude" / "@codex" continue the session.
      if ((job.status === "waiting" || job.status === "failed") && !job.pending && job.turns.length && job.issueId) {
        const comments = await issueComments(job.issueId).catch(() => []);
        const unseen = comments.filter((c) => !job.seenCommentIds.includes(c.id));
        if (!unseen.length) continue;
        job.seenCommentIds.push(...unseen.map((c) => c.id));
        const prefix = replyPrefix(job.agent);
        const reply = unseen
          .filter((c) => !c.body.startsWith(BOT_MARK) && c.body.trim().toLowerCase().startsWith(prefix))
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
          .map((c) => c.body.trim().slice(prefix.length).trim())
          .join("\n\n");
        if (reply) {
          job.pending = { prompt: reply, source: "linear-comment" };
          job.status = "queued";
        }
        save(job);
      }
    }
  }
}

async function createChat(chat: NewChat) {
  if (jobs.has(chat.id)) return;
  const now = new Date().toISOString();
  const job: Job = {
    id: chat.id,
    agent: chat.agent,
    title: chat.title,
    description: chat.prompt,
    repo: chat.repo,
    base: chat.repo ? await repoBase(chat.repo) : undefined,
    branch: chat.fromBranch ?? branchFor(chat.id),
    fromBranch: chat.fromBranch,
    group: chat.group,
    status: "queued",
    pending: { prompt: chat.prompt, source: chat.source },
    turns: [],
    seenCommentIds: [],
    createdAt: now,
    updatedAt: now,
  };
  save(job);
  log("new chat", job.id, job.agent, job.repo);
}

async function handleInbox() {
  for (const { item, ack } of claimInbox()) {
    if (item.kind === "sync") {
      forceSync = true;
      ack();
      continue;
    }
    if (item.kind === "create") {
      await createChat(item.chat).catch((e) => log("create chat", e instanceof Error ? e.message : e));
      ack();
      continue;
    }
    const job = jobs.get(item.jobId);
    if (!job) {
      ack();
      continue;
    }
    // Already applied before a crash (the event id is saved in the same write as its effect).
    if (item.eventId && job.seenEvents?.includes(item.eventId)) {
      ack();
      continue;
    }
    const seen = (j: Job) => {
      if (item.eventId) j.seenEvents = [...(j.seenEvents ?? []), item.eventId].slice(-200);
    };
    if (item.kind === "cancel") {
      if (isActive(job)) killTree(active.get(job.agent)?.child);
      job.pending = undefined;
      job.status = "cancelled";
      seen(job);
      save(job);
      appendLog(job.id, { kind: "error", text: "Stopped from the dashboard" });
    }
    if (item.kind === "archive" && !isActive(job) && job.status !== "preparing") {
      job.status = "closed";
      job.pending = undefined;
      seen(job);
      save(job);
      if (job.imported) releaseReservation(job.imported.sessionId, job.imported.generation);
      if (job.repo) await removeWorktree(job.repo, job.id).catch((e) => log("worktree cleanup", job.id, e.message));
    }
    if (item.kind === "return" && job.imported && job.owner === "vps" && job.status !== "closed" && job.status !== "preparing") {
      // Freeze: no new turns; the export is written once any running turn has ended (see exportReturns).
      job.owner = "returning";
      job.pending = undefined;
      job.imported.export = { status: "pending" };
      seen(job);
      save(job);
      appendLog(job.id, { kind: "turn", text: "Bringing this chat back to the PC — finishing up and packing it." });
    }
    if (item.kind === "keep" && job.owner === "returning") {
      job.owner = "vps";
      if (job.imported) job.imported.export = undefined;
      seen(job);
      save(job);
      appendLog(job.id, { kind: "turn", text: "Kept on the VPS — you can keep chatting here." });
    }
    if (item.kind === "complete" && job.owner === "returning" && job.imported?.export?.digest === item.digest) {
      job.owner = "pc";
      job.status = "closed";
      seen(job);
      save(job);
      releaseReservation(job.imported.sessionId, job.imported.generation);
      appendLog(job.id, { kind: "turn", text: "Back on the PC — continue there with claude --resume." });
      if (job.repo) await removeWorktree(job.repo, job.id).catch((e) => log("worktree cleanup", job.id, e.message));
    }
    if (item.kind === "reply" && item.prompt.trim() && job.owner && job.owner !== "vps") {
      appendLog(job.id, { kind: "error", text: job.owner === "pc" ? "This chat is back on the PC — continue it there." : "This chat is being returned to the PC. Tap “Keep on VPS” to continue here instead." });
      seen(job);
      save(job);
    } else if (item.kind === "reply" && item.prompt.trim()) {
      // A reply to a running turn waits until that turn ends; a hand-off still preparing gets it after.
      job.pending = {
        prompt: [job.pending?.prompt, item.prompt.trim()].filter(Boolean).join("\n\n"),
        source: "dashboard",
      };
      if (!isActive(job) && job.status !== "preparing") job.status = "queued";
      seen(job);
      save(job);
    }
    ack();
  }
}

// Hand-off v2: published uploads become jobs; their context is prepared in the background.
const preparing = new Set<string>();

function startPrepare(job: Job) {
  if (preparing.has(job.id)) return;
  preparing.add(job.id);
  const update = (patch: Partial<NonNullable<Job["imported"]>>, logText?: string) => {
    const j = jobs.get(job.id)!;
    j.imported = { ...j.imported!, ...patch };
    save(j);
    if (logText) appendLog(j.id, { kind: "tool", text: logText });
  };
  appendLog(job.id, { kind: "turn", text: `Handed off from the PC — preparing context (${job.imported?.mode === "native" ? "live chat" : "summary"})` });
  void prepareHandoff(
    job,
    async () => {
      const j = jobs.get(job.id)!;
      const base = j.base ?? (j.base = await repoBase(j.repo));
      return ensureWorktree({ repo: j.repo, base, jobId: j.id, branch: j.branch, fromSha: j.fromSha, fetchRef: j.fetchRef });
    },
    update,
  )
    .catch((e) => {
      const msg = e instanceof Error ? e.message : String(e);
      log("handoff prepare", job.id, msg);
      update({ dossier: "failed", dossierError: msg }, `Preparing failed: ${msg}`);
    })
    .finally(() => {
      preparing.delete(job.id);
      const j = jobs.get(job.id)!;
      j.status = j.pending ? "queued" : "waiting";
      save(j);
    });
}

async function importHandoffs() {
  for (const { dir, meta } of pendingImports()) {
    const existing = [...jobs.values()].find((j) => j.imported?.generation === meta.generation && j.imported.sessionId === meta.sessionId);
    if (!existing) {
      const base = meta.repo ? await repoBase(meta.repo).catch(() => undefined) : undefined;
      const job = jobFromHandoff(meta, base);
      save(job);
      log("handoff imported", job.id, meta.agent, meta.repo ?? "(no repo)", meta.mode);
      startPrepare(job);
    }
    // Written after the job exists, so a crash in between just re-finds the job above.
    fs.writeFileSync(path.join(dir, "imported.json"), JSON.stringify({ at: new Date().toISOString() }));
  }
}

// Take-back: a frozen chat with no turn running gets its branch pushed and its export written.
async function exportReturns() {
  for (const job of jobs.values()) {
    if (job.owner !== "returning" || job.imported?.export?.status !== "pending" || isActive(job)) continue;
    try {
      let code: ExportManifest["code"];
      if (job.repo && job.imported.contextDir) {
        const wt = path.dirname(job.imported.contextDir);
        const sha = await publishBranch(wt, job.branch, job.id);
        code = { repo: job.repo, ref: `refs/heads/${job.branch}`, sha, snapshotSha: job.imported.snapshot?.sha };
      }
      const digest = writeExport(job, code);
      job.imported.export = { status: "ready", at: new Date().toISOString(), digest };
      appendLog(job.id, { kind: "tool", text: `Packed for the PC${code ? ` · ${job.branch} @ ${code.sha.slice(0, 7)}` : ""} — run /takeback on the PC.` });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      job.imported.export = { status: "failed", error: msg };
      appendLog(job.id, { kind: "error", text: `Couldn't pack the chat for the PC: ${msg}` });
    }
    save(job);
  }
}

// A restart mid-preparation picks it up again.
for (const job of jobs.values()) if (job.status === "preparing") startPrepare(job);

// Extra instructions for each relay step (plan → build → review on one branch).
function relayNote(job: Job): string {
  const g = job.group;
  if (g?.kind !== "relay") return "";
  const n = g.steps.length;
  const next = g.steps[g.step + 1] ? AGENT_LABELS[g.steps[g.step + 1]] : "";
  if (g.step === 0) {
    return [
      "",
      `## Relay step 1 of ${n}: ${RELAY_STEPS[0]}`,
      "Plan only: do not edit files or commit. Read the code, then write a numbered implementation plan: files to touch, the change in each, risks, and how to verify.",
      next ? `${next} builds from your plan next.` : "",
    ].join("\n");
  }
  if (g.step === 1) {
    return ["", `## Relay step 2 of ${n}: ${RELAY_STEPS[1]}`, "Implement the task following the plan above.", next ? `${next} reviews your branch next.` : ""].join("\n");
  }
  return [
    "",
    `## Relay step 3 of ${n}: ${RELAY_STEPS[2]}`,
    `Review the changes on this branch against the task: run \`git diff origin/${job.base}...HEAD\`.`,
    "Fix real problems (bugs, missed requirements, broken checks) and commit the fixes; don't rewrite working code for taste.",
    "End with a short review: what you checked, what you fixed, what's still open.",
  ].join("\n");
}

function brief(job: Job): string {
  // Hermes has its own memory, skills and workspace; it just gets the message.
  if (job.agent === "hermes") return job.description;
  const where = job.fromBranch
    ? `a git worktree on branch \`${job.branch}\`, which continues work handed off from Lind's PC`
    : `a git worktree on branch \`${job.branch}\`, created from \`origin/${job.base}\``;
  const head = job.issueId ? `You are working unattended on Linear issue ${job.id}: "${job.title}".` : `You are working unattended on: "${job.title}".`;
  return `${head}

Repository: ${job.repo}. ${repoNotes(job.repo)}

## Task
${job.description || "(no description)"}

## How to work
- You are in ${where}.
- Read the project's CLAUDE.md / AGENTS.md / README first and follow them.
- If this is a question rather than a change, just answer it — no commit needed.
- For changes: make them, run the relevant checks (typecheck, lint, tests) where the project has them, and commit with messages starting "${job.id}: ". Do not push, merge or deploy — the runner pushes the branch and opens the PR.
- Lind replies between turns, not during one. If something is ambiguous, pick the safest reasonable option and say so.
- End with a short summary: what you changed, what you verified, anything left open.${relayNote(job)}`;
}

// When a relay step finishes, start the next one: the build step gets the plan, the review step
// continues the build's branch.
async function continueRelay(job: Job, result: string, pushed: boolean) {
  const g = job.group;
  if (g?.kind !== "relay" || g.step + 1 >= g.steps.length) return;
  const next = g.step + 1;
  if (next === 2 && !pushed) {
    appendLog(job.id, { kind: "error", text: "Relay stopped: the build step pushed no changes, so there is nothing to review." });
    return;
  }
  const id = `${g.id}-${next + 1}`;
  const prompt =
    next === 1
      ? `${g.task}\n\n## Plan from ${AGENT_LABELS[job.agent]}\n${result}`
      : `${g.task}\n\n(Built by ${AGENT_LABELS[job.agent]} on branch ${job.branch}${job.prUrl ? `, PR ${job.prUrl}` : ""}.)`;
  await createChat({
    id,
    agent: g.steps[next],
    repo: job.repo,
    title: `${RELAY_STEPS[next]}: ${g.task.split("\n")[0].slice(0, 70)}`,
    prompt,
    fromBranch: next === 2 ? job.branch : undefined,
    source: "dashboard",
    group: { ...g, step: next },
  });
  appendLog(job.id, { kind: "tool", text: `Relay → ${RELAY_STEPS[next]} with ${AGENT_LABELS[g.steps[next]]} (${id})` });
}

async function runTurn(job: Job) {
  const agent = job.agent;
  const turn: Turn = { ...job.pending!, startedAt: new Date().toISOString() };
  const shown = turn.prompt;
  if (job.imported?.needsPreamble) {
    // First message after a PC hand-off: where the agent is now and where its context lives.
    turn.prompt = `${handoffPreamble(job)}\n\n## Lind's message\n${turn.prompt}`;
  } else if (!job.sessionId) {
    // No session yet (first turn, or the first one died before the agent started): send the full
    // brief. For a chat or hand-off, the opening message *is* the task, so it's already in the brief.
    const extra = turn.source === "dashboard" && job.turns.length ? turn.prompt : "";
    turn.prompt = brief(job) + (extra ? `\n\n## Additional instructions from Lind\n${extra}` : "");
  }
  job.pending = undefined;
  job.status = "running";
  job.error = undefined;
  job.turns.push(turn);
  save(job);
  active.set(agent, { id: job.id });
  appendLog(job.id, {
    kind: "turn",
    text:
      job.turns.length === 1 && !job.imported
        ? `Started (${[AGENT_LABELS[agent], job.repo, job.group?.kind === "relay" ? `relay ${RELAY_STEPS[job.group.step] ?? ""}` : ""].filter(Boolean).join(" · ")})`
        : `You: ${shown}`,
  });

  try {
    if (job.turns.length === 1 && job.issueId) {
      await comment(job.issueId, `${BOT_MARK} ${AGENT_LABELS[agent]} picked this up on the VPS (branch \`${job.branch}\`).`).catch(() => {});
      await moveToStateType(job.issueId, "started").catch((e) => log("state", job.id, e.message));
    }
    // Hermes works in its own container; every other agent gets a worktree of the repo.
    const usesRepo = agent !== "hermes" && !!job.repo;
    const base = usesRepo ? (job.base ?? (job.base = await repoBase(job.repo))) : "";
    const wt = usesRepo
      ? await ensureWorktree({ repo: job.repo, base, jobId: job.id, branch: job.branch, fromBranch: job.fromBranch, fromSha: job.fromSha, fetchRef: job.fetchRef })
      : job.imported?.contextDir
        ? path.dirname(job.imported.contextDir)
        : WORK_DIR;
    const res = await runAgent({
      agent,
      cwd: wt,
      prompt: turn.prompt,
      resume: job.sessionId,
      onEvent: (e) => (e.kind === "usage" ? recordClaudeUsage(e.info as never) : appendLog(job.id, e)),
      onChild: (child) => {
        const a = active.get(agent);
        if (a) a.child = child;
      },
    });
    if (res.sessionId) job.sessionId = res.sessionId;
    if (res.ok && job.imported) job.imported.needsPreamble = false;
    Object.assign(turn, { endedAt: new Date().toISOString(), ok: res.ok, result: res.result, costUsd: res.costUsd });

    // A stop during the run already set the status — keep it.
    if ((job.status as Job["status"]) === "cancelled") return;

    // Saving the work is separate from the turn's outcome: a push or PR failure is logged, never
    // allowed to replace what the agent said.
    let pushed = false;
    if (usesRepo) {
      try {
        pushed = await pushBranch(wt, base, job.branch, job.id);
      } catch (e) {
        appendLog(job.id, { kind: "error", text: `Couldn't push ${job.branch}: ${e instanceof Error ? e.message : e}` });
      }
    }
    if (pushed) {
      try {
        job.prUrl =
          (await ensurePullRequest({
            repo: job.repo,
            base,
            branch: job.branch,
            title: `${job.id}: ${job.title}`,
            body: `${job.issueUrl ? `Linear: ${job.issueUrl}\n\n` : ""}${res.result.slice(0, 6000)}\n\n_Opened by agent-dashboard (${AGENT_LABELS[agent]})._`,
          })) ?? job.prUrl;
      } catch (e) {
        appendLog(job.id, { kind: "error", text: `Pushed ${job.branch}, but couldn't open a PR: ${e instanceof Error ? e.message : e}` });
      }
      appendLog(job.id, { kind: "tool", text: `Pushed ${job.branch}${job.prUrl ? ` · ${job.prUrl}` : ""}` });
    }
    job.status = res.ok ? "waiting" : "failed";
    if (!res.ok) job.error = res.result.slice(0, 500);
    if (res.ok && job.turns.length === 1) await continueRelay(job, res.result, pushed).catch((e) => log("relay", job.id, e.message));

    if (job.issueId) {
      const lines = [
        `${BOT_MARK} ${AGENT_LABELS[agent]} ${res.ok ? "finished this turn" : "stopped with an error"}.`,
        "",
        res.result.slice(0, 3500),
        "",
        job.prUrl ? `PR: ${job.prUrl}` : pushed ? "" : "No code changes were pushed.",
        `Reply with a comment starting \`${replyPrefix(agent)}\` (or from the dashboard) to continue this session.`,
      ];
      await comment(job.issueId, lines.filter((l, i) => l || i === 1).join("\n")).catch((e) => log("comment", job.id, e.message));
      // Our own comment must not count as a new reply.
      const after = await issueComments(job.issueId).catch(() => []);
      job.seenCommentIds = after.map((c) => c.id);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    Object.assign(turn, { endedAt: new Date().toISOString(), ok: false, result: msg });
    job.status = "failed";
    job.error = msg.slice(0, 500);
    appendLog(job.id, { kind: "error", text: msg });
    if (job.issueId) await comment(job.issueId, `${BOT_MARK} Runner error: ${msg.slice(0, 1000)}`).catch(() => {});
  } finally {
    active.delete(agent);
    // A reply that arrived mid-turn queues the next turn.
    if (job.pending && (job.status as Job["status"]) !== "cancelled") job.status = "queued";
    save(job);
  }
}

async function tick() {
  writeHeartbeat({ active: [...active.values()].map((a) => a.id) });
  await handleInbox();
  await importHandoffs().catch((e) => log("handoff import", e instanceof Error ? e.message : e));
  await exportReturns().catch((e) => log("handoff export", e instanceof Error ? e.message : e));
  // The brain's weekly Luna pass uses Codex, so it takes Codex's slot like a chat turn would.
  brainTick({
    take: () => !active.has("codex") && !!active.set("codex", { id: "brain-weekly" }),
    release: () => {
      if (active.get("codex")?.id === "brain-weekly") active.delete("codex");
    },
  });
  if (forceSync || Date.now() - lastSync > SYNC_MS) {
    forceSync = false;
    lastSync = Date.now();
    await sync().catch((e) => log("sync failed", e instanceof Error ? e.message : e));
  }
  // One turn per agent at a time: Claude and Codex can work in parallel.
  for (const agent of VPS_AGENTS) {
    if (active.has(agent)) continue;
    const next = [...jobs.values()]
      .filter((j) => j.agent === agent && j.status === "queued" && j.pending)
      .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))[0];
    if (!next) continue;
    log("run", next.id, agent);
    active.set(agent, { id: next.id }); // claim before the async start so the next tick can't double-start
    // Not awaited: ticks keep draining the inbox (stop, replies) while the agent works.
    void runTurn(next).then(() => log("done", next.id, next.status));
  }
}

log("runner started,", jobs.size, "jobs on disk");
let ticking = false;
setInterval(async () => {
  if (ticking) return;
  ticking = true;
  try {
    await tick();
  } finally {
    ticking = false;
  }
}, TICK_MS);
