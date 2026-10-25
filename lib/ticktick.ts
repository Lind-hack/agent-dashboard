import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./config";

// TickTick Open API (developer.ticktick.com): Lind's planner app. Connected from the Today page:
// he pastes his app's client id/secret, approves on ticktick.com, the callback stores the token in
// data/ticktick.json (mode 600). TickTick issues no refresh token — when it lapses, connect again.

const API = "https://api.ticktick.com/open/v1";
const file = () => path.join(DATA_DIR, "ticktick.json");

type Creds = { client_id: string; client_secret: string; access_token?: string; state?: string; redirect?: string };

export type Task = {
  id: string;
  projectId: string;
  project: string;
  title: string;
  content?: string;
  due?: string; // ISO date-time, or YYYY-MM-DD when all-day
  allDay: boolean;
  priority: 0 | 1 | 3 | 5;
  tags: string[];
};

export type TaskDraft = { title: string; date?: string; time?: string; priority: 0 | 1 | 3 | 5; projectId?: string };

function read(): Creds | null {
  try {
    const c = JSON.parse(fs.readFileSync(file(), "utf8"));
    return c?.client_id ? c : null;
  } catch {
    return null;
  }
}

function write(c: Creds) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(`${file()}.tmp`, JSON.stringify(c), { mode: 0o600 });
  fs.renameSync(`${file()}.tmp`, file());
}

export const ticktickConnected = () => !!read()?.access_token;

// Step 1: remember the app credentials and hand back the TickTick consent URL.
export function startConnect(clientId: string, clientSecret: string, origin: string): string {
  const state = crypto.randomBytes(16).toString("hex");
  const redirect = `${origin}/api/ticktick/callback`;
  write({ client_id: clientId, client_secret: clientSecret, state, redirect });
  const u = new URL("https://ticktick.com/oauth/authorize");
  u.search = new URLSearchParams({ client_id: clientId, scope: "tasks:read tasks:write", state, redirect_uri: redirect, response_type: "code" }).toString();
  return u.toString();
}

// Step 2: TickTick sends Lind back with a code; swap it for the token.
export async function finishConnect(code: string, state: string) {
  const c = read();
  if (!c?.state || c.state !== state) throw new Error("This TickTick sign-in link expired — start again from the Today page.");
  const res = await fetch("https://ticktick.com/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${c.client_id}:${c.client_secret}`).toString("base64")}`,
    },
    body: new URLSearchParams({ code, grant_type: "authorization_code", scope: "tasks:read tasks:write", redirect_uri: c.redirect ?? "" }),
  });
  const body = (await res.json().catch(() => null)) as { access_token?: string; error_description?: string } | null;
  if (!res.ok || !body?.access_token) throw new Error(`TickTick refused the sign-in (${body?.error_description ?? res.status}).`);
  write({ client_id: c.client_id, client_secret: c.client_secret, access_token: body.access_token });
}

