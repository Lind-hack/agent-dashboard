import { NextResponse } from "next/server";
import { owed } from "@/lib/accountability";
import { syncCalendar } from "@/lib/autopilot";
import { addDays } from "@/lib/calendar";
import { calendarBusy, coachNow, nextFreeSlot } from "@/lib/coach";
import { dropMissed, readPlan, rescheduleBlock } from "@/lib/plan-store";
import { updateTodo } from "@/lib/todos";
import { guarded } from "@/lib/guard";

export const dynamic = "force-dynamic";

// Strict blocks (v5.4): missed blocks the runner couldn't fit back into today wait for Lind's decision.
// v5.4.1: "tomorrow" is his explicit "I can't do this today" — the block goes to tomorrow at the same
// time, and its task with it.
// GET → what he owes a decision on. POST { day, id, action: "back", start? } → into today's next free
// slot (or at `start`); POST { day, id, action: "drop", reason } → let go, with the reason on the record.
async function GET_() {
  return NextResponse.json({ owed: owed(coachNow().day) });
}

async function POST_(request: Request) {
  const b = (await request.json().catch(() => null)) as { day?: string; id?: string; action?: string; start?: string; reason?: string } | null;
  const today = coachNow().day;
  const item = owed(today).find((o) => o.day === b?.day && o.id === b?.id);
  if (!item) return NextResponse.json({ error: "That block isn't waiting on a decision any more." }, { status: 404 });
  if (b?.action === "drop") {
    if (String(b.reason ?? "").trim().length < 8) return NextResponse.json({ error: "Say why — a real reason, not a word." }, { status: 400 });
    const d = dropMissed(item.day, item.id, String(b.reason));
    return d ? NextResponse.json({ ok: true, dropped: d }) : NextResponse.json({ error: "Couldn't drop it." }, { status: 409 });
  }
  if (b?.action === "back") {
    const start = b.start && /^\d{2}:\d{2}$/.test(b.start) ? b.start : nextFreeSlot(item.length, new Date(), await calendarBusy().catch(() => []));
    if (!start) return NextResponse.json({ error: "No free time left today — drop it with a reason, or move something." }, { status: 409 });
    const block = rescheduleBlock(item.day, item.id, start, today, true);
    if (!block) return NextResponse.json({ error: "Couldn't put it back." }, { status: 409 });
    const calendar = await syncCalendar(today).catch((e) => String(e));
    return NextResponse.json({ ok: true, block, warning: calendar || undefined });
  }
  if (b?.action === "tomorrow") {
    const tomorrow = addDays(today, 1);
    const taskId = readPlan(item.day)?.blocks.find((x) => x.id === item.id)?.taskId;
    const block = rescheduleBlock(item.day, item.id, item.start, tomorrow, true);
    if (!block) return NextResponse.json({ error: "Couldn't move it." }, { status: 409 });
    if (taskId) updateTodo(taskId, { day: tomorrow });
    const calendar = await syncCalendar(today).catch((e) => String(e));
    return NextResponse.json({ ok: true, block, warning: calendar || undefined });
  }
  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}

export const GET = guarded(GET_);
export const POST = guarded(POST_);
