import fs from "node:fs";
import path from "node:path";
import type { GroupKind } from "./agents";
import { DATA_DIR, repoFromLabel, type AgentKey, type RepoKey } from "./config";

// One JSON file per job plus an NDJSON log per job. Personal scale — no database needed.

// waiting = turn finished, a reply continues the session; closed = the Linear issue was completed or cancelled;
// preparing = a PC hand-off whose context (worktree, transcript, dossier) is still being set up.
export type JobStatus = "queued" | "running" | "waiting" | "failed" | "cancelled" | "closed" | "preparing";

// A chat handed off from the PC (hand-off v2). The raw transcript lives in handoffs/sessions/<sid>/<gen>/.
export type Imported = {
  sessionId: string;
  generation: string;
  mode: "native" | "summary"; // native = the PC session itself resumes; summary = a new session from the dossier
  pcCwd: string;
  pcTranscriptPath: string;
  pcProjectDir: string;
  snapshot?: { ref: string; sha: string; pcBranch?: string; boundary: string };
  contextDir?: string; // the .handoff/ folder beside the code
  dossier?: "building" | "ready" | "failed";
  dossierError?: string;
  needsPreamble: boolean;
  // Take-back: the runner freezes the chat, pushes the branch and writes an export the PC downloads.
  export?: { status: "pending" | "ready" | "failed"; at?: string; digest?: string; error?: string };
};

export type Turn = {
  prompt: string;
  skills?: string[]; // picked with "/" — invoked by the runner, never parsed out of the text
  source: "linear" | "dashboard" | "linear-comment" | "handoff";
  startedAt?: string;
  endedAt?: string;
  ok?: boolean;
  result?: string;
  costUsd?: number;
};

// Ask-all fans one prompt out to several agents; a relay chains plan → build → review.
export type JobGroup = { id: string; kind: GroupKind; step: number; steps: AgentKey[]; task: string };

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
  fromBranch?: string; // hand-off / relay review: continue an existing branch instead of starting from base
  group?: JobGroup;
  status: JobStatus;
  sessionId?: string;
  fromSha?: string; // hand-off: start the branch at this commit (fetched from fetchRef)
  fetchRef?: string;
  imported?: Imported;
  owner?: "vps" | "returning" | "pc"; // who may continue an imported chat
  seenEvents?: string[]; // inbox event ids already applied (crash-safe dedupe)
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
  skills?: string[];
  fromBranch?: string;
  source: "dashboard" | "handoff";
  group?: JobGroup;
};

export type InboxItem = (
  | { kind: "create"; chat: NewChat } // a chat not tracked in Linear
  | { kind: "reply"; jobId: string; prompt: string; skills?: string[] }
  | { kind: "cancel"; jobId: string }
  | { kind: "archive"; jobId: string } // a finished chat: close it and free its worktree
  | { kind: "return"; jobId: string } // take-back: freeze a hand-off and export it for the PC
  | { kind: "keep"; jobId: string } // undo a return that the PC hasn't completed
  | { kind: "complete"; jobId: string; digest: string } // the PC installed the export
  | { kind: "room-create"; room: { id: string; task: string; repo?: string; agents: AgentKey[] } } // a Roast room
  | { kind: "room-cancel"; roomId: string }
  | { kind: "sync" }
) & { eventId?: string }; // sync = poll Linear / look for new hand-offs now

const inboxDir = path.join(DATA_DIR, "inbox");
const claimedDir = path.join(inboxDir, "claimed");

export function pushInbox(item: InboxItem) {
  fs.mkdirSync(inboxDir, { recursive: true });
  const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`;
  fs.writeFileSync(path.join(inboxDir, `${name}.tmp`), JSON.stringify({ ...item, eventId: item.eventId ?? name.slice(0, -5) }));
  fs.renameSync(path.join(inboxDir, `${name}.tmp`), path.join(inboxDir, name));
}

// Claim, then acknowledge: items move to inbox/claimed/ and are deleted only after the runner has
// applied them, so a crash mid-way replays them on the next start (job.seenEvents stops doubles).
export function claimInbox(): { item: InboxItem; ack: () => void }[] {
  fs.mkdirSync(claimedDir, { recursive: true });
  for (const f of fs.readdirSync(inboxDir).filter((f) => f.endsWith(".json"))) {
    fs.renameSync(path.join(inboxDir, f), path.join(claimedDir, f));
  }
  const out: { item: InboxItem; ack: () => void }[] = [];
  for (const f of fs.readdirSync(claimedDir).filter((f) => f.endsWith(".json")).sort()) {
    const file = path.join(claimedDir, f);
    const ack = () => fs.rmSync(file, { force: true });
    try {
      out.push({ item: JSON.parse(fs.readFileSync(file, "utf8")), ack });
    } catch {
      ack(); // unreadable item — drop it rather than loop on it forever
    }
  }
  return out;
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