async function tt<T>(url: string, init?: RequestInit): Promise<T> {
  const token = read()?.access_token;
  if (!token) throw new Error("TickTick isn't connected.");
  const res = await fetch(`${API}${url}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    cache: "no-store",
  });
  if (res.status === 401) throw new Error("TickTick sign-in expired — connect it again on the Today page.");
  if (!res.ok) throw new Error(`TickTick: ${res.status}`);
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

type RawTask = {
  id: string;
  projectId: string;
  title?: string;
  content?: string;
  dueDate?: string;
  startDate?: string;
  isAllDay?: boolean;
  priority?: number;
  status?: number;
  tags?: string[];
  timeZone?: string;
};

let projCache: { at: number; names: Map<string, string> } | null = null;
export async function projects(): Promise<{ id: string; name: string }[]> {
  if (!projCache || Date.now() - projCache.at > 10 * 60_000) {
    const list = await tt<{ id: string; name: string; closed?: boolean }[]>("/project");
    projCache = { at: Date.now(), names: new Map((list ?? []).filter((p) => !p.closed).map((p) => [p.id, p.name])) };
  }
  return [...projCache.names].map(([id, name]) => ({ id, name }));
}

// TickTick stamps "2026-10-25T22:00:00+0000"; all-day dates are midnight in the task's zone.
function toTask(r: RawTask, names: Map<string, string>, tz: string): Task {
  const raw = r.dueDate ?? r.startDate;
  const allDay = !!r.isAllDay;
  const iso = raw ? new Date(raw.replace(/([+-]\d{2})(\d{2})$/, "$1:$2")).toISOString() : undefined;
  return {
    id: r.id,
    projectId: r.projectId,
    project: names.get(r.projectId) ?? (r.projectId?.startsWith("inbox") ? "Inbox" : ""),
    title: r.title ?? "(untitled)",
    content: r.content || undefined,
    due: iso && allDay ? new Intl.DateTimeFormat("en-CA", { timeZone: r.timeZone || tz }).format(new Date(iso)) : iso,
    allDay,
    priority: ([0, 1, 3, 5].includes(r.priority ?? 0) ? r.priority : 0) as Task["priority"],
    tags: r.tags ?? [],
  };
}

const ttDate = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "+0000");

// The real Inbox id ("inbox<userId>"), learnt from the tasks; "inbox" alone returns nothing on
// /project/inbox/data for Lind's account.
let inboxId: string | null = null;

// Open tasks Lind should see today: overdue + due today, plus Inbox tasks with no date (the capture
// pile). /task/filter with status open returns every open task (max 200) — /task/undone came back
// empty even for tasks due today, so the split by date happens here.
export async function openTasks(tz: string, today: string): Promise<{ overdue: Task[]; today: Task[]; inbox: Task[] }> {
  await projects();
  const names = projCache!.names;
  const raw = (await tt<RawTask[]>("/task/filter", { method: "POST", body: JSON.stringify({ status: [0] }) })) ?? [];
  inboxId = raw.find((r) => r.projectId?.startsWith("inbox"))?.projectId ?? inboxId;
  const all = raw.filter((r) => r.status !== 2).map((r) => toTask(r, names, tz));
  const dayOf = (t: Task) => (t.allDay ? t.due! : new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(t.due!)));
  const dated = all.filter((t) => t.due);
  const byPriority = (a: Task, b: Task) => b.priority - a.priority || (a.due ?? "").localeCompare(b.due ?? "");
  return {
    overdue: dated.filter((t) => dayOf(t) < today).sort(byPriority),
    today: dated.filter((t) => dayOf(t) === today).sort(byPriority),
    inbox: all
      .filter((t) => !t.due && t.projectId?.startsWith("inbox"))
      .sort(byPriority)
      .slice(0, 15),
  };
}

export async function completeTask(projectId: string, id: string) {
  await tt(`/project/${encodeURIComponent(projectId)}/task/${encodeURIComponent(id)}/complete`, { method: "POST" });
}

export async function createTask(d: TaskDraft, tz: string): Promise<{ id: string }> {
  const body: Record<string, unknown> = { title: d.title, priority: d.priority, projectId: d.projectId ?? inboxId ?? "inbox", timeZone: tz };
  if (d.date) {
    if (d.time) {
      // Local wall time → UTC instant via the zone's offset on that day.
      const guess = new Date(`${d.date}T${d.time}:00Z`);
      const off = tzOffsetMinutes(tz, guess);
      const at = new Date(guess.getTime() - off * 60_000);
      body.startDate = body.dueDate = ttDate(at);
      body.isAllDay = false;
    } else {
      const midnight = new Date(`${d.date}T00:00:00Z`);
      const at = new Date(midnight.getTime() - tzOffsetMinutes(tz, midnight) * 60_000);
      body.startDate = body.dueDate = ttDate(at);
      body.isAllDay = true;
    }
  }
  return tt<{ id: string }>("/task", { method: "POST", body: JSON.stringify(body) });
}

export function tzOffsetMinutes(tz: string, at: Date): number {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longOffset" }).formatToParts(at).find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const m = name.match(/GMT([+-])(\d{2}):?(\d{2})?/);
  return m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0)) : 0;
}
