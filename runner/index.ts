import type { ChildProcess } from "node:child_process";
import { BOT_MARK, REPLY_PREFIX, REPOS, REPO_KEYS, type RepoKey } from "../lib/config";
import { agentIssues, comment, issueComments, moveToStateType, type LinearIssue } from "../lib/linear";
import { appendLog, drainInbox, listJobs, writeHeartbeat, writeJob, type Job, type Turn } from "../lib/store";
import { runClaude } from "./claude";
import { ensurePullRequest, ensureWorktree, pushBranch, removeWorktree } from "./git";

// The runner owns every job file: it polls Linear for `agent:claude` issues, runs one Claude
// turn at a time, pushes the branch, opens a PR and reports back on the issue.

const TICK_MS = 5_000;
const SYNC_MS = 30_000;

const jobs = new Map<string, Job>(listJobs().map((j) => [j.id, j]));
let active: { id: string; child?: ChildProcess } | null = null;
let lastSync = 0;
let forceSync = true;

const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);
const save = (job: Job) => {
  jobs.set(job.id, job);
  writeJob(job);
};

// Jobs that crashed mid-turn when the runner last stopped get their turn retried.
for (const job of jobs.values()) {
  if (job.status === "running") {
    const last = job.turns.pop();
    job.pending = last ? { prompt: last.prompt, source: last.source } : job.pending;
    job.status = "queued";
    save(job);
  }
}

function repoOf(issue: LinearIssue): RepoKey | null {
  const names = issue.labels?.nodes?.map((l) => l.name) ?? [];
  return REPO_KEYS.find((r) => names.includes(`repo:${r}`)) ?? null;
}

const branchFor = (id: string) => `agent/${id.toLowerCase()}`;

async function sync() {
  const issues = await agentIssues("claude", 50);
  for (const issue of issues) {
    const done = issue.state?.type === "completed" || issue.state?.type === "canceled";
    const job = jobs.get(issue.identifier);

    if (!job) {
      if (done) continue;
      const repo = repoOf(issue);
      const now = new Date().toISOString();
      const existing = await issueComments(issue.id).catch(() => []);
      const fresh: Job = {
        id: issue.identifier,
        issueId: issue.id,
        issueUrl: issue.url,
        title: issue.title,
        description: issue.description ?? "",
        repo: repo ?? "383",
        branch: branchFor(issue.identifier),
        status: repo ? "queued" : "failed",
        pending: repo ? { prompt: "", source: "linear" } : undefined,
        turns: [],
        seenCommentIds: existing.map((c) => c.id),
        createdAt: now,
        updatedAt: now,
        error: repo ? undefined : `No repo label. Add one of: ${REPO_KEYS.map((r) => `repo:${r}`).join(", ")}`,
      };
      save(fresh);
      log("new job", fresh.id, fresh.status);
      if (!repo) await comment(issue.id, `${BOT_MARK} ${fresh.error}`).catch(() => {});
      continue;
    }

    if (done && job.status !== "closed" && active?.id !== job.id) {
      job.status = "closed";
      job.pending = undefined;
      save(job);
      await removeWorktree(job.repo, job.id).catch((e) => log("worktree cleanup", job.id, e.message));
      continue;
    }

    // A failed "no repo label" job starts once the label is added.
    if (job.status === "failed" && !job.turns.length && repoOf(issue)) {
      job.repo = repoOf(issue)!;
      job.status = "queued";
      job.error = undefined;
      job.pending = { prompt: "", source: "linear" };
      save(job);
    }

    // Linear comments starting with "@claude" continue the session.
    if ((job.status === "waiting" || job.status === "failed") && !job.pending && job.turns.length) {
      const comments = await issueComments(job.issueId).catch(() => []);
      const unseen = comments.filter((c) => !job.seenCommentIds.includes(c.id));
      if (!unseen.length) continue;
      job.seenCommentIds.push(...unseen.map((c) => c.id));
      const reply = unseen
        .filter((c) => !c.body.startsWith(BOT_MARK) && c.body.trim().toLowerCase().startsWith(REPLY_PREFIX))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .map((c) => c.body.trim().slice(REPLY_PREFIX.length).trim())
        .join("\n\n");
      if (reply) {
        job.pending = { prompt: reply, source: "linear-comment" };
        job.status = "queued";
      }
      save(job);
    }
  }
}

function handleInbox() {
  for (const item of drainInbox()) {
    if (item.kind === "sync") {
      forceSync = true;
      continue;
    }
    const job = jobs.get(item.jobId);
    if (!job) continue;
    if (item.kind === "cancel") {
      if (active?.id === job.id) active.child?.kill("SIGTERM");
      job.pending = undefined;
      job.status = "cancelled";
      save(job);
      appendLog(job.id, { kind: "error", text: "Cancelled from the dashboard" });
    }
    if (item.kind === "reply" && item.prompt.trim()) {
      // A reply to a running turn waits until that turn ends.
      job.pending = {
        prompt: [job.pending?.prompt, item.prompt.trim()].filter(Boolean).join("\n\n"),
        source: "dashboard",
      };
      if (active?.id !== job.id) job.status = "queued";
      save(job);
    }
  }
}

