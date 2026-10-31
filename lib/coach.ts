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

// The zone's offset from UTC (ms) at an instant.
function offsetAt(ms: number, tz: string): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date(ms))
      .map((x) => [x.type, x.value]),
  );
  return Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:00Z`) - Math.floor(ms / 60_000) * 60_000;
}

// "HH:MM" on a day in a time zone → epoch ms. Two passes, so the offset is the one in force at the
// resulting instant (right on DST change days); a time skipped by the change lands an hour later.
export function zonedMs(day: string, hhmm: string, tz = coachTz()): number {
  const wall = Date.parse(`${day}T${hhmm}:00Z`);
  const first = wall - offsetAt(wall, tz);
  return wall - offsetAt(first, tz);
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
  blocks: NowBlock[]; // every block today that isn't done (what /focus?block= may open)
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
    blocks: open,
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
// `busy` = extra [startMin, endMin] intervals that aren't in the plan (calendar events).
export function nextFreeSlot(length: number, at = new Date(), busyExtra: [number, number][] = []): string | null {
  const tz = coachTz();
  const day = dayString(tz, at);
  const now = Math.max(toMin(clockNow(tz, at)), toMin(DAY_START()));
  const end = toMin(DAY_END());
  // Round up to the next 5 minutes so blocks start on a clean mark.
  let t = Math.ceil(now / 5) * 5;
  const busy = activeBlocks(readPlan(day))
    .filter((b) => b.status !== "done")
    .map((b) => [toMin(b.start), toMin(b.end)] as const)
    .concat(busyExtra);
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

// Today's timed calendar events as busy minutes (so "Plan into today" never lands on a class).
export async function calendarBusy(): Promise<[number, number][]> {
  const { agenda, calendarConnected } = await import("./calendar");
  if (!calendarConnected()) return [];
  const tz = coachTz();
  const day = dayString(tz);
  const a = await agenda(1).catch(() => null);
  return (a?.events ?? [])
    .filter((e) => !e.allDay && !e.planned && dayString(tz, new Date(e.start)) === day)
    .map((e) => [toMin(clockNow(tz, new Date(e.start))), Math.max(toMin(clockNow(tz, new Date(e.start))) + 5, dayString(tz, new Date(e.end)) === day ? toMin(clockNow(tz, new Date(e.end))) : 24 * 60)] as [number, number]);
}

// ---- the day's progress (v5) -------------------------------------------------------------------------

export type DayProgress = {
  day: string;
  percent: number; // share of today's work done (tasks weighted by estimate; blocks when there are no tasks)
  tasksDone: number;
  tasksTotal: number;
  workLeftMin: number; // estimated minutes still to do on open tasks
  untilEndMin: number; // minutes from now to the end of the work day
  freeMin: number; // of those, minutes not taken by calendar events
  overloadMin: number; // work left that can't fit in the free time left today (0 = it fits)
  expected: number; // where the percent "should" be by now, from the share of the work day gone
  pace: "ahead" | "on-pace" | "behind" | "not-started";
  blocksDone: number;
  blocksTotal: number;
  focusMin: number;
  next?: { id: string; title: string; dueAt?: string }; // most urgent open task
  // Time blocking (v5.1): when there's a plan, pace comes from it — the block minutes that should be
  // behind you by now vs the ones you actually did.
  blocks?: { dueMin: number; doneMin: number; behindMin: number; missed: { id: string; title: string; start: string; end: string }[] };
};

// Planned block minutes due by `nowMin` vs. done: a running block counts its real minutes so far, a done
// block its real length (both capped at what was planned to have passed), breaks don't count.
export function blockPace(blocks: StoredBlock[], nowMin: number, nowMs: number): NonNullable<DayProgress["blocks"]> {
  let dueMin = 0;
  let doneMin = 0;
  const missed: { id: string; title: string; start: string; end: string }[] = [];
  for (const b of blocks) {
    if (b.kind === "break") continue;
    const s = toMin(b.start);
    const e = toMin(b.end);
    if (s >= nowMin) continue;
    const due = Math.min(nowMin, e) - s;
    dueMin += due;
    if (b.status === "done") doneMin += Math.min(due, blockMinutes(b) || due);
    else if (b.status === "running") doneMin += Math.min(due, Math.max(0, Math.round((nowMs - Date.parse(b.startedAt ?? new Date(nowMs).toISOString())) / 60_000)));
    else if (e <= nowMin && b.status === "planned") missed.push({ id: b.id, title: b.title, start: b.start, end: b.end });
  }
  return { dueMin, doneMin, behindMin: Math.max(0, dueMin - doneMin), missed };
}

export async function dayProgress(at = new Date()): Promise<DayProgress> {
  const { todosFor, remainingMin } = await import("./todos");
  const tz = coachTz();
  const day = dayString(tz, at);
  const c = coachNow(at);
  const t = todosFor(day);
  const open = [...t.overdue, ...t.today];
  const doneEst = t.done.reduce((s, x) => s + x.estimateMin, 0);
  const openEst = open.reduce((s, x) => s + x.estimateMin, 0);
  const workLeftMin = open.reduce((s, x) => s + remainingMin(x), 0);
  const total = doneEst + openEst;
  const percent = total ? Math.round((100 * (total - workLeftMin)) / total) : c.total ? Math.round((100 * c.done) / c.total) : 0;
  const nowMin = toMin(clockNow(tz, at));
  const start = toMin(DAY_START());
  const end = toMin(DAY_END());
  const from = Math.max(nowMin, start);
  const untilEndMin = Math.max(0, end - from);
  // Calendar events between now and the end of the day aren't time for tasks.
  const busy = (await calendarBusy().catch(() => [] as [number, number][])).map(([a, z]) => [Math.max(a, from), Math.min(z, end)] as const).filter(([a, z]) => z > a).sort((x, y) => x[0] - y[0]);
  let taken = 0;
  let edge = from;
  for (const [a, z] of busy) {
    taken += Math.max(0, z - Math.max(a, edge));
    edge = Math.max(edge, z);
  }
  const freeMin = Math.max(0, untilEndMin - taken);
  const expected = Math.round(100 * Math.min(1, Math.max(0, (nowMin - start) / Math.max(1, end - start))));
  const any = total > 0 || c.total > 0;
  const bp = blockPace(activeBlocks(readPlan(day)), nowMin, at.getTime());
  const timeBlocked = bp.dueMin >= 15;
  const pace = timeBlocked
    ? bp.doneMin >= bp.dueMin * 1.1 && bp.doneMin - bp.dueMin >= 10
      ? "ahead"
      : bp.behindMin <= Math.max(15, bp.dueMin * 0.15)
        ? "on-pace"
        : "behind"
    : !any || (percent === 0 && nowMin < start + 60)
      ? "not-started"
      : percent >= expected + 10
        ? "ahead"
        : percent >= expected - 10
          ? "on-pace"
          : "behind";
  const urgent = open.slice().sort((a, z) => (a.due ?? "9999").localeCompare(z.due ?? "9999") || z.priority - a.priority)[0];
  return {
    day,
    percent,
    tasksDone: t.done.length,
    tasksTotal: t.done.length + open.length,
    workLeftMin,
    untilEndMin,
    freeMin,
    overloadMin: Math.max(0, workLeftMin - freeMin),
    expected,
    pace,
    blocksDone: c.done,
    blocksTotal: c.total,
    focusMin: c.focusMin,
    next: urgent ? { id: urgent.id, title: urgent.title, dueAt: urgent.due } : undefined,
    blocks: timeBlocked ? bp : undefined,
  };
}
