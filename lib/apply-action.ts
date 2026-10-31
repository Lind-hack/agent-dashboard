import type { AssistantAction } from "./assistant";
import { calendarConnected, createEvent } from "./calendar";
import { draftReply } from "./mail-actions";
import { activeBlocks, readPlan, setBlockStatus } from "./plan-store";
import { finishTodo, scheduleTodo } from "./todo-actions";
import { addTodo } from "./todos";

// One proposed action (from the Day assistant or the Buddy), carried out after Lind taps it.
export type Applied = { msg: string; href?: string; link?: string } | { error: string; status: number };

export async function applyAction(day: string, a: AssistantAction): Promise<Applied> {
  const ok = (msg: string, extra: { href?: string; link?: string } = {}): Applied => ({ msg, ...extra });
  const fail = (error: string, status = 400): Applied => ({ error, status });
  switch (a?.type) {
    case "add_task": {
      if (!a.title?.trim()) return fail("The task has no title.");
      const t = addTodo({ title: a.title, day, estimateMin: a.estimateMin, priority: a.priority, due: a.due, goalId: a.goalId, subtasks: a.subtasks, source: "assistant" });
      return ok(`Added “${t.title}”.`);
    }
    case "schedule": {
      const r = await scheduleTodo(a.taskId, { start: a.start, length: a.length });
      return r.error ? fail(r.error, 409) : ok(`On the plan at ${r.block?.start}${r.calendar ? " and on your calendar" : ""}.`);
    }
    case "done": {
      const r = await finishTodo(a.taskId, true);
      return r.todo ? ok(r.warning ?? `Ticked “${r.todo.title}”.`) : fail("That task is gone.", 404);
    }
    case "move_block": {
      const blk = activeBlocks(readPlan(day)).find((x) => x.id === a.blockId);
      if (!blk) return fail("That block isn't on today's plan.", 404);
      setBlockStatus(day, blk.id, "move");
      return ok(`Moved “${blk.title}” to tomorrow.`);
    }
    case "focus":
      return ok("Opening focus mode.", { href: `/focus?block=${encodeURIComponent(a.blockId)}` });
    case "add_event": {
      if (!a.title?.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(a.date ?? "")) return fail("The event needs a title and a date.");
      if (!calendarConnected()) return fail("Google Calendar isn't connected.", 409);
      const timed = /^\d{2}:\d{2}$/.test(a.start ?? "");
      const e = await createEvent({ title: a.title.trim().slice(0, 200), date: a.date, start: timed ? a.start : undefined, end: timed && /^\d{2}:\d{2}$/.test(a.end ?? "") ? a.end : undefined, allDay: !timed });
      return ok(`“${e.title}” is on your calendar${timed ? ` at ${a.start}` : ""}.`);
    }
    case "draft_reply": {
      const r = await draftReply(a.mailId, a.note ?? "");
      return r.ok ? ok("Reply drafted in Gmail — review and send it there.", { link: r.link }) : fail(r.error, 409);
    }
    case "replan":
      return ok("Re-planning the rest of today.", { href: `/calendar?replan=${encodeURIComponent(a.note ?? "")}#plan` });
    default:
      return fail("Unknown action.");
  }
}
