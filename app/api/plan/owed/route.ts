import { NextResponse } from "next/server";
import { owed } from "@/lib/accountability";
import { syncCalendar } from "@/lib/autopilot";
import { calendarBusy, coachNow, nextFreeSlot } from "@/lib/coach";
import { dropMissed, rescheduleBlock } from "@/lib/plan-store";

export const dynamic = "force-dynamic";

// Strict blocks (v5.4): missed blocks wait for Lind's decision.
// GET → what he owes a decision on. POST { day, id, action: "back", start? } → into today's next free
// slot (or at `start`); POST { day, id, action: "drop", reason } → let go, with the reason on the record.
export async function GET() {
  return NextResponse.json({ owed: owed(coachNow().day) });
}

export async function POST(request: Request) {
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
  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