function firstPrompt(job: Job): string {
  return `You are working unattended on Linear issue ${job.id}: "${job.title}".

${REPOS[job.repo].notes}

## Issue
${job.description || "(no description)"}

## How to work
- You are in a git worktree on branch \`${job.branch}\`, created from \`origin/${REPOS[job.repo].base}\`.
- Read the project's CLAUDE.md / AGENTS.md / README first and follow them.
- Make the change, run the relevant checks (typecheck, lint, tests) where the project has them.
- Commit your work with messages starting "${job.id}: ". Do not push, do not merge, do not deploy — the runner pushes the branch and opens the PR.
- Nobody can answer questions mid-run. If something is ambiguous, pick the safest reasonable option and say so.
- End with a short summary: what you changed, what you verified, anything left open.`;
}

async function runTurn(job: Job) {
  const turn: Turn = { ...job.pending!, startedAt: new Date().toISOString() };
  const isFirst = !job.sessionId;
  // No session yet (first turn, or the first one died before Claude started): send the full brief,
  // keeping any reply Lind added on top of it.
  if (isFirst) {
    const extra = turn.source !== "linear" && turn.prompt && !turn.prompt.startsWith("You are working unattended") ? turn.prompt : "";
    turn.prompt = firstPrompt(job) + (extra ? `\n\n## Additional instructions from Lind\n${extra}` : "");
  }
  job.pending = undefined;
  job.status = "running";
  job.error = undefined;
  job.turns.push(turn);
  save(job);
  active = { id: job.id };
  appendLog(job.id, { kind: "turn", text: turn.source === "linear" ? "Started from Linear" : `Reply (${turn.source}): ${turn.prompt}` });

  try {
    if (isFirst) {
      await comment(job.issueId, `${BOT_MARK} Claude picked this up on the VPS (branch \`${job.branch}\`).`).catch(() => {});
      await moveToStateType(job.issueId, "started").catch((e) => log("state", job.id, e.message));
    }
    const wt = await ensureWorktree(job.repo, job.id, job.branch);
    const res = await runClaude({
      cwd: wt,
      prompt: turn.prompt,
      resume: job.sessionId,
      onEvent: (e) => appendLog(job.id, e),
      onChild: (child) => {
        if (active) active.child = child;
      },
    });
    if (res.sessionId) job.sessionId = res.sessionId;
    Object.assign(turn, { endedAt: new Date().toISOString(), ok: res.ok, result: res.result, costUsd: res.costUsd });

    // A cancel during the run already set the status — keep it.
    if ((job.status as Job["status"]) === "cancelled") return;

    const pushed = await pushBranch(job.repo, wt, job.branch, job.id);
    if (pushed) {
      job.prUrl =
        (await ensurePullRequest(
          job.repo,
          job.branch,
          `${job.id}: ${job.title}`,
          `Linear: ${job.issueUrl}\n\n${res.result.slice(0, 6000)}\n\n_Opened by agent-dashboard runner._`,
        )) ?? job.prUrl;
    }
    job.status = res.ok ? "waiting" : "failed";
    if (!res.ok) job.error = res.result.slice(0, 500);

    const lines = [
      `${BOT_MARK} Claude ${res.ok ? "finished this turn" : "stopped with an error"}.`,
      "",
      res.result.slice(0, 3500),
      "",
      job.prUrl ? `PR: ${job.prUrl}` : pushed ? "" : "No code changes were pushed.",
      `Reply with a comment starting \`${REPLY_PREFIX}\` (or from the dashboard) to continue this session.`,
    ];
    await comment(job.issueId, lines.filter((l, i) => l || i === 1).join("\n")).catch((e) => log("comment", job.id, e.message));
    // Our own comment must not count as a new reply.
    const after = await issueComments(job.issueId).catch(() => []);
    job.seenCommentIds = after.map((c) => c.id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    Object.assign(turn, { endedAt: new Date().toISOString(), ok: false, result: msg });
    job.status = "failed";
    job.error = msg.slice(0, 500);
    appendLog(job.id, { kind: "error", text: msg });
    await comment(job.issueId, `${BOT_MARK} Runner error: ${msg.slice(0, 1000)}`).catch(() => {});
  } finally {
    active = null;
    // A reply that arrived mid-turn queues the next turn.
    // (cast: TS narrows status from the assignments above, but handleInbox can cancel mid-turn)
    if (job.pending && (job.status as Job["status"]) !== "cancelled") job.status = "queued";
    save(job);
  }
}

async function tick() {
  writeHeartbeat({ activeJob: active?.id });
  handleInbox();
  if (forceSync || Date.now() - lastSync > SYNC_MS) {
    forceSync = false;
    lastSync = Date.now();
    await sync().catch((e) => log("sync failed", e instanceof Error ? e.message : e));
  }
  if (active) return;
  const next = [...jobs.values()]
    .filter((j) => j.status === "queued" && j.pending)
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))[0];
  if (next) {
    log("run", next.id);
    // Not awaited: ticks keep draining the inbox (cancel, replies) while Claude works.
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
