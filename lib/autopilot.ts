import fs from "node:fs";
import path from "node:path";
import { addDays, calendarConnected, replacePlan, type PlanBlock } from "./calendar";
import { clockNow, coachNow, coachTz, dayProgress } from "./coach";
import { DATA_DIR } from "./config";
import { activeBlocks, readPlan, restorePlan, savePlan, type DayPlan, type StoredBlock } from "./plan-store";
import { planDay, writePlanNote } from "./planner";
import { listTodos, setTodoDays, todosFor } from "./todos";

// Autopilot (v5.1, Lind's pick: fully automatic + undo). The runner does three things every day:
// - morning (07:30): Sol plans the day from tasks, goals and calendar and puts the blocks on Google
//   Calendar — unless Lind already made a plan for today.
// - midday (13:00): Sol re-plans the rest of the day around what's done; done and running blocks stay.
// - evening (21:20): unfinished tasks move to tomorrow.
// Each step saves a snapshot first and records what it did in data/autopilot/<day>.json, so Today can
// show it and one tap undoes it (the plan file, the calendar blocks still ahead, the tasks' days).

export type Step = "morning" | "midday" | "evening";
export type StepLog = { at: string; summary: string; blocks?: number; moved?: number; model?: string; skipped?: string; error?: string; undoneAt?: string };
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

function record(day: string, step: Step, log: StepLog) {
  const a = readAutopilot(day);
  a.steps[step] = log;
  writeJSON(logFile(day), a);
}

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const asPlanBlock = (b: StoredBlock): PlanBlock => ({ blockId: b.id, start: b.start, end: b.end, title: b.title, kind: b.kind, taskId: b.taskId, goalId: b.goalId });

// The plan file, the vault note, and the calendar blocks that are still ahead.
async function apply(day: string, blocks: PlanBlock[], summary: string, note: string): Promise<string | undefined> {
  savePlan(day, blocks, { tz: coachTz(), summary, note });
  writePlanNote(day, blocks, summary, note);
  if (!calendarConnected()) return;
  const now = toMin(clockNow());
  try {
    await replacePlan(day, blocks.filter((b) => toMin(b.end) > now));
  } catch (e) {
    return `Calendar: ${e instanceof Error ? e.message : e}`;
  }
}

function snapshot(day: string, step: Step, todoIds: string[] = []) {
  const all = new Map(listTodos().map((t) => [t.id, t]));
  const snap: Snapshot = { plan: readPlan(day), todos: todoIds.flatMap((id) => (all.has(id) ? [{ id, day: all.get(id)!.day, due: all.get(id)!.due }] : [])) };
  writeJSON(snapFile(day, step), snap);
}

export async function runMorning(): Promise<StepLog> {
  const day = coachNow().day;
  const at = new Date().toISOString();
  const existing = activeBlocks(readPlan(day));
  if (existing.length) return logged(day, "morning", { at, summary: `You'd already planned ${existing.length} blocks — I left them as they are.`, skipped: "planned" });
  const t = todosFor(day);
  snapshot(day, "morning");
  const plan = await planDay("Autopilot morning plan: plan the whole day.", { useSol: true });
  if (!plan.blocks.length) return logged(day, "morning", { at, summary: plan.summary || "Nothing to plan.", error: "no blocks", model: plan.model });
  const err = await apply(day, plan.blocks, plan.summary, "Planned by Autopilot (morning)");
  return logged(day, "morning", { at, summary: plan.summary || `${plan.blocks.length} blocks for ${t.today.length + t.overdue.length} tasks.`, blocks: plan.blocks.length, model: plan.model, error: err });
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
  const keep = blocks.filter((b) => b.status === "done" || b.status === "running" || (b.status !== "planned" && b.end <= now)).map(asPlanBlock);
  snapshot(day, "midday");
  const note = `Autopilot midday re-plan. ${p.percent}% of today's work is done (aim ~${p.expected}%), ${p.workLeftMin} minutes of task work left and ${p.freeMin} free minutes before the day ends.${p.overloadMin ? " It doesn't all fit: keep the most important, leave the rest out and say what was left out." : ""} Plan only from now on.`;
  const plan = await planDay(note, { useSol: true, keep });
  const fresh = plan.blocks.filter((b) => !keep.some((k) => k.blockId === b.blockId));
  if (!fresh.length) return logged(day, "midday", { at, summary: plan.summary || "No free time left to re-plan.", error: "no blocks", model: plan.model });
  const err = await apply(day, plan.blocks, plan.summary, "Re-planned by Autopilot (midday)");
  return logged(day, "midday", { at, summary: plan.summary, blocks: fresh.length, model: plan.model, error: err });
}

export function runEvening(): StepLog {
  const day = coachNow().day;
  const at = new Date().toISOString();
  const t = todosFor(day);
  const open = [...t.overdue, ...t.today];
  if (!open.length) return logged(day, "evening", { at, summary: t.done.length ? `All ${t.done.length} tasks done today.` : "No open tasks to move.", moved: 0 });
  snapshot(day, "evening", open.map((x) => x.id));
  const tomorrow = addDays(day, 1);
  setTodoDays(open.map((x) => ({ id: x.id, day: tomorrow, due: x.due })));
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
  restorePlan(day, snap.plan);
  if (snap.todos.length) setTodoDays(snap.todos);
  let error: string | undefined;
  if (step !== "evening" && calendarConnected()) {
    const now = toMin(clockNow());
    await replacePlan(day, activeBlocks(snap.plan).filter((b) => toMin(b.end) > now).map(asPlanBlock)).catch((e) => (error = `Calendar: ${e instanceof Error ? e.message : e}`));
  }
  record(day, step, { ...log, undoneAt: new Date().toISOString() });
  return { ok: true, error };
}
