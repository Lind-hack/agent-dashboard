import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, repoFromLabel, type AgentKey, type RepoKey } from "./config";

// One JSON file per job plus an NDJSON log per job. Personal scale — no database needed.

// waiting = turn finished, a reply continues the session; closed = the Linear issue was completed or cancelled.
export type JobStatus = "queued" | "running" | "waiting" | "failed" | "cancelled" | "closed";

export type Turn = {
  prompt: string;
  source: "linear" | "dashboard" | "linear-comment" | "handoff";
  startedAt?: string;
  endedAt?: string;
  ok?: boolean;
  result?: string;
  costUsd?: number;
};

export type Job = {
  id: string; // Linear identifier (LIN-42), or C-xxxx for a chat that isn't tracked in Linear
  agent: AgentKey;
  issueId?: string;
  issueUrl?: string;
  title: string;
  description: string;
  repo: RepoKey; // GitHub full name
  base?: string; // branch the work starts from / the PR targets
  branch: string;
  fromBranch?: string; // hand-off: continue an existing branch instead of starting from base
  status: JobStatus;
  sessionId?: string;
  prUrl?: string;
  pending?: Turn; // next turn waiting for the runner
  turns: Turn[];
  seenCommentIds: string[];
  createdAt: string;
  updatedAt: string;
  error?: string;
};

const jobsDir = path.join(DATA_DIR, "jobs");
const logsDir = path.join(DATA_DIR, "logs");

function ensureDirs() {
  fs.mkdirSync(jobsDir, { recursive: true });
  fs.mkdirSync(logsDir, { recursive: true });
}

const jobFile = (id: string) => path.join(jobsDir, `${id.replace(/[^A-Za-z0-9-]/g, "")}.json`);
export const logFile = (id: string) => path.join(logsDir, `${id.replace(/[^A-Za-z0-9-]/g, "")}.ndjson`);

export function readJob(id: string): Job | null {
  try {
    const raw = JSON.parse(fs.readFileSync(jobFile(id), "utf8")) as Partial<Job>;
    // Files may predate the current shape — fill what's missing.
    const repo = raw?.repo ?? "";
    return {
      ...(raw as Job),
      agent: raw?.agent ?? "claude",
      // Early jobs stored "383" / "agent-dashboard" instead of the GitHub full name.
      repo: repo.includes("/") ? repo : (repoFromLabel(`repo:${repo}`) ?? repo),
      turns: raw?.turns ?? [],
      seenCommentIds: raw?.seenCommentIds ?? [],
    };
  } catch {
    return null;
  }
}

export function writeJob(job: Job) {
  ensureDirs();
  job.updatedAt = new Date().toISOString();
  const file = jobFile(job.id);
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(job, null, 2));
  fs.renameSync(`${file}.tmp`, file);
}

export function listJobs(): Job[] {
  ensureDirs();
  return fs
    .readdirSync(jobsDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => readJob(f.slice(0, -5)))
    .filter((j): j is Job => j !== null)
    .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
}

export function appendLog(id: string, event: unknown) {
  ensureDirs();
  fs.appendFileSync(logFile(id), JSON.stringify({ t: new Date().toISOString(), ...(event as object) }) + "\n");
}

export function readLog(id: string, maxLines = 400): Record<string, unknown>[] {
  try {
    const lines = fs.readFileSync(logFile(id), "utf8").trim().split("\n");
    return lines.slice(-maxLines).flatMap((l) => {
      try {
        return [JSON.parse(l)];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}

// Only the runner writes job files. The web app drops requests into an inbox the runner drains,
// so a reply sent mid-run can't be overwritten by the runner's next save.
export type NewChat = {
  id: string;
  agent: AgentKey;
  repo: RepoKey;
  title: string;
  prompt: string;
  fromBranch?: string;
  source: "dashboard" | "handoff";
};

export type InboxItem =
  | { kind: "create"; chat: NewChat } // a chat not tracked in Linear
  | { kind: "reply"; jobId: string; prompt: string }
  | { kind: "cancel"; jobId: string }
  | { kind: "archive"; jobId: string } // a finished chat: close it and free its worktree
  | { kind: "sync" }; // a new issue was created from the dashboard — poll Linear now

const inboxDir = path.join(DATA_DIR, "inbox");

export function pushInbox(item: InboxItem) {
  fs.mkdirSync(inboxDir, { recursive: true });
  const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`;
  fs.writeFileSync(path.join(inboxDir, `${name}.tmp`), JSON.stringify(item));
  fs.renameSync(path.join(inboxDir, `${name}.tmp`), path.join(inboxDir, name));
}

export function drainInbox(): InboxItem[] {
  fs.mkdirSync(inboxDir, { recursive: true });
  const items: InboxItem[] = [];
  for (const f of fs.readdirSync(inboxDir).filter((f) => f.endsWith(".json")).sort()) {
    const file = path.join(inboxDir, f);
    try {
      items.push(JSON.parse(fs.readFileSync(file, "utf8")));
    } catch {
      // unreadable item — drop it rather than loop on it forever
    }
    fs.rmSync(file, { force: true });
  }
  return items;
}

// Runner liveness, shown on the dashboard.
const heartbeatFile = () => path.join(DATA_DIR, "runner-heartbeat.json");

export function writeHeartbeat(info: { active: string[] }) {
  ensureDirs();
  fs.writeFileSync(heartbeatFile(), JSON.stringify({ at: new Date().toISOString(), ...info }));
}

export function readHeartbeat(): { at?: string; active?: string[] } {
  try {
    return JSON.parse(fs.readFileSync(heartbeatFile(), "utf8")) ?? {};
  } catch {
    return {};
  }
}
