import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DATA_DIR } from "./config";

// Plan usage for the two subscriptions, as each CLI last reported it:
// - Claude Code emits `rate_limit_event` in stream-json; the runner saves it to data/usage.json.
// - Codex writes `rate_limits` into its session rollout files (~/.codex/sessions/YYYY/MM/DD/*.jsonl).
// Both are account-wide, so a run on the VPS reflects usage from the PC too.

export type Window = { usedPct: number | null; resetsAt: number | null }; // resetsAt = unix seconds
export type PlanUsage = { fiveHour?: Window; week?: Window; status?: string; at?: string };

const usageFile = () => path.join(DATA_DIR, "usage.json");

// The CLI emits camelCase (rateLimitType, resetsAt); the SDK docs show snake_case. Accept both.
type ClaudeInfo = {
  status?: string;
  utilization?: number | null;
  rateLimitType?: string;
  rate_limit_type?: string;
  resetsAt?: number;
  resets_at?: number;
};

// Called by the runner for every rate_limit_event.
export function recordClaudeUsage(info: ClaudeInfo) {
  let all: Record<string, unknown> = {};
  try {
    all = JSON.parse(fs.readFileSync(usageFile(), "utf8")) ?? {};
  } catch {}
  const claude = ((all.claude as Record<string, unknown>) ?? {}) as Record<string, unknown>;
  const type = info?.rateLimitType ?? info?.rate_limit_type ?? "";
  const key = type === "five_hour" ? "fiveHour" : type.startsWith("seven_day") ? "week" : null;
  if (key) {
    claude[key] = {
      usedPct: typeof info.utilization === "number" ? Math.round(info.utilization * 100) : null,
      resetsAt: info.resetsAt ?? info.resets_at ?? null,
    };
  }
  claude.status = info?.status;
  claude.at = new Date().toISOString();
  all.claude = claude;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(`${usageFile()}.tmp`, JSON.stringify(all));
  fs.renameSync(`${usageFile()}.tmp`, usageFile());
}

function claudeUsage(): PlanUsage {
  try {
    const c = JSON.parse(fs.readFileSync(usageFile(), "utf8"))?.claude ?? {};
    // A window whose reset time has passed is back to zero.
    const fresh = (w?: Window) => (w?.resetsAt && w.resetsAt * 1000 < Date.now() ? { usedPct: 0, resetsAt: null } : w);
    return { fiveHour: fresh(c?.fiveHour), week: fresh(c?.week), status: c?.status, at: c?.at };
  } catch {
    return {};
  }
}

function newestFiles(dir: string, depth: number, n: number): string[] {
  try {
    const entries = fs.readdirSync(dir).sort().reverse();
    if (depth === 0) return entries.filter((f) => f.endsWith(".jsonl")).slice(0, n).map((f) => path.join(dir, f));
    const out: string[] = [];
    for (const e of entries) {
      out.push(...newestFiles(path.join(dir, e), depth - 1, n - out.length));
      if (out.length >= n) break;
    }
    return out;
  } catch {
    return [];
  }
}

function codexUsage(): PlanUsage {
  const home = process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex");
  for (const file of newestFiles(path.join(home, "sessions"), 3, 6)) {
    let lines: string[];
    try {
      lines = fs.readFileSync(file, "utf8").trim().split("\n");
    } catch {
      continue;
    }
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!lines[i].includes('"rate_limits"')) continue;
      try {
        const row = JSON.parse(lines[i]);
        const rl = row?.payload?.rate_limits ?? row?.rate_limits ?? row?.payload?.info?.rate_limits;
        if (!rl) continue;
        const win = (w: { used_percent?: number; resets_at?: number } | undefined): Window | undefined =>
          w ? { usedPct: typeof w.used_percent === "number" ? Math.round(w.used_percent) : null, resetsAt: w.resets_at ?? null } : undefined;
        const fresh = (w?: Window) => (w?.resetsAt && w.resetsAt * 1000 < Date.now() ? { usedPct: 0, resetsAt: null } : w);
        return {
          fiveHour: fresh(win(rl.primary)),
          week: fresh(win(rl.secondary)),
          at: row?.timestamp ?? fs.statSync(file).mtime.toISOString(),
        };
      } catch {
        // malformed line — keep looking
      }
    }
  }
  return {};
}

export function planUsage(): { claude: PlanUsage; codex: PlanUsage } {
  return { claude: claudeUsage(), codex: codexUsage() };
}
