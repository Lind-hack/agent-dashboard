import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { addDays } from "./calendar";
import { DATA_DIR } from "./config";
import { withLock } from "./file-lock";

// Habits (v5.3, Lind's reference: a habit tracker where every row fills up as you go). A habit repeats
// on chosen weekdays and has a daily target — "2 litres", "3 meals", or just once ("Gym"). Tapping +
// logs one step; a row is done when it reaches its target. data/habits/habits.json holds the habits,
// data/habits/days/<day>.json what was logged that day.

export type Habit = {
  id: string;
  title: string;
  icon: string; // one emoji
  hue: number; // 0-359, the row's colour
  target: number; // per day (1 = just do it)
  step: number; // what one tap of + adds
  unit: string; // "litres", "meals", "" for a plain check
  days: number[]; // 0 = Sunday … 6; empty = every day
  goalId?: string;
  createdAt: string;
  archived?: boolean;
};
export type HabitDay = { habit: Habit; value: number; done: boolean; streak: number };

const dir = () => path.join(DATA_DIR, "habits");
const habitsFile = () => path.join(dir(), "habits.json");
const dayFile = (day: string) => path.join(dir(), "days", `${day}.json`);
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function readJSON<T>(f: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(f, "utf8")) ?? fallback;
  } catch {
    return fallback;
  }
}
function writeJSON(f: string, v: unknown) {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(`${f}.${process.pid}.tmp`, JSON.stringify(v, null, 1));
  fs.renameSync(`${f}.${process.pid}.tmp`, f);
}

const num = (v: unknown, lo: number, hi: number, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};

// A habit as stored, whatever shape the file (or the request) had.
export function cleanHabit(h: Partial<Habit> | null | undefined): Habit | null {
  const title = String(h?.title ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
  if (!title) return null;
  const target = num(h?.target, 0.1, 1000, 1);
  return {
    id: typeof h?.id === "string" && /^h-[\w-]{4,40}$/.test(h.id) ? h.id : `h-${Date.now().toString(36)}${crypto.randomBytes(2).toString("hex")}`,
    title,
    icon: [...String(h?.icon ?? "").trim()].slice(0, 2).join("") || "✓",
    hue: Math.round(num(h?.hue, 0, 359, 150)),
    target,
    step: num(h?.step, 0.01, target, target <= 10 ? 1 : target / 4),
    unit: String(h?.unit ?? "").trim().slice(0, 16),
    days: Array.isArray(h?.days) ? [...new Set(h.days.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort() : [],
    goalId: typeof h?.goalId === "string" && h.goalId ? h.goalId : undefined,
    createdAt: typeof h?.createdAt === "string" ? h.createdAt : new Date().toISOString(),
    archived: h?.archived === true || undefined,
  };
}

export const listHabits = (all = false): Habit[] =>
  (readJSON<unknown[]>(habitsFile(), []) as Partial<Habit>[])
    .map(cleanHabit)
    .filter((h): h is Habit => !!h && (all || !h.archived));

export function saveHabit(input: Partial<Habit>): Habit | null {
  return withLock("habits", () => {
    const all = listHabits(true);
    const i = input.id ? all.findIndex((h) => h.id === input.id) : -1;
    const h = cleanHabit(i >= 0 ? { ...all[i], ...input, id: all[i].id, createdAt: all[i].createdAt } : { ...input, id: undefined });
    if (!h) return null;
    if (i >= 0) all[i] = h;
    else all.push(h);
    writeJSON(habitsFile(), all);
    return h;
  });
}

// Archived, not deleted: the history keeps its days.
export function archiveHabit(id: string): boolean {
  return withLock("habits", () => {
    const all = listHabits(true);
    const h = all.find((x) => x.id === id);
    if (!h) return false;
    h.archived = true;
    writeJSON(habitsFile(), all);
    return true;
  });
}

const weekday = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay();
export const scheduledOn = (h: Habit, day: string) => (!h.days.length || h.days.includes(weekday(day))) && h.createdAt.slice(0, 10) <= day;
const readDay = (day: string) => readJSON<Record<string, number>>(dayFile(day), {});
const round = (n: number) => Math.round(n * 100) / 100;

// Consecutive scheduled days done, ending today (today only counts once it's done).
export function habitStreak(h: Habit, today: string): number {
  let n = 0;
  for (let i = 0; i < 400; i++) {
    const d = addDays(today, -i);
    if (d < h.createdAt.slice(0, 10)) break;
    if (!scheduledOn(h, d)) continue;
    const done = (readDay(d)[h.id] ?? 0) >= h.target;
    if (done) n++;
    else if (i > 0) break;
  }
  return n;
}

export function habitsFor(day: string): HabitDay[] {
  const log = readDay(day);
  return listHabits()
    .filter((h) => scheduledOn(h, day))
    .map((habit) => {
      const value = log[habit.id] ?? 0;
      return { habit, value, done: value >= habit.target, streak: habitStreak(habit, day) };
    });
}

// One tap: + adds a step, − takes one back; `value` sets it outright. Kept between 0 and 3× the target.
export function logHabit(id: string, day: string, change: { delta?: number; value?: number }): HabitDay | null {
  if (!DAY.test(day)) return null;
  const h = listHabits(true).find((x) => x.id === id);
  if (!h) return null;
  withLock("habits", () => {
    const log = readDay(day);
    const next = change.value !== undefined ? Number(change.value) : (log[id] ?? 0) + Number(change.delta ?? h.step);
    log[id] = round(Math.min(h.target * 3, Math.max(0, Number.isFinite(next) ? next : 0)));
    writeJSON(dayFile(day), log);
  });
  const value = readDay(day)[id] ?? 0;
  return { habit: h, value, done: value >= h.target, streak: habitStreak(h, day) };
}

// The day's habits as one number: the share of their targets reached (each habit capped at 100%).
export function habitProgress(day: string): { done: number; total: number; ratio: number } {
  const hs = habitsFor(day);
  return { done: hs.filter((x) => x.done).length, total: hs.length, ratio: hs.length ? hs.reduce((s, x) => s + Math.min(1, x.value / x.habit.target), 0) / hs.length : 0 };
}
