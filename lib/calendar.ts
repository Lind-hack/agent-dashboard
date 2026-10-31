import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./config";

// Google Calendar for the day's agenda and add-by-voice (developers.google.com/workspace/calendar/api/v3).
// The refresh token comes from handoff/google-auth.mjs on Lind's PC, which posts it to
// /api/calendar/token; it lives in data/google.json (mode 600) and never reaches the browser.

export type GoogleCreds = { client_id: string; client_secret: string; refresh_token: string; scopes?: string[] };

export type CalEvent = {
  id: string;
  title: string;
  start: string; // ISO date-time, or YYYY-MM-DD for all-day
  end: string;
  allDay: boolean;
  location?: string;
  link?: string;
  calendar: string;
  color?: string;
  planned?: boolean; // a time block written by "Plan my day"
};

export type EventDraft = { title: string; date: string; start?: string; end?: string; allDay: boolean; location?: string };

const credsFile = () => path.join(DATA_DIR, "google.json");
const API = "https://www.googleapis.com/calendar/v3";

export function saveCreds(c: GoogleCreds) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(`${credsFile()}.tmp`, JSON.stringify(c), { mode: 0o600 });
  fs.renameSync(`${credsFile()}.tmp`, credsFile());
  token = null;
}

function readCreds(): GoogleCreds | null {
  try {
    const c = JSON.parse(fs.readFileSync(credsFile(), "utf8"));
    return c?.refresh_token && c?.client_id ? c : null;
  } catch {
    return null;
  }
}

export const calendarConnected = () => readCreds() !== null;
// Gmail needs its own scope; older sign-ins only granted Calendar.
export const gmailConnected = () => !!readCreds()?.scopes?.some((s) => s.includes("gmail"));

let token: { value: string; until: number } | null = null;

export async function accessToken(): Promise<string> {
  if (token && Date.now() < token.until) return token.value;
  const c = readCreds();
  if (!c) throw new Error("Google Calendar isn't connected yet.");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: c.client_id, client_secret: c.client_secret, refresh_token: c.refresh_token, grant_type: "refresh_token" }),
  });
  const body = (await res.json().catch(() => null)) as { access_token?: string; expires_in?: number; error_description?: string } | null;
  if (!res.ok || !body?.access_token) throw new Error(`Google sign-in expired — run google-auth again (${body?.error_description ?? res.status}).`);
  token = { value: body.access_token, until: Date.now() + ((body.expires_in ?? 3600) - 120) * 1000 };
  return token.value;
}

