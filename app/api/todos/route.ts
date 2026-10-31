import { NextResponse } from "next/server";
import { coachNow } from "@/lib/coach";
import { deferTodoBlocks, finishTodo, scheduleTodo } from "@/lib/todo-actions";
import { addTodo, removeTodo, todosFor, updateTodo, type TodoPatch } from "@/lib/todos";

export const dynamic = "force-dynamic";

// Dashboard tasks (v5). GET → today's lists; POST → add; PATCH → edit / tick / subtasks; DELETE → remove.

export async function GET() {
  return NextResponse.json(todosFor(coachNow().day));
}

export async function POST(request: Request) {
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

export async function PATCH(request: Request) {
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

export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  return removeTodo(id) ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Task not found" }, { status: 404 });
}
