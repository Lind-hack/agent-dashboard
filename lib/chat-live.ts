import { repoShort } from "./config";
import { parseProgress, type LogLike } from "./progress";
import { listJobs, readLog } from "./store";

// The chats board (v5): every chat that's working or waiting on Lind, with where it is — its own step
// plan (PLAN / STEP / DONE), else the phase read from its latest tool calls — and its latest line.

export type LiveChat = {
  id: string;
  title: string;
  agent: string;
  repo: string;
  status: string;
  updatedAt: string;
  step: number | null;
  total: number | null;
  stepTitle: string | null;
  phase: string | null;
  steps: { n: number; title: string; status: "done" | "active" | "todo" }[];
  files: number;
  commands: number;
  startedAt?: string;
  last: string; // the newest thing it said or did, one line
  pr?: string;
};

const oneLine = (s: string) =>
  s
    .replace(/^\s*(STEP\s+\d+\s*\/\s*\d+\s*:.*|DONE\s+\d+|PLAN:.*)\s*$/gim, "")
    .replace(/[#*_`>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);

export function liveChats(): LiveChat[] {
  const dayAgo = new Date(Date.now() - 36 * 3600_000).toISOString();
  return listJobs()
    .filter((j) => ["running", "queued", "preparing"].includes(j.status) || ((j.status === "waiting" || j.status === "failed") && (j.updatedAt ?? "") >= dayAgo))
    .map((j) => {
      const log = readLog(j.id, 600) as LogLike[];
      const p = parseProgress(log);
      const lastText = [...log].reverse().find((e) => (e.kind === "text" || e.kind === "result" || e.kind === "tool" || e.kind === "error") && oneLine(e.text ?? ""));
      const active = p.steps.find((s) => s.status === "active");
      return {
        id: j.id,
        title: j.title,
        agent: j.agent,
        repo: repoShort(j.repo),
        status: j.status,
        updatedAt: j.updatedAt ?? j.createdAt,
        step: p.current,
        total: p.total,
        stepTitle: active?.title ?? null,
        phase: p.phase,
        steps: p.steps.map((s) => ({ n: s.n, title: s.title, status: s.status })),
        files: p.files.length,
        commands: p.commands,
        startedAt: p.startedAt,
        last: lastText ? `${lastText.kind === "tool" ? "→ " : ""}${oneLine(lastText.text ?? "")}` : "",
        pr: j.prUrl,
      };
    })
    .sort((a, z) => rank(a.status) - rank(z.status) || z.updatedAt.localeCompare(a.updatedAt));
}

const rank = (s: string) => (s === "running" ? 0 : s === "preparing" ? 1 : s === "queued" ? 2 : s === "waiting" ? 3 : 4);
