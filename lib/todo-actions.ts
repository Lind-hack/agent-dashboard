import { mirrorBlock } from "./calendar";
import { calendarBusy, coachNow, nextFreeSlot } from "./coach";
import { activeBlocks, addBlock, readPlan, setBlockStatus, type StoredBlock } from "./plan-store";
import { completeTask } from "./ticktick";
import { listTodos, remainingMin, updateTodo, type Todo } from "./todos";

// Task actions shared by the Today page, the Day assistant and the coach: tick a task (its plan block
// and its TickTick original follow), and put a task on today's plan in the next free slot.

export async function finishTodo(id: string, done = true): Promise<{ todo: Todo | null; warning?: string }> {
  const before = listTodos().find((t) => t.id === id);
  const todo = updateTodo(id, { done });
  if (!todo || !done || before?.done) return { todo };
  const day = coachNow().day;
  for (const b of activeBlocks(readPlan(day))) if (b.taskId === todo.id && b.status !== "done") setBlockStatus(day, b.id, "done");
  if (todo.ticktick) {
    try {
      await completeTask(todo.ticktick.projectId, todo.ticktick.id);
    } catch (e) {
      return { todo, warning: `Done here, but TickTick didn't take it: ${e instanceof Error ? e.message : e}` };
    }
  }
  return { todo };
}

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const toHHMM = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export async function scheduleTodo(id: string, opts: { start?: string; length?: number } = {}): Promise<{ block?: StoredBlock; error?: string; calendar?: boolean }> {
  const todo = listTodos().find((t) => t.id === id);
  if (!todo || todo.done) return { error: "That task is gone or already done." };
  const length = Math.max(15, Math.min(240, Math.round((opts.length ?? (remainingMin(todo) || 30)) / 5) * 5));
  const day = coachNow().day;
  const busy = await calendarBusy();
  let start = opts.start && /^\d{2}:\d{2}$/.test(opts.start) ? opts.start : nextFreeSlot(length, new Date(), busy);
  // A deadline earlier than the slot found: still schedule, but say so.
  if (!start) return { error: `No ${length}-minute gap left today — move something, or shorten it.` };
  start = toHHMM(Math.ceil(toMin(start) / 5) * 5);
  const block = addBlock(day, { start, length, title: todo.title, goalId: todo.goalId, taskId: todo.id, kind: "task" });
  const calendar = await mirrorBlock(day, { blockId: block.id, start: block.start, end: block.end, title: block.title, kind: "task", taskId: todo.id, goalId: todo.goalId }).catch(() => false);
  return { block, calendar };
}
