import fs from "node:fs";
import path from "node:path";
import { addDays, dayString } from "./calendar";
import { DATA_DIR } from "./config";
import { activeGoals, readGoals, type Goal } from "./goals";
import { activeBlocks, blockMinutes, daysOfWeek, readPlan, type Mood, type StoredBlock } from "./plan-store";

// The Coach (v4): what Lind should be doing this minute, how each goal is moving this week, and how
// the day went. Shared by the web app (focus bar, /focus, /goals) and the runner (pushes, recap).

export const coachTz = () => process.env.DASHBOARD_TZ ?? "Europe/Belgrade";
export const DAY_START = () => process.env.PLAN_DAY_START ?? "08:00";
export const DAY_END = () => process.env.PLAN_DAY_END ?? "23:00";

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
export const clockNow = (tz = coachTz(), at = new Date()) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at);

// "HH:MM" on a day in a time zone → epoch ms.
export function zonedMs(day: string, hhmm: string, tz = coachTz()): number {
  const guess = Date.parse(`${day}T${hhmm}:00Z`);
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date(guess))
      .map((x) => [x.type, x.value]),
  );
  const shown = Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:00Z`);
  return guess - (shown - guess);
}

export type NowBlock = StoredBlock & { startMs: number; endMs: number; goal?: { id: string; title: string; why: string } };
export type CoachNow = {
  day: string;
  tz: string;
  now: number;
  current: NowBlock | null; // the block whose time it is (running or not started yet)
  next: NowBlock | null;
  planned: boolean; // is there a plan for today at all
  done: number;
  total: number;
  focusMin: number; // done focus minutes today
};

export function coachNow(at = new Date()): CoachNow {
  const tz = coachTz();
  const day = dayString(tz, at);
  const plan = readPlan(day);
  const goals = new Map(readGoals().map((g) => [g.id, g]));
  const blocks: NowBlock[] = activeBlocks(plan)
    .map((b) => {
      const g = b.goalId ? goals.get(b.goalId) : undefined;
      return { ...b, startMs: zonedMs(day, b.start, tz), endMs: zonedMs(day, b.end, tz), goal: g ? { id: g.id, title: g.title, why: g.why } : undefined };
    })
    .sort((a, z) => a.startMs - z.startMs);
  const now = at.getTime();
  const open = blocks.filter((b) => b.status !== "done" && b.kind !== "break");
  // A running block wins even if its time is up (Lind is still on it); else the one whose window this is.
  const current = open.find((b) => b.status === "running") ?? open.find((b) => b.startMs <= now && b.endMs > now) ?? null;
  const next = open.find((b) => b !== current && b.startMs > now) ?? null;
  const doneBlocks = blocks.filter((b) => b.status === "done");
  return {
    day,
    tz,
    now,
    current,
    next,
    planned: blocks.length > 0,
    done: doneBlocks.length,
    total: blocks.length,
    focusMin: doneBlocks.filter((b) => b.kind !== "break").reduce((s, b) => s + blockMinutes(b), 0),
  };
}

// ---- goal progress ---------------------------------------------------------------------------------

export type GoalProgress = {
  goal: Goal;
  weekMin: number; // focus minutes done on it this week
  targetMin: number; // weekly target (default 4 h for now/short goals)
  todayDoneMin: number;
  todayPlannedMin: number; // still ahead today
  streak: number; // consecutive days (to today) with a done block for it
  lastWorked?: string; // day
  days: { day: string; min: number }[]; // the last 7 days
};

const DEFAULT_TARGET = 240;

export function goalProgress(at = new Date()): GoalProgress[] {
  const tz = coachTz();
  const today = dayString(tz, at);
  const week = new Set(daysOfWeek(today));
  const last7 = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6));
  const look = Array.from({ length: 60 }, (_, i) => addDays(today, -i));
  const plans = new Map(look.map((d) => [d, activeBlocks(readPlan(d))]));
  const nowClock = clockNow(tz, at);
  return readGoals()
    .filter((g) => !g.done)
    .map((goal) => {
      const doneOn = (d: string) => (plans.get(d) ?? []).filter((b) => b.goalId === goal.id && b.status === "done").reduce((s, b) => s + blockMinutes(b), 0);
      let streak = 0;
      for (let i = 0; i < look.length; i++) {
        if (doneOn(look[i]) > 0) streak++;
        else if (i > 0) break;
      }
      const todayBlocks = plans.get(today) ?? [];
      return {
        goal,
        weekMin: [...week].reduce((s, d) => s + doneOn(d), 0),
        targetMin: goal.weeklyMin ?? (goal.horizon === "long" ? 60 : DEFAULT_TARGET),
        todayDoneMin: doneOn(today),
        todayPlannedMin: todayBlocks
          .filter((b) => b.goalId === goal.id && b.status !== "done" && b.end > nowClock)
          .reduce((s, b) => s + Math.max(0, toMin(b.end) - Math.max(toMin(b.start), toMin(nowClock))), 0),
        streak,
        lastWorked: look.find((d) => doneOn(d) > 0),
        days: last7.map((day) => ({ day, min: doneOn(day) })),
      };
    })
    .sort((a, z) => (a.goal.horizon === z.goal.horizon ? 0 : a.goal.horizon === "now" ? -1 : z.goal.horizon === "now" ? 1 : a.goal.horizon === "short" ? -1 : 1));
}

// The first free slot today from now (or from the day's start) that fits `length` minutes.
export function nextFreeSlot(length: number, at = new Date()): string | null {
  const tz = coachTz();
  const day = dayString(tz, at);
  const now = Math.max(toMin(clockNow(tz, at)), toMin(DAY_START()));
  const end = toMin(DAY_END());
  // Round up to the next 5 minutes so blocks start on a clean mark.
  let t = Math.ceil(now / 5) * 5;
  const busy = activeBlocks(readPlan(day))
    .filter((b) => b.status !== "done")
    .map((b) => [toMin(b.start), toMin(b.end)] as const);
  while (t + length <= end) {
    const clash = busy.find(([s, e]) => t < e && t + length > s);
    if (!clash) return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
    t = Math.ceil(clash[1] / 5) * 5;
  }
  return null;
}

// ---- the day's recap ---------------------------------------------------------------------------------

export type Recap = {
  day: string;
  score: number; // 0–100: blocks done, focus time vs plan, goal coverage
  done: number;
  total: number;
  focusMin: number;
  plannedMin: number;
  skipped: string[];
  moods: Record<Mood, number>;
  goals: { id: string; title: string; min: number }[];
  note?: string; // the Coach's words, written by the runner
  createdAt: string;
};

const recapFile = (day: string) => path.join(DATA_DIR, "coach", `recap-${day}.json`);

export function readRecap(day: string): Recap | null {
  try {
    return JSON.parse(fs.readFileSync(recapFile(day), "utf8"));
  } catch {
    return null;
  }
}

export function buildRecap(day: string): Recap {
  const blocks = activeBlocks(readPlan(day)).filter((b) => b.kind !== "break");
  const done = blocks.filter((b) => b.status === "done");
  const focusMin = done.reduce((s, b) => s + blockMinutes(b), 0);
  const plannedMin = blocks.reduce((s, b) => s + Math.max(0, toMin(b.end) - toMin(b.start)), 0);
  const moods: Record<Mood, number> = { "on-track": 0, stuck: 0, distracted: 0 };
  for (const b of blocks) for (const c of b.checkins ?? []) moods[c.mood]++;
  const active = activeGoals();
  const goals = active.map((g) => ({ id: g.id, title: g.title, min: done.filter((b) => b.goalId === g.id).reduce((s, b) => s + blockMinutes(b), 0) }));
  const covered = active.length ? goals.filter((g) => g.min > 0).length / active.length : 1;
  const score = blocks.length ? Math.round(100 * (0.45 * (done.length / blocks.length) + 0.35 * Math.min(1, focusMin / Math.max(1, plannedMin)) + 0.2 * covered)) : 0;
  return {
    day,
    score,
    done: done.length,
    total: blocks.length,
    focusMin,
    plannedMin,
    skipped: blocks.filter((b) => b.status !== "done").map((b) => `${b.start} ${b.title}`),
    moods,
    goals,
    createdAt: new Date().toISOString(),
  };
}

export function saveRecap(r: Recap) {
  fs.mkdirSync(path.dirname(recapFile(r.day)), { recursive: true });
  fs.writeFileSync(`${recapFile(r.day)}.tmp`, JSON.stringify(r, null, 2));
  fs.renameSync(`${recapFile(r.day)}.tmp`, recapFile(r.day));
}
