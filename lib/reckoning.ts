import fs from "node:fs";
import path from "node:path";
import { keptStreak, mirror, type Mirror } from "./accountability";
import { addDays } from "./calendar";
import { clockNow, coachNow, coachTz } from "./coach";

import { tally } from "./day-tally";
import { habitProgress } from "./habits";
import { VERDICT_WORDS, type DayVerdict } from "./verdict";
import { dataDir } from "./tenant";

export { VERDICT_WORDS, type DayVerdict };

// The reckoning (v5.2, Lind: "a reality check of did I do enough today or I didn't do shit"). Every
// day ends with a verdict from the mirror — ENOUGH, NOT ENOUGH, SOFT, or NO PLAN — and Lind has to
// answer for it before the app opens again: what happened, what's the excuse. His answer and the
// coach's reply are kept per day in data/coach/reckoning/<day>.json, so the wall of days shows every
// day he showed up and every day he softened.

export type Reckoning = {
  day: string;
  verdict: DayVerdict;
  saidMin: number; // minutes of blocks he planned (breaks aside) — kept for old days; not shown since v5.4
  didMin: number; // minutes of those he really did
  // v5.4 (Lind: "count the tasks I did, not the minutes"): the day's habits, tasks and blocks, each once,
  // and how many got done. The verdict comes from these.
  itemsDone?: number;
  itemsTotal?: number;
  blocks: number;
  done: number;
  missed: number;
  late: number;
  onTimeRate: number;
  streak: number;
  habitsDone?: number;
  habitsTotal?: number;
  answer?: string;
  answeredAt?: string;
  reply?: string;
};

const dir = () => path.join(dataDir(), "coach", "reckoning");
const file = (day: string) => path.join(dir(), `${day}.json`);
// The first day the reckoning ran: days before it are never asked about.
const sinceFile = () => path.join(dir(), "since");
export const RECKON_AT = () => process.env.RECKON_AT ?? "21:30";


// The verdict, from the numbers only. ENOUGH: the day was kept, or 90%+ of the planned time done with
// nothing missed. SOFT: under half the planned time, or half the blocks missed. NOT ENOUGH: between.
// While the day is still on, only the blocks already due count ("so far").
export function verdictOf(m: Mirror): Pick<Reckoning, "verdict" | "saidMin" | "didMin"> {
  const rows = m.over ? m.rows : m.rows.filter((r) => r.verdict !== "upcoming");
  const saidMin = rows.reduce((s, r) => s + r.plannedMin, 0);
  const didMin = rows.reduce((s, r) => s + (r.actualMin !== undefined ? Math.min(r.actualMin, r.plannedMin * 1.5) : 0), 0);
  if (!m.rows.length) return { verdict: "no-plan", saidMin, didMin };
  if (!rows.length) return { verdict: "pending", saidMin, didMin };
  const ratio = saidMin ? didMin / saidMin : 0;
  const missedAll = m.missed + m.notStarted;
  if (m.kept || (ratio >= 0.9 && missedAll === 0 && m.unfinished === 0)) return { verdict: "enough", saidMin, didMin: Math.round(didMin) };
  if (ratio < 0.5 || missedAll * 2 >= rows.length) return { verdict: "soft", saidMin, didMin: Math.round(didMin) };
  return { verdict: "not-enough", saidMin, didMin: Math.round(didMin) };
}

export function snapshot(day: string, nowMs = Date.now()): Reckoning {
  const m = mirror(day, nowMs);
  const hp = habitProgress(day);
  const t = tally(day, nowMs);
  return {
    day,
    ...verdictOf(m),
    verdict: t.verdict,
    itemsDone: t.done,
    itemsTotal: t.total,
    blocks: m.rows.length,
    done: m.done,
    missed: m.missed + m.notStarted,
    late: m.late,
    onTimeRate: m.onTimeRate,
    streak: keptStreak(day, coachTz(), nowMs).days,
    habitsDone: hp.done,
    habitsTotal: hp.total,
  };
}

export function readReckoning(day: string): Reckoning | null {
  try {
    const r = JSON.parse(fs.readFileSync(file(day), "utf8")) as Reckoning;
    return r?.day ? r : null;
  } catch {
    return null;
  }
}

function write(r: Reckoning) {
  fs.mkdirSync(dir(), { recursive: true });
  fs.writeFileSync(`${file(r.day)}.${process.pid}.tmp`, JSON.stringify(r, null, 2));
  fs.renameSync(`${file(r.day)}.${process.pid}.tmp`, file(r.day));
}

function since(today: string): string {
  try {
    return fs.readFileSync(sinceFile(), "utf8").trim() || today;
  } catch {
    fs.mkdirSync(dir(), { recursive: true });
    fs.writeFileSync(sinceFile(), today);
    return today;
  }
}

// Which day Lind still owes an answer for, if any: yesterday (never answered — first thing in the
// morning), else today once it's over (after RECKON_AT, or from 19:00 when every block is behind him).
export function reckoningDue(at = new Date()): Reckoning | null {
  const today = coachNow(at).day;
  const first = since(today);
  const y = addDays(today, -1);
  if (y >= first && !readReckoning(y)?.answeredAt) return snapshot(y, Number.MAX_SAFE_INTEGER);
  if (readReckoning(today)?.answeredAt) return null;
  // The first day on the dashboard is for setting it up: no one answers for a day they never planned.
  if (today === first) return null;
  const now = clockNow(coachTz(), at);
  const m = mirror(today, at.getTime());
  if (now >= RECKON_AT() || (now >= "19:00" && m.over)) return snapshot(today, at.getTime());
  return null;
}

// His answer, with the numbers as they stood when he gave it.
export function answer(day: string, text: string, reply?: string): Reckoning {
  const done = day < coachNow().day;
  const r: Reckoning = { ...snapshot(day, done ? Number.MAX_SAFE_INTEGER : Date.now()), answer: text.trim().slice(0, 4000), answeredAt: new Date().toISOString(), reply: reply?.trim().slice(0, 2000) || undefined };
  write(r);
  return r;
}

// The wall: the last `n` days, oldest first. Every day's colour is its count verdict (v5.4) — things
// done of things on the day — so the wall reads the same as the mirror, whatever was stored back then.
export function wall(n = 56, at = new Date()): { day: string; verdict: DayVerdict | null; answered: boolean }[] {
  const today = coachNow(at).day;
  return Array.from({ length: n }, (_, i) => addDays(today, i - n + 1)).map((day) => {
    const r = readReckoning(day);
    if (day === today && !r) return { day, verdict: null, answered: false };
    const t = tally(day, Number.MAX_SAFE_INTEGER);
    return { day, verdict: t.total ? t.verdict : (r?.verdict ?? null), answered: !!r?.answeredAt };
  });
}
