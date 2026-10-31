import fs from "node:fs";
import path from "node:path";
import { addDays, calendarConnected, replacePlan, type PlanBlock } from "./calendar";
import { clockNow, coachNow, coachTz, dayProgress } from "./coach";
import { DATA_DIR } from "./config";
import { withLock } from "./file-lock";
import { activeBlocks, readPlan, restorePlan, savePlanIf, type DayPlan, type StoredBlock } from "./plan-store";
import { planDay, writePlanNote } from "./planner";
import { rolloverOpen, setTodoDays, todosFor } from "./todos";

// Autopilot (v5.1, Lind's pick: fully automatic + undo). The runner does three things every day:
// - morning (07:30): Sol plans the day from tasks, goals and calendar and puts the blocks on Google
//   Calendar — unless Lind already made a plan for today.
// - midday (13:00): Sol re-plans the rest of the day around what's done; done and running blocks stay.
// - evening (21:20): unfinished tasks move to tomorrow.
// Each step saves a snapshot first and records what it did in data/autopilot/<day>.json, so Today can
// show it and one tap undoes it (the plan file, the calendar blocks still ahead, the tasks' days).

export type Step = "morning" | "midday" | "evening";
// failed: retryable (the runner tries again); calendarPending: the plan is saved but the calendar
// write failed, so only that is retried.
export type StepLog = { at: string; summary: string; blocks?: number; moved?: number; model?: string; skipped?: string; error?: string; failed?: boolean; calendarPending?: boolean; undoneAt?: string };
export type AutopilotDay = { day: string; steps: Partial<Record<Step, StepLog>> };
type Snapshot = { plan: DayPlan | null; todos: { id: string; day: string; due?: string }[] };

const dir = () => path.join(DATA_DIR, "autopilot");
const logFile = (day: string) => path.join(dir(), `${day}.json`);
const snapFile = (day: string, step: Step) => path.join(dir(), `${day}-${step}.snapshot.json`);
const settingsFile = () => path.join(dir(), "settings.json");

function writeJSON(f: string, v: unknown) {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(`${f}.${process.pid}.tmp`, JSON.stringify(v, null, 2));
  fs.renameSync(`${f}.${process.pid}.tmp`, f);
}
function readJSON<T>(f: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(f, "utf8")) ?? fallback;
  } catch {
    return fallback;
  }
}

export const autopilotEnabled = () => process.env.AUTOPILOT_ENABLED !== "0" && readJSON<{ enabled?: boolean }>(settingsFile(), {}).enabled !== false;
export const setAutopilotEnabled = (enabled: boolean) => writeJSON(settingsFile(), { enabled });
export const readAutopilot = (day: string): AutopilotDay => ({ day, steps: readJSON<AutopilotDay>(logFile(day), { day, steps: {} }).steps ?? {} });

// The day's log is changed by the runner (steps) and the web app (Undo): always under its lock.
function record(day: string, step: Step, log: StepLog | ((prev: StepLog | undefined) => StepLog)) {
  withLock(`autopilot-${day}`, () => {
    const a = readAutopilot(day);
    a.steps[step] = typeof log === "function" ? log(a.steps[step]) : log;
    writeJSON(logFile(day), a);
  });
}
export const markStep = (day: string, step: Step, log: StepLog) => record(day, step, log);

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const asPlanBlock = (b: StoredBlock): PlanBlock => ({ blockId: b.id, start: b.start, end: b.end, title: b.title, kind: b.kind, taskId: b.taskId, goalId: b.goalId });

// The calendar blocks still ahead, from the saved plan.
export async function syncCalendar(day: string): Promise<string | undefined> {
  if (!calendarConnected()) return;
  const now = toMin(clockNow());
  try {
    await replacePlan(day, activeBlocks(readPlan(day)).filter((b) => toMin(b.end) > now).map(asPlanBlock));
  } catch (e) {
    return `Calendar: ${e instanceof Error ? e.message : e}`;
  }
}

// Saves the plan only if `guard` still agrees with the plan as it is now (see savePlanIf), then the
// vault note and the calendar. Returns null when the guard declined.
async function apply(day: string, guard: (current: DayPlan | null) => PlanBlock[] | null, summary: string, note: string): Promise<{ blocks: PlanBlock[]; calendarError?: string } | null> {
  let saved: PlanBlock[] = [];
  const plan = savePlanIf(
    day,
    (current) => {
      const b = guard(current);
      if (b) {
        // The snapshot for Undo is the plan exactly as it was when this one replaced it.
        writeJSON(snapFile(day, note.includes("midday") ? "midday" : "morning"), { plan: current, todos: [] } satisfies Snapshot);
        saved = b;
      }
      return b;
    },
    { tz: coachTz(), summary, note },
  );
  if (!plan) return null;
  writePlanNote(day, saved, summary, note);
  return { blocks: saved, calendarError: await syncCalendar(day) };
}

