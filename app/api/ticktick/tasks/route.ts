import { NextResponse } from "next/server";
import { timeZone } from "@/lib/calendar";
import { completeTask, createTask, type TaskDraft } from "@/lib/ticktick";
import { guarded } from "@/lib/guard";

const fail = (err: unknown) => NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });

// Create: { task: TaskDraft }
async function POST_(request: Request) {
  const t = (await request.json().catch(() => null))?.task as Partial<TaskDraft> | undefined;
  if (!t?.title?.trim()) return NextResponse.json({ error: "The task needs a title." }, { status: 400 });
  try {
    const tz = await timeZone().catch(() => "Europe/Belgrade");
    const created = await createTask(
      {
        title: t.title.trim().slice(0, 200),
        date: /^\d{4}-\d{2}-\d{2}$/.test(t.date ?? "") ? t.date : undefined,
        time: /^\d{2}:\d{2}$/.test(t.time ?? "") ? t.time : undefined,
        priority: ([0, 1, 3, 5].includes(Number(t.priority)) ? Number(t.priority) : 0) as TaskDraft["priority"],
      },
      tz,
    );
    return NextResponse.json({ id: created?.id });
  } catch (err) {
    return fail(err);
  }
}

// Complete: { projectId, id }
async function PATCH_(request: Request) {
  const b = (await request.json().catch(() => null)) as { projectId?: string; id?: string } | null;
  if (!b?.projectId || !b.id) return NextResponse.json({ error: "projectId and id are required" }, { status: 400 });
  try {
    await completeTask(b.projectId, b.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return fail(err);
  }
}

export const POST = guarded(POST_, { owner: true });
export const PATCH = guarded(PATCH_, { owner: true });
