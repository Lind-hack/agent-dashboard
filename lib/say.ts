import { syncCalendar } from "./autopilot";
import { addDays, calendarConnected, createEvent, gcal, replacePlan } from "./calendar";
import { clockNow, coachNow, coachTz, nextFreeSlot, calendarBusy } from "./coach";
import { readGoals, writeGoals, type GoalHorizon } from "./goals";
import { archiveHabit, listHabits, saveHabit } from "./habits";
import { groqJSON } from "./groq";
import { addEntry } from "./journal";
import { nemotron, nvidiaReady } from "./nvidia";
import { activeBlocks, addBlock, readPlan, removeBlock } from "./plan-store";
import { addTodo, listTodos, removeTodo } from "./todos";

// "Say it" (v5.2, Lind's pick: one mic that sorts). Whatever Lind says or types on Today or Goals —
// "gym at 6 for an hour, finish the 383 pitch today, new goal: save 2k by March" — is split into
// tasks, time blocks on his plan, calendar events and goals, each carried out at once and each with
// its own undo.
// v5.4 (Lind: "random tasks with no context I'm not asking for, and duplicates"): every item must
// quote the words that asked for it — an item whose quote isn't in what he said is dropped; the model
// sees his open tasks and names the one an item repeats; and nothing is saved until he reviews the
// cards (keep / edit / drop), with repeats and vague ones unticked.
// v5.5 (Lind: "I dictate for 2-3 minutes and it says no tasks were said"): dictating is how he thinks,
// so spoken plans count; all he says about one job is one item, with the rest kept as its notes and
// steps; an empty model answer is a failure, not "nothing said"; the page never throws his words away.

export type SayItem =
  | { kind: "task"; title: string; day: string; estimateMin?: number; priority?: 0 | 1 | 2 | 3; due?: string; goalId?: string; notes?: string; steps?: string[] }
  | { kind: "block"; title: string; day: string; start?: string; length: number; goalId?: string; notes?: string; steps?: string[] }
  | { kind: "event"; title: string; date: string; start?: string; end?: string; notes?: string }
  | { kind: "goal"; title: string; horizon: GoalHorizon; next: string; why: string; due?: string; weeklyMin?: number; notes?: string }
  | { kind: "habit"; title: string; icon: string; target: number; step: number; unit: string; days: number[] };
// What the review cards carry: the item, the words it came from, and why it might not be wanted.
export type SayDraft = { item: SayItem; quote: string; dupOf?: { id: string; title: string }; vague?: boolean; unsure?: boolean };
export type Undo = { kind: SayItem["kind"]; id: string; day?: string; taskId?: string };
export const SAY_MAX = 24_000; // ~15 minutes of talking
export type SayResult = { kind: SayItem["kind"]; label: string; undo?: Undo; error?: string };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const str = (v: unknown, max = 200) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const hhmm = (v: unknown) => {
  const m = str(v).match(/^(\d{1,2}):(\d{2})$/);
  return m && Number(m[1]) < 24 && Number(m[2]) < 60 ? `${m[1].padStart(2, "0")}:${m[2]}` : undefined;
};

