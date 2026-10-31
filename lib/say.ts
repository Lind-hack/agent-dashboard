import { syncCalendar } from "./autopilot";
import { addDays, calendarConnected, createEvent, gcal, replacePlan } from "./calendar";
import { clockNow, coachNow, coachTz, nextFreeSlot, calendarBusy } from "./coach";
import { readGoals, writeGoals, type GoalHorizon } from "./goals";
import { groqJSON } from "./groq";
import { nemotron, nvidiaReady } from "./nvidia";
import { activeBlocks, addBlock, readPlan, removeBlock } from "./plan-store";
import { addTodo, removeTodo } from "./todos";

// "Say it" (v5.2, Lind's pick: one mic that sorts). Whatever Lind says or types on Today or Goals —
// "gym at 6 for an hour, finish the 383 pitch today, new goal: save 2k by March" — is split into
// tasks, time blocks on his plan, calendar events and goals, each carried out at once and each with
// its own undo.

export type SayItem =
  | { kind: "task"; title: string; day: string; estimateMin?: number; priority?: 0 | 1 | 2 | 3; due?: string; goalId?: string }
  | { kind: "block"; title: string; day: string; start?: string; length: number; goalId?: string }
  | { kind: "event"; title: string; date: string; start?: string; end?: string }
  | { kind: "goal"; title: string; horizon: GoalHorizon; next: string; why: string; due?: string; weeklyMin?: number };
export type Undo = { kind: SayItem["kind"]; id: string; day?: string };
export type SayResult = { kind: SayItem["kind"]; label: string; undo?: Undo; error?: string };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const str = (v: unknown, max = 200) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const hhmm = (v: unknown) => {
  const m = str(v).match(/^(\d{1,2}):(\d{2})$/);
  return m && Number(m[1]) < 24 && Number(m[2]) < 60 ? `${m[1].padStart(2, "0")}:${m[2]}` : undefined;
};

const SYSTEM = `You turn what Lind just said (often spoken, maybe Albanian or English, maybe rambling) into items for his day planner. Return JSON {"items": [...]}, one item per thing he asked for, in the order he said them. Kinds:
{"kind":"task","title":string,"day":"YYYY-MM-DD","estimateMin":number,"priority":0-3,"due":"YYYY-MM-DD" or "YYYY-MM-DDTHH:MM" | null,"goalId":string|null}
  — something to get done, no fixed time ("finish the pitch today", "call the bank tomorrow").
{"kind":"block","title":string,"day":"YYYY-MM-DD","start":"HH:MM"|null,"length":minutes,"goalId":string|null}
  — time HE sets aside to do something himself ("gym at 6 for an hour", "two hours of coding after lunch", "study from 15 to 17"). start null = the next free time today.
{"kind":"event","title":string,"date":"YYYY-MM-DD","start":"HH:MM"|null,"end":"HH:MM"|null}
  — an appointment with other people or a fixed thing ("dentist Thursday at 10", "meeting with Arben at 3", "exam on the 24th").
{"kind":"goal","title":string,"horizon":"now"|"short"|"long","next":string,"why":string,"due":"YYYY-MM-DD"|null,"weeklyMin":number|null}
  — "new goal", "I want to … by …". horizon: now = this week, short = this month or quarter, long = beyond. next = the first concrete step. weeklyMin = time a week he names, else null.
Rules: resolve relative dates and times from "Now" ("tonight" = today, "at 6" in the evening = 18:00 unless clearly morning). goalId only from the goal list, and only when the item is plainly about that goal (same project or subject) — otherwise null. Titles short and clear, in his language, without filler ("I need to"). Nothing he didn't ask for. If it's not a request for any of these, return {"items": []}.`;

export async function parseSay(text: string): Promise<SayItem[]> {
  const tz = coachTz();
  const today = coachNow().day;
  const goals = readGoals().filter((g) => !g.done);
  const weekday = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "long" }).format(new Date(`${today}T12:00:00Z`));
  const user = `Now: ${weekday} ${today}, ${clockNow(tz)} (${tz}). Tomorrow: ${addDays(today, 1)}.\nGoals (id | title): ${goals.map((g) => `${g.id} | ${g.title}`).join("; ") || "none"}\n\nLind said: ${text}`;
  let out = await groqJSON<{ items: unknown[] }>(SYSTEM, user, 0.1, { maxTokens: 1200, timeoutMs: 30_000 }).catch(() => null);
  if (!Array.isArray(out?.items) && nvidiaReady()) {
    const raw = await nemotron(`${SYSTEM}\nReturn ONLY the JSON object.`, user, { maxTokens: 1500, temperature: 0.1 }).catch(() => "");
    try {
      out = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
    } catch {
      out = null;
    }
  }
  if (!out) throw new Error("Couldn't sort that right now — the models are busy. Try again in a minute.");
  return cleanItems(out.items, today, new Set(goals.map((g) => g.id)));
}