export async function runMorning(): Promise<StepLog> {
  const day = coachNow().day;
  const at = new Date().toISOString();
  const existing = activeBlocks(readPlan(day));
  if (existing.length) return logged(day, "morning", { at, summary: `You'd already planned ${existing.length} blocks — I left them as they are.`, skipped: "planned" });
  const t = todosFor(day);
  const plan = await planDay("Autopilot morning plan: plan the whole day.", { useSol: true });
  if (!plan.blocks.length) return logged(day, "morning", { at, summary: plan.summary || "Nothing to plan.", error: "no blocks", failed: true, model: plan.model });
  // Lind may have planned while Sol was thinking: then his plan wins.
  const r = await apply(day, (current) => (activeBlocks(current).length ? null : plan.blocks), plan.summary, "Planned by Autopilot (morning)");
  if (!r) return logged(day, "morning", { at, summary: "You made a plan while I was working on one — I kept yours.", skipped: "planned" });
  return logged(day, "morning", { at, summary: plan.summary || `${r.blocks.length} blocks for ${t.today.length + t.overdue.length} tasks.`, blocks: r.blocks.length, model: plan.model, error: r.calendarError, calendarPending: !!r.calendarError });
}

export async function runMidday(): Promise<StepLog> {
  const day = coachNow().day;
  const at = new Date().toISOString();
  const blocks = activeBlocks(readPlan(day));
  const p = await dayProgress();
  if (!blocks.length && !p.tasksTotal) return logged(day, "midday", { at, summary: "Nothing planned and no tasks — nothing to re-plan.", skipped: "empty" });
  const now = clockNow();
  // Kept: everything done, and whatever is running now. Planned blocks that are over and weren't done
  // drop out (they become "dropped" history); the rest of the day is planned again around the keepers.
  const protect = (b: StoredBlock) => b.status === "done" || b.status === "running" || (b.status !== "planned" && b.end <= now);
  const keep = blocks.filter(protect).map(asPlanBlock);
  const note = `Autopilot midday re-plan. ${p.percent}% of today's work is done (aim ~${p.expected}%), ${p.workLeftMin} minutes of task work left and ${p.freeMin} free minutes before the day ends.${p.overloadMin ? " It doesn't all fit: keep the most important, leave the rest out and say what was left out." : ""} Plan only from now on.`;
  const plan = await planDay(note, { useSol: true, keep });
  const fresh = plan.blocks.filter((b) => !keep.some((k) => k.blockId === b.blockId));
  if (!fresh.length) return logged(day, "midday", { at, summary: plan.summary || "No free time left to re-plan.", error: "no blocks", failed: true, model: plan.model });
  // Against the plan as it is now: anything started, finished or added by hand since stays, and new
  // blocks that would overlap it are left out.
  const r = await apply(
    day,
    (current) => {
      const ids = new Set(plan.blocks.map((b) => b.blockId));
      const stay = activeBlocks(current)
        .filter((b) => !ids.has(b.id) && (protect(b) || b.updatedAt! > at))
        .map(asPlanBlock);
      const clash = (x: PlanBlock) => stay.some((s) => toMin(x.start) < toMin(s.end) && toMin(x.end) > toMin(s.start));
      return [...stay, ...plan.blocks.filter((b) => keep.some((k) => k.blockId === b.blockId) || !clash(b))].sort((a, z) => a.start.localeCompare(z.start));
    },
    plan.summary,
    "Re-planned by Autopilot (midday)",
  );
  return logged(day, "midday", { at, summary: plan.summary, blocks: r ? r.blocks.length - keep.length : 0, model: plan.model, error: r?.calendarError, calendarPending: !!r?.calendarError });
}

export function runEvening(): StepLog {
  const day = coachNow().day;
  const at = new Date().toISOString();
  const t = todosFor(day);
  // Picked, remembered and moved in one locked step, so a task ticked a moment ago isn't moved.
  const open = rolloverOpen(day, addDays(day, 1));
  if (!open.length) return logged(day, "evening", { at, summary: t.done.length ? `All ${t.done.length} tasks done today.` : "No open tasks to move.", moved: 0 });
  writeJSON(snapFile(day, "evening"), { plan: null, todos: open.map((x) => ({ id: x.id, day: x.day, due: x.due })) } satisfies Snapshot);
  return logged(day, "evening", { at, summary: `Moved ${open.length} unfinished task${open.length > 1 ? "s" : ""} to tomorrow: ${open.slice(0, 3).map((x) => x.title).join(", ")}${open.length > 3 ? "…" : ""}.`, moved: open.length });
}

function logged(day: string, step: Step, log: StepLog): StepLog {
  record(day, step, log);
  return log;
}

// Undo a step: plan file and tasks back to the snapshot, the calendar's future blocks rewritten to match.
export async function undoStep(day: string, step: Step): Promise<{ ok: boolean; error?: string }> {
  const log = readAutopilot(day).steps[step];
  const snap = readJSON<Snapshot | null>(snapFile(day, step), null);
  if (!log || !snap || log.undoneAt || log.skipped) return { ok: false, error: "Nothing to undo for that step." };
  // Mark it undone first (under the log's lock), so a second tap or the runner can't act on it again.
  let already = false;
  record(day, step, (prev) => {
    already = !!prev?.undoneAt;
    return { ...(prev ?? log), undoneAt: prev?.undoneAt ?? new Date().toISOString() };
  });
  if (already) return { ok: false, error: "Already undone." };
  // The evening step only moved tasks: its Undo touches only tasks (the plan may have changed since).
  if (step === "evening") {
    if (snap.todos.length) setTodoDays(snap.todos);
    return { ok: true };
  }
  restorePlan(day, snap.plan);
  return { ok: true, error: await syncCalendar(day) };
}