const SYSTEM = `You turn what Lind just said (often spoken, maybe Albanian or English, maybe rambling) into items for his day planner. Return JSON {"items": [...]}, one item per thing he asked for, in the order he said them. Kinds:
{"kind":"task","title":string,"day":"YYYY-MM-DD","estimateMin":number,"priority":0-3,"due":"YYYY-MM-DD" or "YYYY-MM-DDTHH:MM" | null,"goalId":string|null,"notes":string|null,"steps":[string]}
  — something to get done, no fixed time ("finish the pitch today", "call the bank tomorrow").
{"kind":"block","title":string,"day":"YYYY-MM-DD","start":"HH:MM"|null,"length":minutes,"goalId":string|null,"notes":string|null,"steps":[string]}
  — time HE sets aside to do something himself ("gym at 6 for an hour", "two hours of coding after lunch", "study from 15 to 17"). start null = the next free time today.
{"kind":"event","title":string,"date":"YYYY-MM-DD","start":"HH:MM"|null,"end":"HH:MM"|null,"notes":string|null}
  — an appointment with other people or a fixed thing ("dentist Thursday at 10", "meeting with Arben at 3", "exam on the 24th").
{"kind":"goal","title":string,"horizon":"now"|"short"|"long","next":string,"why":string,"due":"YYYY-MM-DD"|null,"weeklyMin":number|null,"notes":string|null}
  — "new goal", "I want to … by …". horizon: now = this week, short = this month or quarter, long = beyond. next = the first concrete step. weeklyMin = time a week he names, else null.
{"kind":"habit","title":string,"icon":one emoji,"target":number,"step":number,"unit":string,"days":[0-6]}
  — something to do repeatedly ("new habit: drink 2 litres of water every day", "gym Monday Wednesday Friday", "read 20 minutes daily"). target = the daily amount (1 for a plain do-it), unit for it ("litres", "min", "" for plain), step = what one tap adds (e.g. 0.25 litres, 5 min, 1), days = weekdays with 0 = Sunday, [] = every day.
Every item also carries "quote": the exact words (copied from what he said, 2–15 words) that ask for it, and "dupOf": the id of an open task from the list that it repeats, or null.
He often dictates for minutes at a time, thinking out loud. That is how he plans, so read all of it, to the end:
- What he says he will do IS an item, however loosely he says it: "I have to", "I need to", "I'm going to", "I want to", "tomorrow I'll", "first I'll…", and the same in Albanian ("duhet", "do ta", "dua me", "nesër").
- One job is ONE item, however long he talks about it. Everything he says about it goes on that item, not into new items: "steps" = the concrete sub-steps he named, in order (at most 8, short); "notes" = the rest in his own words: how he wants it done, why, names, numbers, decisions. Keep every detail; don't summarise them away. notes and steps may be empty for a short request.
- A new item only for a genuinely separate job.
What is NOT an item: feelings, things that already happened, things other people will do, examples, filler, and anything he didn't say. His review screen catches a wrong card, so don't skip real work; but never invent one.
Rules: resolve relative dates and times from "Now" ("tonight" = today, "at 6" in the evening = 18:00 unless clearly morning). goalId only from the goal list, and only when the item is plainly about that goal (same project or subject) — otherwise null. Titles short and clear, in his language, without filler ("I need to"). Nothing he didn't ask for. If it's not a request for any of these, return {"items": []}.`;

export async function parseSay(text: string, from: "today" | "goals" = "today"): Promise<SayDraft[]> {
  const tz = coachTz();
  const today = coachNow().day;
  const goals = readGoals().filter((g) => !g.done);
  const open = listTodos().filter((t) => !t.done).slice(-60);
  const weekday = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "long" }).format(new Date(`${today}T12:00:00Z`));
  const user = `Now: ${weekday} ${today}, ${clockNow(tz)} (${tz}). Tomorrow: ${addDays(today, 1)}.\nGoals (id | title): ${goals.map((g) => `${g.id} | ${g.title}`).join("; ") || "none"}\nOpen tasks (id | title): ${open.map((t) => `${t.id} | ${t.title}`).join("; ") || "none"}\n${from === "goals" ? "He is on the Goals page: a long-term ambition is a goal, and all he says about it goes in that goal's notes.\n" : ""}\nLind said: ${text}`;
  // Room for the answer grows with what he said; low effort so a reasoning model doesn't spend it thinking.
  const maxTokens = Math.min(6000, 2500 + Math.round(text.length / 2));
  let out = await groqJSON<{ items: unknown[] }>(SYSTEM, user, 0.1, { maxTokens, timeoutMs: 40_000, reasoningEffort: "low" }).catch(() => null);
  if (!Array.isArray(out?.items) && nvidiaReady()) {
    const raw = await nemotron(`${SYSTEM}\nReturn ONLY the JSON object.`, user, { maxTokens, temperature: 0.1 }).catch(() => "");
    try {
      out = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
    } catch {
      out = null;
    }
  }
  // No usable answer is a failure, never "you said nothing".
  if (!Array.isArray(out?.items)) throw new Error("Couldn't sort that right now — the models are busy. Your words are safe below.");
  const raw = out.items;
  return draftItems(raw, cleanItems(raw, today, new Set(goals.map((g) => g.id))), text, open.map((t) => ({ id: t.id, title: t.title })));
}

// ---- review: grounding, repeats, vagueness --------------------------------------------------------

const STOP = new Set("a an the to of for and or in on at by with my me i it is be do get go make some this that then also just need want should have has will would can could please about from into task tasks today tomorrow".split(" "));
const words = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 1);
const content = (s: string) => words(s).filter((w) => !STOP.has(w));

// How much of a's content is in b (0…1), loosely: one word starting with the other's first 5 letters
// (or all of a shorter one) counts, so "emails"/"email" and "calling"/"call" match.
const stem = (w: string) => w.slice(0, 5);
export function overlap(a: string, b: string): number {
  const A = content(a);
  if (!A.length) return 0;
  const B = content(b);
  return A.filter((w) => B.some((x) => x.startsWith(stem(w)) || w.startsWith(stem(x)))).length / A.length;
}
const similar = (a: string, b: string) => Math.min(overlap(a, b), overlap(b, a)) >= 0.75 || (overlap(a, b) >= 0.8 && content(a).length >= 2);

