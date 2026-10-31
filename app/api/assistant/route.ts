import { NextResponse } from "next/server";
import { briefPending, chatReply, readBrief, readChat, requestBrief, writeChat, type AssistantAction, type BriefSlot, type ChatTurn } from "@/lib/assistant";
import { coachNow, dayProgress } from "@/lib/coach";
import { activeBlocks, readPlan, setBlockStatus } from "@/lib/plan-store";
import { finishTodo, scheduleTodo } from "@/lib/todo-actions";
import { addTodo } from "@/lib/todos";

export const dynamic = "force-dynamic";

// The Day assistant. GET → today's chat, briefings and progress.
// POST { message } → a reply (fast model); { apply: action } → carries out one proposed action;
// { brief: "morning" | "midday" | "evening" } → asks the runner for a fresh Sol briefing.

export async function GET() {
  const day = coachNow().day;
  return NextResponse.json({
    day,
    chat: readChat(day),
    briefs: { morning: readBrief(day, "morning"), midday: readBrief(day, "midday"), evening: readBrief(day, "evening") },
    pending: briefPending(),
    progress: await dayProgress(),
  });
}

const SLOTS: BriefSlot[] = ["morning", "midday", "evening"];

export async function POST(request: Request) {
  const b = (await request.json().catch(() => null)) as { message?: string; apply?: AssistantAction; brief?: BriefSlot } | null;
  const day = coachNow().day;

  if (b?.brief) {
    if (!SLOTS.includes(b.brief)) return NextResponse.json({ error: "Which briefing?" }, { status: 400 });
    requestBrief(b.brief);
    return NextResponse.json({ ok: true, pending: true });
  }

  if (b?.apply) return applyAction(day, b.apply);

  const message = String(b?.message ?? "").trim().slice(0, 2000);
  if (!message) return NextResponse.json({ error: "Say something." }, { status: 400 });
  const mine: ChatTurn = { role: "lind", text: message, at: new Date().toISOString() };
  writeChat(day, [...readChat(day), mine]);
  const reply = await chatReply(day, message);
  writeChat(day, [...readChat(day), reply]);
  return NextResponse.json({ turn: reply });
}

async function applyAction(day: string, a: AssistantAction) {
  const ok = (msg: string, extra: Record<string, unknown> = {}) => NextResponse.json({ ok: true, msg, ...extra });
  const fail = (error: string, status = 400) => NextResponse.json({ error }, { status });
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
    case "replan":
      return ok("Re-planning the rest of today.", { href: `/calendar?replan=${encodeURIComponent(a.note ?? "")}#plan` });
    default:
      return fail("Unknown action.");
  }
}