export async function gcal<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${url}`, {
    ...init,
    headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json" },
    cache: "no-store",
  });
  if (res.status === 204) return null as T; // DELETE answers with no body
  const body = (await res.json().catch(() => null)) as (T & { error?: { message?: string } }) | null;
  if (!res.ok || !body) throw new Error(`Google Calendar: ${body?.error?.message ?? res.status}`);
  return body;
}

let tzCache: string | null = null;
export async function timeZone(): Promise<string> {
  tzCache ??= (await gcal<{ timeZone?: string }>("/calendars/primary").catch(() => null))?.timeZone ?? "Europe/Belgrade";
  return tzCache;
}

// Offset like "+01:00" for a zone at a moment, so day bounds are midnight in Lind's zone, not the VPS's.
function offset(tz: string, at: Date): string {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longOffset" }).formatToParts(at).find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const m = name.match(/GMT([+-]\d{2}):?(\d{2})?/);
  return m ? `${m[1]}:${m[2] ?? "00"}` : "+00:00";
}

export const dayString = (tz: string, at = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(at); // YYYY-MM-DD

export function addDays(day: string, n: number) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

type GEvent = {
  id: string;
  extendedProperties?: { private?: Record<string, string> };
  status?: string;
  summary?: string;
  location?: string;
  htmlLink?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
};

// Events from every calendar Lind has switched on in Google Calendar, for `days` days from today.
export async function agenda(days = 2): Promise<{ tz: string; today: string; events: CalEvent[] }> {
  const tz = await timeZone();
  const today = dayString(tz);
  const from = `${today}T00:00:00${offset(tz, new Date(`${today}T12:00:00Z`))}`;
  const last = addDays(today, days);
  const to = `${last}T00:00:00${offset(tz, new Date(`${last}T12:00:00Z`))}`;
  const list = await gcal<{ items?: { id: string; summary?: string; summaryOverride?: string; backgroundColor?: string; selected?: boolean; primary?: boolean }[] }>(
    "/users/me/calendarList?minAccessRole=reader",
  );
  const cals = (list.items ?? []).filter((c) => c.selected || c.primary);
  const all = await Promise.all(
    cals.map(async (c) => {
      const q = new URLSearchParams({ timeMin: from, timeMax: to, singleEvents: "true", orderBy: "startTime", maxResults: "50", timeZone: tz });
      const r = await gcal<{ items?: GEvent[] }>(`/calendars/${encodeURIComponent(c.id)}/events?${q}`).catch(() => ({ items: [] as GEvent[] }));
      return (r.items ?? [])
        .filter((e) => e.status !== "cancelled")
        .map(
          (e): CalEvent => ({
            id: e.id,
            title: e.summary ?? "(busy)",
            start: e.start?.dateTime ?? e.start?.date ?? "",
            end: e.end?.dateTime ?? e.end?.date ?? "",
            allDay: !e.start?.dateTime,
            location: e.location,
            link: e.htmlLink,
            calendar: c.primary ? "Personal" : (c.summaryOverride ?? c.summary ?? ""),
            color: c.backgroundColor,
            planned: !!e.extendedProperties?.private?.[PLAN_KEY],
          }),
        );
    }),
  );
  const events = all.flat().sort((a, b) => (a.allDay === b.allDay ? new Date(a.start).getTime() - new Date(b.start).getTime() : a.allDay ? -1 : 1));
  return { tz, today, events };
}

// Plan blocks are ordinary events on the primary calendar, tagged so a re-plan can replace them.
export const PLAN_KEY = "agentDashPlan";
// blockId is stable across replans (day + start + title); goalId links a focus block to 100 - Me/Goals.md.
export type PlanBlock = {
  blockId: string;
  start: string;
  end: string;
  title: string;
  kind: "task" | "focus" | "break" | "routine";
  taskId?: string;
  projectId?: string;
  goalId?: string;
};
const PLAN_COLOR: Record<PlanBlock["kind"], string> = { task: "9", focus: "3", break: "2", routine: "8" }; // blueberry, grape, sage, graphite

// Removes this day's earlier plan (only the blocks still in the future) and writes the new one.
export async function replacePlan(day: string, blocks: PlanBlock[]) {
  const tz = await timeZone();
  const from = `${day}T00:00:00${offset(tz, new Date(`${day}T12:00:00Z`))}`;
  const to = `${addDays(day, 1)}T00:00:00${offset(tz, new Date(`${day}T12:00:00Z`))}`;
  const q = new URLSearchParams({ timeMin: from, timeMax: to, singleEvents: "true", privateExtendedProperty: `${PLAN_KEY}=${day}`, maxResults: "100" });
  const old = await gcal<{ items?: GEvent[] }>(`/calendars/primary/events?${q}`);
  const now = Date.now();
  for (const e of old.items ?? []) {
    if (new Date(e.start?.dateTime ?? 0).getTime() > now) await gcal(`/calendars/primary/events/${encodeURIComponent(e.id)}`, { method: "DELETE" });
  }
  for (const b of blocks) await insertBlock(day, b, tz);
}

// One plan block on Google Calendar, tagged so a re-plan replaces it, with phone/PC alarms 10 minutes
// before and at the start (v5: "Calendar alarms" — they fire even when web push doesn't).
async function insertBlock(day: string, b: PlanBlock, tz: string) {
  await gcal("/calendars/primary/events", {
    method: "POST",
    body: JSON.stringify({
      summary: b.title,
      colorId: PLAN_COLOR[b.kind] ?? "9",
      description: b.taskId ? "A task from your list · planned on agents.383ks.com" : "Planned on agents.383ks.com",
      start: { dateTime: `${day}T${b.start}:00`, timeZone: tz },
      end: { dateTime: `${b.end > b.start ? day : addDays(day, 1)}T${b.end}:00`, timeZone: tz },
      reminders: { useDefault: false, overrides: b.kind === "break" ? [] : [{ method: "popup", minutes: 10 }, { method: "popup", minutes: 0 }] },
      extendedProperties: { private: { [PLAN_KEY]: day, blockId: b.blockId, ...(b.taskId ? { taskId: b.taskId } : {}) } },
    }),
  });
}

// A block added after the plan was applied ("Schedule this task", "Plan into today"): onto the
// calendar too, when it's connected. Failures are the caller's to ignore — the plan file is the truth.
export async function mirrorBlock(day: string, b: PlanBlock) {
  if (!calendarConnected()) return false;
  await insertBlock(day, b, await timeZone());
  return true;
}

export async function createEvent(d: EventDraft): Promise<CalEvent> {
  const tz = await timeZone();
  const body = d.allDay || !d.start
    ? { summary: d.title, location: d.location, start: { date: d.date }, end: { date: addDays(d.date, 1) } }
    : {
        summary: d.title,
        location: d.location,
        start: { dateTime: `${d.date}T${d.start}:00`, timeZone: tz },
        // An end before the start means it runs past midnight.
        end: { dateTime: `${d.end && d.end > d.start ? d.date : addDays(d.date, 1)}T${d.end ?? d.start}:00`, timeZone: tz },
        reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 30 }, { method: "popup", minutes: 10 }] },
      };
  const e = await gcal<GEvent>("/calendars/primary/events", { method: "POST", body: JSON.stringify(body) });
  return {
    id: e.id,
    title: e.summary ?? d.title,
    start: e.start?.dateTime ?? e.start?.date ?? "",
    end: e.end?.dateTime ?? e.end?.date ?? "",
    allDay: !e.start?.dateTime,
    location: e.location,
    link: e.htmlLink,
    calendar: "Personal",
  };
}
