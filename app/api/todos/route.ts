import { NextResponse } from "next/server";
import { coachNow } from "@/lib/coach";
import { deferTodoBlocks, finishTodo, scheduleTodo } from "@/lib/todo-actions";
import { addTodo, removeTodo, todosFor, updateTodo, type TodoPatch } from "@/lib/todos";
import { guarded } from "@/lib/guard";

export const dynamic = "force-dynamic";

// Dashboard tasks (v5). GET → today's lists; POST → add; PATCH → edit / tick / subtasks; DELETE → remove.

async function GET_() {
  return NextResponse.json(todosFor(coachNow().day));
}

async function POST_(request: Request) {
  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const title = String(b?.title ?? "").trim();
  if (!title) return NextResponse.json({ error: "What's the task?" }, { status: 400 });
  try {
    const todo = addTodo({
      title,
      day: typeof b?.day === "string" ? b.day : coachNow().day,
      notes: typeof b?.notes === "string" ? b.notes : undefined,
      goalId: typeof b?.goalId === "string" ? b.goalId : undefined,
      priority: Number(b?.priority ?? 0) as 0,
      estimateMin: Number(b?.estimateMin ?? 30),
      due: typeof b?.due === "string" ? b.due : undefined,
      subtasks: Array.isArray(b?.subtasks) ? b.subtasks.map(String) : undefined,
    });
    return NextResponse.json({ todo });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

async function PATCH_(request: Request) {
  const b = (await request.json().catch(() => null)) as (TodoPatch & { id?: string; schedule?: { start?: string; length?: number } }) | null;
  if (!b?.id) return NextResponse.json({ error: "Which task?" }, { status: 400 });
  const { id, done, schedule, ...patch } = b;
  // "Schedule" puts the task on today's plan in the next free slot (and on the calendar).
  if (schedule) {
    const r = await scheduleTodo(id, schedule);
    return r.error ? NextResponse.json({ error: r.error }, { status: 409 }) : NextResponse.json(r);
  }
  let todo = Object.keys(patch).length ? updateTodo(id, patch) : null;
  // Pushed to a later day: its blocks on today's plan go with it.
  if (todo && patch.day && patch.day > coachNow().day) deferTodoBlocks(id);
  let warning: string | undefined;
  if (typeof done === "boolean") ({ todo, warning } = await finishTodo(id, done));
  if (!todo) return NextResponse.json({ error: "Task not found" }, { status: 404 });
  return NextResponse.json({ todo, warning });
}

async function DELETE_(request: Request) {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  return removeTodo(id) ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Task not found" }, { status: 404 });
}

export const GET = guarded(GET_);
export const POST = guarded(POST_);
export const PATCH = guarded(PATCH_);
export const DELETE = guarded(DELETE_);
