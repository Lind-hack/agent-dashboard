import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./config";
import { listRepos } from "./github";
import { githubToken } from "./config";
import { agentIssues } from "./linear";
import { readBrainStatus } from "./brain";
import { failedUnits } from "./ops";
import { listJobs } from "./store";

// Everything waiting on Lind, newest first. "Seen" lives in data/seen.json, written by the web app
// (the runner never touches it), so opening an item clears it from the badge.

export type InboxItem = {
  key: string; // stable id for "seen"
  kind: "pr" | "agent-done" | "agent-failed" | "timer" | "codex-cloud";
  title: string;
  detail: string;
  href: string;
  external?: boolean;
  at: string;
  tone: "claude" | "codex" | "hermes" | "opencode" | "ok" | "bad" | "neutral";
};

const seenFile = () => path.join(DATA_DIR, "seen.json");

export function readSeen(): Record<string, string> {
  try {
    return JSON.parse(fs.readFileSync(seenFile(), "utf8")) ?? {};
  } catch {
    return {};
  }
}

export function markSeen(keys: string[]) {
  const seen = readSeen();
  const now = new Date().toISOString();
  for (const k of keys) seen[k] = now;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(`${seenFile()}.tmp`, JSON.stringify(seen));
  fs.renameSync(`${seenFile()}.tmp`, seenFile());
}

type PR = { number: number; title: string; html_url: string; updated_at: string; draft?: boolean; head?: { ref?: string } };

let prCache: { at: number; prs: (PR & { repo: string })[] } | null = null;

async function openPRs() {
  if (prCache && Date.now() - prCache.at < 60_000) return prCache.prs;
  const repos = await listRepos().catch(() => []);
  const all = await Promise.all(
    repos.map(async (r) => {
      const res = await fetch(`https://api.github.com/repos/${r.name}/pulls?state=open&per_page=30`, {
        headers: { Authorization: `Bearer ${githubToken()}`, Accept: "application/vnd.github+json" },
        cache: "no-store",
      }).catch(() => null);
      const prs = (await res?.json().catch(() => [])) as PR[];
      return Array.isArray(prs) ? prs.map((p) => ({ ...p, repo: r.name })) : [];
    }),
  );
  prCache = { at: Date.now(), prs: all.flat() };
  return prCache.prs;
}

export async function inboxItems(): Promise<InboxItem[]> {
  const items: InboxItem[] = [];

  for (const pr of await openPRs()) {
    items.push({
      key: `pr:${pr.repo}#${pr.number}:${pr.updated_at}`,
      kind: "pr",
      title: pr.title,
      detail: `${pr.repo.split("/")[1]} #${pr.number}${pr.draft ? " · draft" : ""} · waiting for your review`,
      href: pr.html_url,
      external: true,
      at: pr.updated_at,
      tone: "neutral",
    });
  }

  for (const job of listJobs()) {
    const last = job.turns.at(-1);
    if (!last?.endedAt || job.status === "closed" || job.status === "cancelled") continue;
    if (job.status === "failed") {
      items.push({
        key: `job:${job.id}:${last.endedAt}`,
        kind: "agent-failed",
        title: job.title,
        detail: `${job.agent} stopped with an error — ${(job.error ?? "").slice(0, 90)}`,
        href: `/jobs/${job.id}`,
        at: last.endedAt,
        tone: "bad",
      });
    } else if (job.status === "waiting") {
      items.push({
        key: `job:${job.id}:${last.endedAt}`,
        kind: "agent-done",
        title: job.title,
        detail: `${job.agent} finished a turn${job.prUrl ? " · PR open" : ""} — reply or archive`,
        href: `/jobs/${job.id}`,
        at: last.endedAt,
        tone: job.agent,
      });
    }
  }

  for (const u of await failedUnits().catch(() => [])) {
    const name = u.unit.replace(/\.service$/, "");
    items.push({
      // Keyed on when it failed: marking it done hides this failure, a new one shows again.
      key: `unit:${u.unit}:${u.at ?? "?"}`,
      kind: "timer",
      title: `${name} failed`,
      detail: u.description ? `${u.description} · VPS job` : "VPS job in failed state",
      href: "/website",
      at: u.at ?? new Date(0).toISOString(),
      tone: "bad",
    });
  }

  // A brain source failing twice in a row (plan §D5).
  for (const [name, s] of Object.entries(readBrainStatus().sources)) {
    if ((s.failures ?? 0) < 2) continue;
    items.push({
      key: `brain:${name}:${s.lastOk ?? "never"}`,
      kind: "timer",
      title: `Brain: ${name} keeps failing`,
      detail: (s.lastError ?? "").slice(0, 120),
      href: "/memory",
      at: s.lastRun ?? new Date(0).toISOString(),
      tone: "bad",
    });
  }

  for (const issue of await agentIssues("codex-cloud", 15).catch(() => [])) {
    if (issue.state?.type === "completed" || issue.state?.type === "canceled") continue;
    items.push({
      key: `codex:${issue.identifier}:${issue.updatedAt}`,
      kind: "codex-cloud",
      title: issue.title,
      detail: `Codex cloud · ${issue.state?.name ?? ""}`,
      href: `/codex/${issue.identifier}`,
      at: issue.updatedAt,
      tone: "codex",
    });
  }

  const seen = readSeen();
  return items.filter((i) => !seen[i.key]).sort((a, b) => b.at.localeCompare(a.at));
}

let countCache: { at: number; n: number } | null = null;

// For the nav badge on every page — cached briefly so navigation stays fast.
export async function inboxCount(): Promise<number> {
  if (countCache && Date.now() - countCache.at < 30_000) return countCache.n;
  const n = (await inboxItems().catch(() => [])).length;
  countCache = { at: Date.now(), n };
  return n;
}

export function invalidateInboxCount() {
  countCache = null;
}
