import type { PlanBlock } from "./calendar";
import { addTodo, listTodos } from "./todos";

// A work block reserves time for a real task. Routines, breaks and appointments are not task work.
// Replanning reuses the task, even if the work is split into several sessions.
export function linkPlanTasks(day: string, blocks: PlanBlock[]): PlanBlock[] {
  return blocks.map((b) => {
    if (b.kind === "break" || b.kind === "routine") return { ...b, taskId: undefined };
    if (b.taskId) {
      // A deleted task must not be resurrected by replanning an old reservation.
      return listTodos().some((t) => t.id === b.taskId) ? b : { ...b, taskId: undefined, kind: "focus" };
    }
    if (b.kind !== "task") return b;
    const found = listTodos().find((t) => t.day === day && !t.done && t.title.trim().toLowerCase() === b.title.trim().toLowerCase());
    const minutes = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
    const task = found ?? addTodo({ title: b.title, day, estimateMin: Math.max(5, minutes(b.end) - minutes(b.start)), goalId: b.goalId, source: "assistant" });
    return { ...b, taskId: task.id };
  });
}
