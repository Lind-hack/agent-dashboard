import type { ChildProcess } from "node:child_process";
import { AGENT_LABELS, BOT_MARK, repoFromLabel, repoNotes, replyPrefix, type AgentKey } from "../lib/config";
import { repoBase } from "../lib/github";
import { agentIssues, comment, issueComments, moveToStateType, type LinearIssue } from "../lib/linear";
import { appendLog, drainInbox, listJobs, writeHeartbeat, writeJob, type Job, type NewChat, type Turn } from "../lib/store";
import { runAgent } from "./agents";
import { ensurePullRequest, ensureWorktree, pushBranch, removeWorktree } from "./git";

// The runner owns every job file. It polls Linear for `agent:claude` / `agent:codex` issues, takes
// untracked chats from the dashboard inbox, runs one turn per agent at a time, pushes the branch,
// opens a PR and (for Linear jobs) reports back on the issue.

const TICK_MS = 3_000;
const SYNC_MS = 30_000;
const VPS_AGENTS: AgentKey[] = ["claude", "codex"];

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

// Jobs that were mid-turn when the runner last stopped get that turn retried.
for (const job of jobs.values()) {
  if (job.status === "running") {
    const last = job.turns.pop();
    job.pending = last ? { prompt: last.prompt, source: last.source } : job.pending;
    job.status = "queued";
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
    base: await repoBase(chat.repo),
    branch: chat.fromBranch ?? branchFor(chat.id),
    fromBranch: chat.fromBranch,
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
  for (const item of drainInbox()) {
    if (item.kind === "sync") {
      forceSync = true;
      continue;
    }
    if (item.kind === "create") {
      await createChat(item.chat).catch((e) => log("create chat", e instanceof Error ? e.message : e));
      continue;
    }
    const job = jobs.get(item.jobId);
    if (!job) continue;
    if (item.kind === "cancel") {
      if (isActive(job)) active.get(job.agent)?.child?.kill("SIGTERM");
      job.pending = undefined;
      job.status = "cancelled";
      save(job);
      appendLog(job.id, { kind: "error", text: "Stopped from the dashboard" });
    }
    if (item.kind === "archive" && !isActive(job)) {
      job.status = "closed";
      job.pending = undefined;
      save(job);
      await removeWorktree(job.repo, job.id).catch((e) => log("worktree cleanup", job.id, e.message));
    }
    if (item.kind === "reply" && item.prompt.trim()) {
      // A reply to a running turn waits until that turn ends.
      job.pending = {
        prompt: [job.pending?.prompt, item.prompt.trim()].filter(Boolean).join("\n\n"),
        source: "dashboard",
      };
      if (!isActive(job)) job.status = "queued";
      save(job);
    }
  }
}

function brief(job: Job): string {
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
- End with a short summary: what you changed, what you verified, anything left open.`;
}

async function runTurn(job: Job) {
  const agent = job.agent;
  const turn: Turn = { ...job.pending!, startedAt: new Date().toISOString() };
  // No session yet (first turn, or the first one died before the agent started): send the full
  // brief. For a chat or hand-off, the opening message *is* the task, so it's already in the brief.
  if (!job.sessionId) {
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
    text: job.turns.length === 1 ? `Started (${AGENT_LABELS[agent]} · ${job.repo})` : `You: ${turn.prompt}`,
  });

  try {
    if (job.turns.length === 1 && job.issueId) {
      await comment(job.issueId, `${BOT_MARK} ${AGENT_LABELS[agent]} picked this up on the VPS (branch \`${job.branch}\`).`).catch(() => {});
      await moveToStateType(job.issueId, "started").catch((e) => log("state", job.id, e.message));
    }
    const base = job.base ?? (job.base = await repoBase(job.repo));
    const wt = await ensureWorktree({ repo: job.repo, base, jobId: job.id, branch: job.branch, fromBranch: job.fromBranch });
    const res = await runAgent({
      agent,
      cwd: wt,
      prompt: turn.prompt,
      resume: job.sessionId,
      onEvent: (e) => appendLog(job.id, e),
      onChild: (child) => {
        const a = active.get(agent);
        if (a) a.child = child;
      },
    });
    if (res.sessionId) job.sessionId = res.sessionId;
    Object.assign(turn, { endedAt: new Date().toISOString(), ok: res.ok, result: res.result, costUsd: res.costUsd });

    // A stop during the run already set the status — keep it.
    if ((job.status as Job["status"]) === "cancelled") return;

    const pushed = await pushBranch(wt, base, job.branch, job.id);
    if (pushed) {
      job.prUrl =
        (await ensurePullRequest({
          repo: job.repo,
          base,
          branch: job.branch,
          title: `${job.id}: ${job.title}`,
          body: `${job.issueUrl ? `Linear: ${job.issueUrl}\n\n` : ""}${res.result.slice(0, 6000)}\n\n_Opened by agent-dashboard (${AGENT_LABELS[agent]})._`,
        })) ?? job.prUrl;
      appendLog(job.id, { kind: "tool", text: `Pushed ${job.branch}${job.prUrl ? ` · ${job.prUrl}` : ""}` });
    }
    job.status = res.ok ? "waiting" : "failed";
    if (!res.ok) job.error = res.result.slice(0, 500);

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