// The model's items, checked: known kinds, real dates and times, goal ids that exist.
export function cleanItems(raw: unknown, today: string, goalIds: Set<string>): SayItem[] {
  const out: SayItem[] = [];
  for (const r of Array.isArray(raw) ? raw.slice(0, 12) : []) {
    const x = (r ?? {}) as Record<string, unknown>;
    const title = str(x.title);
    if (!title) continue;
    const goalId = typeof x.goalId === "string" && goalIds.has(x.goalId) ? x.goalId : undefined;
    const day = typeof x.day === "string" && DAY.test(x.day) && x.day >= today ? x.day : today;
    if (x.kind === "task") {
      const due = typeof x.due === "string" && /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(x.due) ? x.due : undefined;
      const est = Number(x.estimateMin);
      const pr = Number(x.priority);
      out.push({ kind: "task", title, day, due, goalId, estimateMin: est > 0 ? Math.min(600, Math.round(est)) : undefined, priority: [0, 1, 2, 3].includes(pr) ? (pr as 0 | 1 | 2 | 3) : undefined });
    } else if (x.kind === "block") {
      const len = Number(x.length);
      out.push({ kind: "block", title, day, start: hhmm(x.start), length: len >= 10 ? Math.min(240, Math.round(len)) : 60, goalId });
    } else if (x.kind === "event") {
      const date = typeof x.date === "string" && DAY.test(x.date) ? x.date : today;
      out.push({ kind: "event", title, date, start: hhmm(x.start), end: hhmm(x.end) });
    } else if (x.kind === "goal") {
      const h = x.horizon === "now" || x.horizon === "long" ? x.horizon : "short";
      const wk = Number(x.weeklyMin);
      out.push({ kind: "goal", title, horizon: h, next: str(x.next), why: str(x.why), due: typeof x.due === "string" && DAY.test(x.due) ? x.due : undefined, weeklyMin: wk >= 5 ? Math.round(wk) : undefined });
    }
  }
  return out;
}

// The calendar mirror of a day's plan: today keeps its past blocks; another day is rewritten whole.
async function syncDay(day: string): Promise<string | undefined> {
  if (!calendarConnected()) return;
  if (day === coachNow().day) return syncCalendar(day);
  try {
    await replacePlan(day, activeBlocks(readPlan(day)).map((b) => ({ blockId: b.id, start: b.start, end: b.end, title: b.title, kind: b.kind, taskId: b.taskId, goalId: b.goalId })));
  } catch (e) {
    return `Calendar: ${e instanceof Error ? e.message : e}`;
  }
}

const fmtDay = (day: string, today: string) => (day === today ? "today" : day === addDays(today, 1) ? "tomorrow" : day);

export async function applySay(items: SayItem[]): Promise<SayResult[]> {
  const today = coachNow().day;
  const out: SayResult[] = [];
  for (const it of items) {
    try {
      if (it.kind === "task") {
        const t = addTodo({ title: it.title, day: it.day, estimateMin: it.estimateMin, priority: it.priority, due: it.due, goalId: it.goalId, source: "assistant" });
        out.push({ kind: "task", label: `Task · ${t.title}${it.day !== today ? ` · ${fmtDay(it.day, today)}` : ""}`, undo: { kind: "task", id: t.id } });
      } else if (it.kind === "block") {
        let start = it.start;
        if (!start) {
          if (it.day !== today) {
            const t = addTodo({ title: it.title, day: it.day, estimateMin: it.length, goalId: it.goalId, source: "assistant" });
            out.push({ kind: "task", label: `Task · ${t.title} · ${fmtDay(it.day, today)} (no time given)`, undo: { kind: "task", id: t.id } });
            continue;
          }
          start = nextFreeSlot(it.length, new Date(), await calendarBusy().catch(() => [])) ?? undefined;
          if (!start) {
            out.push({ kind: "block", label: `Block · ${it.title}`, error: "No free time left today — say a time." });
            continue;
          }
        }
        const b = addBlock(it.day, { start, length: it.length, title: it.title, goalId: it.goalId, kind: it.goalId ? "focus" : "task" });
        const calErr = await syncDay(it.day);
        out.push({ kind: "block", label: `Block · ${b.start}–${b.end} ${b.title}${it.day !== today ? ` · ${fmtDay(it.day, today)}` : ""}`, undo: { kind: "block", id: b.id, day: it.day }, error: calErr });
      } else if (it.kind === "event") {
        if (!calendarConnected()) {
          out.push({ kind: "event", label: `Event · ${it.title}`, error: "Google Calendar isn't connected." });
          continue;
        }
        const e = await createEvent({ title: it.title, date: it.date, start: it.start, end: it.start ? (it.end ?? undefined) : undefined, allDay: !it.start });
        out.push({ kind: "event", label: `Event · ${it.title} · ${fmtDay(it.date, today)}${it.start ? ` ${it.start}` : ""}`, undo: { kind: "event", id: e.id } });
      } else {
        const all = readGoals();
        const r = writeGoals([...all, { id: "", title: it.title, horizon: it.horizon, next: it.next, why: it.why, due: it.due, weeklyMin: it.weeklyMin, done: false }]);
        if (!r.ok) throw new Error(r.error ?? "couldn't save the goal");
        const before = new Set(all.map((g) => g.id));
        const g = readGoals().find((x) => !before.has(x.id));
        out.push({ kind: "goal", label: `Goal · ${it.title}${it.due ? ` · by ${it.due}` : ""}`, undo: g ? { kind: "goal", id: g.id } : undefined });
      }
    } catch (e) {
      out.push({ kind: it.kind, label: `${it.kind[0].toUpperCase()}${it.kind.slice(1)} · ${it.title}`, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
}

export async function undoSay(u: Undo): Promise<{ ok: boolean; error?: string }> {
  if (u.kind === "task") return removeTodo(u.id) ? { ok: true } : { ok: false, error: "That task is already gone." };
  if (u.kind === "block") {
    if (!u.day || !DAY.test(u.day) || !removeBlock(u.day, u.id)) return { ok: false, error: "That block is already gone." };
    return { ok: true, error: await syncDay(u.day) };
  }
  if (u.kind === "event") {
    if (!/^[\w-]{4,200}$/.test(u.id)) return { ok: false, error: "Unknown event." };
    await gcal(`/calendars/primary/events/${encodeURIComponent(u.id)}`, { method: "DELETE" });
    return { ok: true };
  }
  const all = readGoals();
  if (!all.some((g) => g.id === u.id)) return { ok: false, error: "That goal is already gone." };
  const r = writeGoals(all.filter((g) => g.id !== u.id));
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}
