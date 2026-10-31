import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./config";

// Website monitoring (v4) for 383ks.com: the runner probes key URLs every 3 minutes and keeps 30 days
// of results, records each deploy, opens/closes incidents, runs PageSpeed Insights every 6 hours and an
// SEO check daily. The root timer (deploy/db-stats.sh) adds Supabase health. This file reads it all.

export const SITE = () => process.env.SITE_URL ?? "https://383ks.com";
export const PROBES: { key: string; path: string; label: string; expect?: RegExp }[] = [
  { key: "home", path: "/", label: "Home", expect: /<title>/i },
  { key: "articles", path: "/api/articles?limit=1", label: "Articles API", expect: /"items"/ },
  { key: "tregu", path: "/tregu", label: "Tregu", expect: /<title>/i },
  { key: "sitemap", path: "/sitemap.xml", label: "Sitemap", expect: /<urlset|<sitemapindex/i },
  { key: "robots", path: "/robots.txt", label: "robots.txt", expect: /user-agent/i },
  { key: "deploy", path: "/api/deployment-info", label: "Deploy info", expect: /commit_sha/ },
];

export type Probe = { at: string; key: string; status: number; ms: number; bytes: number; ok: boolean; error?: string };
export type Deploy = { at: string; sha: string; ref: string; source: string; environment: string; verified: boolean };
export type Incident = { id: string; key: string; startedAt: string; endedAt?: string; reason: string; failures: number };
export type Psi = { at: string; strategy: "mobile" | "desktop"; performance: number; seo: number; accessibility: number; bestPractices: number; lcp?: number; cls?: number; inp?: number; tbt?: number; fcp?: number; field?: { lcp?: string; cls?: string; inp?: string } ; error?: string };
export type SeoCheck = { at: string; checks: { name: string; ok: boolean; detail: string }[]; score: number; articlesToday?: number; latestAgeMin?: number };
export type DbStats = {
  at: string;
  db: {
    size_bytes?: number;
    connections?: number;
    active?: number;
    idle_in_tx?: number;
    max_connections?: number;
    long_queries?: { query: string; seconds: number; user: string }[];
    cache_hit?: number;
    tables?: { name: string; bytes: number; rows: number; dead: number }[];
    slow?: { query: string; calls: number; mean_ms: number; total_s: number }[];
    error?: string;
  };
  backup: { file: string; bytes: number; at: string } | null;
  backup_unit: string;
};

export const monitorDir = () => path.join(DATA_DIR, "monitor");
const day = (iso: string) => iso.slice(0, 10);
const probeFile = (d: string) => path.join(monitorDir(), `probes-${d}.ndjson`);

function readJSON<T>(name: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(path.join(monitorDir(), name), "utf8")) ?? fallback;
  } catch {
    return fallback;
  }
}
export function writeJSON(name: string, v: unknown) {
  fs.mkdirSync(monitorDir(), { recursive: true });
  const f = path.join(monitorDir(), name);
  fs.writeFileSync(`${f}.${process.pid}.tmp`, JSON.stringify(v));
  fs.renameSync(`${f}.${process.pid}.tmp`, f);
}

export function appendProbes(rows: Probe[]) {
  if (!rows.length) return;
  fs.mkdirSync(monitorDir(), { recursive: true });
  fs.appendFileSync(probeFile(day(rows[0].at)), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
}

export function readProbes(days = 1): Probe[] {
  const out: Probe[] = [];
  const now = Date.now();
  for (let i = days; i >= 0; i--) {
    const d = new Date(now - i * 86_400_000).toISOString().slice(0, 10);
    try {
      for (const line of fs.readFileSync(probeFile(d), "utf8").split("\n")) {
        if (!line) continue;
        try {
          out.push(JSON.parse(line));
        } catch {
          /* a torn line */
        }
      }
    } catch {
      /* no file that day */
    }
  }
  const since = new Date(now - days * 86_400_000).toISOString();
  return out.filter((p) => p.at >= since);
}

export function pruneProbes(keepDays = 30) {
  try {
    const cutoff = new Date(Date.now() - keepDays * 86_400_000).toISOString().slice(0, 10);
    for (const f of fs.readdirSync(monitorDir())) {
      const m = f.match(/^probes-(\d{4}-\d{2}-\d{2})\.ndjson$/);
      if (m && m[1] < cutoff) fs.rmSync(path.join(monitorDir(), f), { force: true });
    }
  } catch {
    /* nothing yet */
  }
}

export const readDeploys = () => readJSON<Deploy[]>("deploys.json", []);
export const readIncidents = () => readJSON<Incident[]>("incidents.json", []);
export const readPsi = () => readJSON<{ mobile?: Psi; desktop?: Psi; history: Psi[] }>("psi.json", { history: [] });
export const readSeo = () => readJSON<SeoCheck | null>("seo.json", null);
// Written by root (deploy/db-stats.sh) into its own folder, outside the agent-writable data dir.
export const readDb = (): DbStats | null => {
  try {
    return JSON.parse(fs.readFileSync(process.env.DB_STATS_FILE ?? "/var/lib/agent-dashboard-db/db.json", "utf8"));
  } catch {
    return null;
  }
};

export type ProbeSummary = { key: string; label: string; uptime24h: number | null; uptime7d: number | null; p50: number | null; p95: number | null; last?: Probe; spark: (number | null)[] };

const pct = (xs: number[], p: number) => (xs.length ? xs.slice().sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))] : null);

// Per probe: uptime (24 h / 7 d), latency percentiles over 24 h, and a 48-bucket sparkline (30 min each).
export function summarize(): { probes: ProbeSummary[]; overall24h: number | null; overall7d: number | null } {
  const week = readProbes(7);
  const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
  const probes = PROBES.map((p) => {
    const all = week.filter((x) => x.key === p.key);
    const today = all.filter((x) => x.at >= dayAgo);
    const up = (xs: Probe[]) => (xs.length ? Math.round((xs.filter((x) => x.ok).length / xs.length) * 10000) / 100 : null);
    const ms = today.filter((x) => x.ok).map((x) => x.ms);
    const start = Date.now() - 86_400_000;
    const spark = Array.from({ length: 48 }, (_, i) => {
      const lo = new Date(start + i * 1_800_000).toISOString();
      const hi = new Date(start + (i + 1) * 1_800_000).toISOString();
      const b = today.filter((x) => x.at >= lo && x.at < hi);
      if (!b.length) return null;
      return b.some((x) => !x.ok) ? -1 : Math.round(b.reduce((s, x) => s + x.ms, 0) / b.length);
    });
    return { key: p.key, label: p.label, uptime24h: up(today), uptime7d: up(all), p50: pct(ms, 50), p95: pct(ms, 95), last: all.at(-1), spark };
  });
  const avg = (k: "uptime24h" | "uptime7d") => {
    const xs = probes.map((p) => p[k]).filter((x): x is number => x !== null);
    return xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100 : null;
  };
  return { probes, overall24h: avg("uptime24h"), overall7d: avg("uptime7d") };
}
