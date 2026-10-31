import fs from "node:fs";
import path from "node:path";
import { calendarConnected, gcal } from "../lib/calendar";
import { DATA_DIR } from "../lib/config";

// Extra memory sources (v5), synced by the runner once an hour into data/sources/ so the Memory page
// never waits on an API:
// - github.json:   PRs and issues (title, body, state) from Lind's 15 most recently pushed repos, 90 days.
//                  Commits already reach Memory as the brain's vault pages (wiki/sources/commits).
// - calendar.json: Google Calendar events from 60 days back to 14 ahead (what he actually spent time on).

const log = (...a: unknown[]) => console.log(new Date().toISOString(), "sources:", ...a);
const dir = () => path.join(DATA_DIR, "sources");
const EVERY = 60 * 60_000;
let lastRun = 0;
let running = false;

export type GithubItem = { id: string; kind: "pr" | "issue"; repo: string; number: number; title: string; body: string; state: string; url: string; at: string; author: string; labels: string[] };
export type CalendarItem = { id: string; title: string; start: string; end: string; allDay: boolean; location?: string; description?: string; calendar?: string; link?: string; planned: boolean };

function save(name: string, v: unknown) {
  fs.mkdirSync(dir(), { recursive: true });
  const f = path.join(dir(), name);
  fs.writeFileSync(`${f}.tmp`, JSON.stringify(v));
  fs.renameSync(`${f}.tmp`, f);
}

async function gh<T>(url: string): Promise<T | null> {
  const token = process.env.GITHUB_READ_TOKEN ?? process.env.GITHUB_TOKEN;
  if (!token) return null;
  const res = await fetch(`https://api.github.com${url}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" }, signal: AbortSignal.timeout(20_000) });
  return res.ok ? ((await res.json().catch(() => null)) as T | null) : null;
}

type GhIssue = { number: number; title: string; body?: string | null; state: string; html_url: string; updated_at: string; user?: { login?: string }; labels?: { name?: string }[]; pull_request?: unknown };

async function syncGithub() {
  const repos = await gh<{ full_name: string; pushed_at: string; archived: boolean }[]>("/user/repos?per_page=100&affiliation=owner,collaborator&sort=pushed");
  if (!repos) return;
  const since = new Date(Date.now() - 90 * 86_400_000).toISOString();
  const items: GithubItem[] = [];
  for (const r of repos.filter((x) => !x.archived && x.pushed_at >= since).slice(0, 15)) {
    const list = await gh<GhIssue[]>(`/repos/${r.full_name}/issues?state=all&since=${since}&per_page=100&sort=updated`);
    for (const i of list ?? []) {
      items.push({
        id: `${r.full_name}#${i.number}`,
        kind: i.pull_request ? "pr" : "issue",
        repo: r.full_name.split("/")[1] ?? r.full_name,
        number: i.number,
        title: i.title,
        body: (i.body ?? "").slice(0, 6000),
        state: i.state,
        url: i.html_url,
        at: i.updated_at,
        author: i.user?.login ?? "",
        labels: (i.labels ?? []).map((l) => l.name ?? "").filter(Boolean),
      });
    }
  }
  save("github.json", { at: new Date().toISOString(), items });
  log("github", items.length);
}

type GEvent = { id: string; summary?: string; description?: string; location?: string; htmlLink?: string; start?: { dateTime?: string; date?: string }; end?: { dateTime?: string; date?: string }; extendedProperties?: { private?: Record<string, string> } };

async function syncCalendar() {
  if (!calendarConnected()) return;
  const q = new URLSearchParams({ timeMin: new Date(Date.now() - 60 * 86_400_000).toISOString(), timeMax: new Date(Date.now() + 14 * 86_400_000).toISOString(), singleEvents: "true", orderBy: "startTime", maxResults: "2500" });
  const out = await gcal<{ items?: GEvent[] }>(`/calendars/primary/events?${q}`);
  const items: CalendarItem[] = (out.items ?? [])
    .filter((e) => e.summary)
    .map((e) => ({
      id: e.id,
      title: e.summary ?? "",
      start: e.start?.dateTime ?? e.start?.date ?? "",
      end: e.end?.dateTime ?? e.end?.date ?? "",
      allDay: !e.start?.dateTime,
      location: e.location,
      description: e.description?.slice(0, 2000),
      link: e.htmlLink,
      planned: !!e.extendedProperties?.private?.agentDashPlan,
    }));
  save("calendar.json", { at: new Date().toISOString(), items });
  log("calendar", items.length);
}

// Called every runner tick; does the work at most once an hour, in the background.
export function sourcesTick() {
  if (running || Date.now() - lastRun < EVERY || process.env.SOURCES_ENABLED === "0") return;
  running = true;
  lastRun = Date.now();
  void Promise.allSettled([syncGithub(), syncCalendar()])
    .then((r) => r.forEach((x) => x.status === "rejected" && log(x.reason instanceof Error ? x.reason.message : x.reason)))
    .finally(() => (running = false));
}