// The cleaned items, paired with the model's raw ones by title, kept only when their quote is really
// in what he said; flagged when they repeat an open task (or each other) or say too little to act on.
export function draftItems(raw: unknown[], items: SayItem[], said: string, open: { id: string; title: string }[]): SayDraft[] {
  const rawByTitle = new Map(raw.map((r) => [str((r as { title?: unknown })?.title), (r ?? {}) as { quote?: unknown; dupOf?: unknown }]));
  const out: SayDraft[] = [];
  for (const item of items) {
    const r = rawByTitle.get(item.title) ?? {};
    const quote = str(r.quote, 200);
    // Grounded: the quote or the title is mostly words he actually said. Half-grounded ones are offered
    // unticked (a long dictation paraphrases); nothing he said at all is dropped.
    const grounded = Math.max(quote ? overlap(quote, said) : 0, overlap(item.title, said));
    if (grounded < 0.3) continue;
    if (out.some((d) => d.item.kind === item.kind && similar(d.item.title, item.title))) continue;
    const named = typeof r.dupOf === "string" ? open.find((t) => t.id === r.dupOf) : undefined;
    const dup = item.kind === "task" || item.kind === "block" ? (named ?? open.find((t) => similar(item.title, t.title))) : undefined;
    out.push({ item, quote, ...(dup ? { dupOf: dup } : {}), ...(content(item.title).length < 2 && item.kind !== "habit" ? { vague: true } : {}), ...(grounded < 0.6 ? { unsure: true } : {}) });
  }
  return out;
}

// Words Whisper should spell his way: goals, open tasks, habits, and the names in his life.
export function sayVocabulary(): string {
  const names = ["383", "building.ai", "TikTok", "Linear", "Prishtina", "Kosovo", "Hormozi", "Goggins"];
  const mine = [...readGoals().filter((g) => !g.done).map((g) => g.title), ...listHabits().map((h) => h.title), ...listTodos().filter((t) => !t.done).slice(-15).map((t) => t.title)];
  return [...names, ...mine].join(", ").slice(0, 600);
}

// A model's (or a card's) details: line breaks stay, length is capped.
const longText = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 1900) : undefined);
const stepList = (v: unknown) => {
  const steps = (Array.isArray(v) ? v : []).map((s) => str(s, 160)).filter(Boolean).slice(0, 8);
  return steps.length ? steps : undefined;
};

