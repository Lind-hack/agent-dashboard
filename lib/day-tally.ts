import { mirror } from "./accountability";
import { coachTz, zonedMs } from "./coach";
import { habitsFor } from "./habits";
import { readPlan } from "./plan-store";
import { listTodos, todosFor } from "./todos";
import type { DayVerdict } from "./verdict";

// The day as a count (v5.4, Lind: "track the things I did today and how many I completed, not
// minutes"): every habit, task and planned block for the day once — a block tied to a task counts
// as that task — and whether each is done. The verdict reads the count against how much of the
// waking day (07:00–23:00) has gone, so 0 of 8 at nine in the morning isn't softened yet.

export type TallyItem = { key: string; kind: "habit" | "task" | "block"; title: string; done: boolean; missed: boolean; at?: string };
export type Tally = { items: TallyItem[]; done: number; total: number; left: number; missed: number; verdict: DayVerdict };

const WAKE = "07:00";
const SLEEP = "23:00";

export function tally(day: string, nowMs = Date.now(), tz = coachTz()): Tally {
  const items: TallyItem[] = [];
  for (const h of habitsFor(day)) items.push({ key: `h:${h.habit.id}`, kind: "habit", title: h.habit.title, done: h.done, missed: false });
  const t = todosFor(day, listTodos());
  const taskIds = new Set<string>();
  for (const x of [...t.overdue, ...t.today, ...t.done]) {
    taskIds.add(x.id);
    items.push({ key: `t:${x.id}`, kind: "task", title: x.title, done: x.done, missed: false });
  }
  const linked = new Map((readPlan(day)?.blocks ?? []).map((b) => [b.id, b.taskId]));
  for (const r of mirror(day, nowMs, tz).rows) {
    const taskId = linked.get(r.id);
    if (taskId && taskIds.has(taskId)) continue;
    const done = (r.verdict === "on-time" || r.verdict === "late") && !r.running;
    items.push({ key: `b:${r.id}`, kind: "block", title: r.title, done, missed: r.verdict === "missed" || r.verdict === "not-started", at: r.start });
  }
  const total = items.length;
  const done = items.filter((i) => i.done).length;
  const missed = items.filter((i) => i.missed).length;
  return { items, done, total, left: total - done, missed, verdict: verdictOfCount(done, total, missed, dayGone(day, nowMs, tz)) };
}

// Share of the waking day behind him: 0 before 07:00, 1 from 23:00 (and for any day already over).
export function dayGone(day: string, nowMs: number, tz = coachTz()): number {
  const a = zonedMs(day, WAKE, tz);
  const z = zonedMs(day, SLEEP, tz);
  return Math.min(1, Math.max(0, (nowMs - a) / (z - a)));
}

export function verdictOfCount(done: number, total: number, missed: number, gone: number): DayVerdict {
  if (!total) return "no-plan";
  if (done === total) return "enough";
  const r = done / total;
  if (gone >= 1) return r >= 0.9 ? "enough" : r >= 0.5 ? "not-enough" : "soft";
  if (gone < 0.1 && !missed) return "pending";
  // Mid-day: softened when he's well behind the clock or has let planned blocks go by.
  if (r < gone * 0.5 || missed * 2 >= Math.max(1, total - done)) return "soft";
  return "not-enough";
}
