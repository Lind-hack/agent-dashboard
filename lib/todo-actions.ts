import { mirrorBlock } from "./calendar";
import { calendarBusy, clockNow, coachNow, coachTz, DAY_END, DAY_START, nextFreeSlot } from "./coach";
import { activeBlocks, addBlock, readPlan, setBlockStatus, shiftDay, type StoredBlock } from "./plan-store";
import { completeTask } from "./ticktick";
import { listTodos, remainingMin, setTickTickPending, updateTodo, type Todo } from "./todos";

// Task actions shared by the Today page, the Day assistant and the coach: tick a task (its plan blocks
// and its TickTick original follow), and put a task on today's plan in a free slot.

const open = (b: StoredBlock) => b.status === "planned" || b.status === "running" || b.status === "blocked";

// The task's open blocks from today through the next week (a block moved to tomorrow counts too).
function linkedBlocks(taskId: string, from: string): { day: string; block: StoredBlock }[] {
  return Array.from({ length: 8 }, (_, i) => shiftDay(from, i)).flatMap((day) => activeBlocks(readPlan(day)).filter((b) => b.taskId === taskId && open(b)).map((block) => ({ day, block })));
}

// TickTick completion, remembered as pending when it fails so the next Today load retries it.
export async function completeInTickTick(todo: Todo): Promise<string | undefined> {
  if (!todo.ticktick) return;
  try {
    await completeTask(todo.ticktick.projectId, todo.ticktick.id);
    if (todo.ticktick.pending) setTickTickPending(todo.id, false);
  } catch (e) {
    setTickTickPending(todo.id, true);
    return `Done here; TickTick didn't take it yet (${e instanceof Error ? e.message : e}) — it'll retry.`;
  }
}

export async function finishTodo(id: string, done = true): Promise<{ todo: Todo | null; warning?: string }> {
  const before = listTodos().find((t) => t.id === id);
  const todo = updateTodo(id, { done });
  if (!todo || !done) return { todo };
  for (const { day, block } of linkedBlocks(todo.id, coachNow().day)) setBlockStatus(day, block.id, "done");
  if (before?.done && !todo.ticktick?.pending) return { todo };
  return { todo, warning: await completeInTickTick(todo) };
}

// A task deferred to a later day: its open blocks today move to tomorrow with it.
export function deferTodoBlocks(id: string) {
  const day = coachNow().day;
  for (const b of activeBlocks(readPlan(day))) if (b.taskId === id && b.status === "planned") setBlockStatus(day, b.id, "move");
}

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const toHHMM = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const validClock = (t?: string) => !!t && /^([01]\d|2[0-3]):[0-5]\d$/.test(t);

export async function scheduleTodo(id: string, opts: { start?: string; length?: number } = {}): Promise<{ block?: StoredBlock; error?: string; calendar?: boolean; existing?: boolean }> {
  const todo = listTodos().find((t) => t.id === id);
  if (!todo || todo.done) return { error: "That task is gone or already done." };
  const day = coachNow().day;
  // Once per task per day: a second tap (or a second device) gets the block that's already there.
  const already = activeBlocks(readPlan(day)).find((b) => b.taskId === id && open(b));
  if (already) return { block: already, existing: true };
  const length = Math.max(15, Math.min(240, Math.round((opts.length ?? (remainingMin(todo) || 30)) / 5) * 5));
  const busy = await calendarBusy();
  // A requested start must be a real time, today, inside the work day and clear of plan blocks and events;
  // anything else falls back to the next free slot.
  let start: string | null = null;
  if (validClock(opts.start)) {
    const s = Math.ceil(toMin(opts.start!) / 5) * 5;
    const now = toMin(clockNow(coachTz()));
    const taken = activeBlocks(readPlan(day))
      .filter((b) => b.status !== "done")
      .map((b) => [toMin(b.start), toMin(b.end)] as [number, number])
      .concat(busy);
    if (s >= Math.max(now, toMin(DAY_START())) && s + length <= toMin(DAY_END()) && !taken.some(([a, z]) => s < z && s + length > a)) start = toHHMM(s);
  }
  start ??= nextFreeSlot(length, new Date(), busy);
  if (!start) return { error: `No ${length}-minute gap left today — move something, or shorten it.` };
  start = toHHMM(Math.ceil(toMin(start) / 5) * 5);
  const block = addBlock(day, { start, length, title: todo.title, goalId: todo.goalId, taskId: todo.id, kind: "task" });
  const calendar = await mirrorBlock(day, { blockId: block.id, start: block.start, end: block.end, title: block.title, kind: "task", taskId: todo.id, goalId: todo.goalId }).catch(() => false);
  return { block, calendar };
}