// The model's items, checked: known kinds, real dates and times, goal ids that exist.
export function cleanItems(raw: unknown, today: string, goalIds: Set<string>): SayItem[] {
  const out: SayItem[] = [];
  for (const r of Array.isArray(raw) ? raw.slice(0, 12) : []) {
    const x = (r ?? {}) as Record<string, unknown>;
    const title = str(x.title);
    if (!title) continue;
    const goalId = typeof x.goalId === "string" && goalIds.has(x.goalId) ? x.goalId : undefined;
    const day = typeof x.day === "string" && DAY.test(x.day) && x.day >= today ? x.day : today;
    const notes = longText(x.notes);
    const steps = stepList(x.steps);
    if (x.kind === "task") {
      const due = typeof x.due === "string" && /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(x.due) ? x.due : undefined;
      const est = Number(x.estimateMin);
      const pr = Number(x.priority);
      out.push({ kind: "task", title, day, due, goalId, estimateMin: est > 0 ? Math.min(600, Math.round(est)) : undefined, priority: [0, 1, 2, 3].includes(pr) ? (pr as 0 | 1 | 2 | 3) : undefined, notes, steps });
    } else if (x.kind === "block") {
      const len = Number(x.length);
      out.push({ kind: "block", title, day, start: hhmm(x.start), length: len >= 10 ? Math.min(240, Math.round(len)) : 60, goalId, notes, steps });
    } else if (x.kind === "event") {
      const date = typeof x.date === "string" && DAY.test(x.date) ? x.date : today;
      out.push({ kind: "event", title, date, start: hhmm(x.start), end: hhmm(x.end), notes });
    } else if (x.kind === "habit") {
      const target = Number(x.target) > 0 ? Math.min(1000, Number(x.target)) : 1;
      const step = Number(x.step) > 0 ? Math.min(target, Number(x.step)) : target <= 10 ? 1 : target / 4;
      const days = Array.isArray(x.days) ? [...new Set(x.days.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort() : [];
      out.push({ kind: "habit", title, icon: str(x.icon, 8) || "✓", target, step, unit: str(x.unit, 16), days });
    } else if (x.kind === "goal") {
      const h = x.horizon === "now" || x.horizon === "long" ? x.horizon : "short";
      const wk = Number(x.weeklyMin);
      out.push({ kind: "goal", title, horizon: h, next: str(x.next), why: str(x.why), due: typeof x.due === "string" && DAY.test(x.due) ? x.due : undefined, weeklyMin: wk >= 5 ? Math.round(wk) : undefined, notes });
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
        const t = addTodo({ title: it.title, day: it.day, estimateMin: it.estimateMin, priority: it.priority, due: it.due, goalId: it.goalId, notes: it.notes, subtasks: it.steps, source: "assistant" });
        out.push({ kind: "task", label: `Task · ${t.title}${it.day !== today ? ` · ${fmtDay(it.day, today)}` : ""}`, undo: { kind: "task", id: t.id } });
      } else if (it.kind === "block") {
        let start = it.start;
        if (!start) {
          if (it.day !== today) {
            const t = addTodo({ title: it.title, day: it.day, estimateMin: it.length, goalId: it.goalId, notes: it.notes, subtasks: it.steps, source: "assistant" });
            out.push({ kind: "task", label: `Task · ${t.title} · ${fmtDay(it.day, today)} (no time given)`, undo: { kind: "task", id: t.id } });
            continue;
          }
          start = nextFreeSlot(it.length, new Date(), await calendarBusy().catch(() => [])) ?? undefined;
          if (!start) {
            out.push({ kind: "block", label: `Block · ${it.title}`, error: "No free time left today — say a time." });
            continue;
          }
        }
        // A block has no notes of its own: details live on a task linked to it.
        const task = it.notes || it.steps?.length ? addTodo({ title: it.title, day: it.day, estimateMin: it.length, goalId: it.goalId, notes: it.notes, subtasks: it.steps, source: "assistant" }) : undefined;
        const b = addBlock(it.day, { start, length: it.length, title: it.title, goalId: it.goalId, taskId: task?.id, kind: it.goalId ? "focus" : "task" });
        const calErr = await syncDay(it.day);
        out.push({ kind: "block", label: `Block · ${b.start}–${b.end} ${b.title}${it.day !== today ? ` · ${fmtDay(it.day, today)}` : ""}`, undo: { kind: "block", id: b.id, day: it.day, taskId: task?.id }, error: calErr });
      } else if (it.kind === "event") {
        if (!calendarConnected()) {
          out.push({ kind: "event", label: `Event · ${it.title}`, error: "Google Calendar isn't connected." });
          continue;
        }
        const e = await createEvent({ title: it.title, date: it.date, start: it.start, end: it.start ? (it.end ?? undefined) : undefined, allDay: !it.start, notes: it.notes });
        out.push({ kind: "event", label: `Event · ${it.title} · ${fmtDay(it.date, today)}${it.start ? ` ${it.start}` : ""}`, undo: { kind: "event", id: e.id } });
      } else if (it.kind === "habit") {
        const h = saveHabit({ title: it.title, icon: it.icon, target: it.target, step: it.step, unit: it.unit, days: it.days, hue: [150, 200, 265, 15, 38][out.length % 5] });
        if (!h) throw new Error("couldn't save the habit");
        out.push({ kind: "habit", label: `Habit · ${h.icon} ${h.title}${h.target !== 1 || h.unit ? ` · ${h.target} ${h.unit}`.trimEnd() : ""}`, undo: { kind: "habit", id: h.id } });
      } else {
        const all = readGoals();
        const r = writeGoals([...all, { id: "", title: it.title, horizon: it.horizon, next: it.next, why: it.why, due: it.due, weeklyMin: it.weeklyMin, done: false }]);
        if (!r.ok) throw new Error(r.error ?? "couldn't save the goal");
        const before = new Set(all.map((g) => g.id));
        const g = readGoals().find((x) => !before.has(x.id));
        // What he said around the goal is what the mentor plans from.
        if (it.notes) addEntry(today, `About the new goal "${it.title}": ${it.notes}`, "voice");
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
    if (u.taskId) removeTodo(u.taskId);
    return { ok: true, error: await syncDay(u.day) };
  }
  if (u.kind === "habit") return archiveHabit(u.id) ? { ok: true } : { ok: false, error: "That habit is already gone." };
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
