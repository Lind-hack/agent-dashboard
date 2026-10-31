import { NextResponse } from "next/server";
import { calendarBusy, clockNow, coachNow, coachTz, goalProgress, nextFreeSlot } from "@/lib/coach";
import { goalById } from "@/lib/goals";
import { groqJSON } from "@/lib/groq";
import { addBlock, addCheckin, setBlockStatus, shrinkBlock, type BlockAction, type Mood } from "@/lib/plan-store";

export const dynamic = "force-dynamic";

// The Coach, web side. GET → what's on now (focus bar, /focus). POST { action, … }:
//   start | done | blocked | move     → the block's status (same store as Today)
//   shrink                            → a 25-minute start from now
//   checkin { mood, note }            → how it's going
//   focus { goalId, minutes }         → a block on that goal starting now, running
//   plan  { goalId, minutes }         → a block on that goal in today's next free slot
//   breakdown                         → three tiny first steps for a block Lind is stuck on
export async function GET() {
  const now = coachNow();
  return NextResponse.json({ ...now, progress: goalProgress().map((p) => ({ id: p.goal.id, title: p.goal.title, weekMin: p.weekMin, targetMin: p.targetMin, todayDoneMin: p.todayDoneMin })) });
}

const STATUS: BlockAction[] = ["start", "done", "blocked", "move", "planned"];
const MOODS: Mood[] = ["on-track", "stuck", "distracted"];

export async function POST(request: Request) {
  const b = (await request.json().catch(() => null)) as { action?: string; id?: string; mood?: string; note?: string; goalId?: string; minutes?: number } | null;
  const tz = coachTz();
  const { day } = coachNow();
  const action = b?.action ?? "";
  if (STATUS.includes(action as BlockAction) || action === "shrink" || action === "checkin" || action === "breakdown") {
    if (!b?.id) return NextResponse.json({ error: "Which block?" }, { status: 400 });
    if (action === "breakdown") {
      const block = coachNow().current;
      const title = block?.id === b.id ? block.title : b.note ?? "";
      const out = await groqJSON<{ steps: string[] }>(
        `Lind is stuck starting a work block. Give him exactly three tiny, concrete first steps (each doable in under 5 minutes, starting with a verb). Return JSON {"steps": string[]}.`,
        `Block: ${title}${block?.goal ? `\nGoal it serves: ${block.goal.title} (why: ${block.goal.why})` : ""}`,
        0.4,
        { maxTokens: 300 },
      ).catch(() => null);
      return NextResponse.json({ steps: (out?.steps ?? []).filter((s) => typeof s === "string").slice(0, 3) });
    }
    const plan =
      action === "shrink"
        ? shrinkBlock(day, b.id, clockNow(tz))
        : action === "checkin"
          ? MOODS.includes(b.mood as Mood)
            ? addCheckin(day, b.id, b.mood as Mood, b.note)
            : null
          : setBlockStatus(day, b.id, action as BlockAction);
    if (!plan) return NextResponse.json({ error: "That block isn't in today's plan any more." }, { status: 404 });
    return NextResponse.json({ ok: true, now: coachNow() });
  }
  if (action === "focus" || action === "plan") {
    const goal = goalById(b?.goalId);
    if (!goal) return NextResponse.json({ error: "No such goal." }, { status: 404 });
    const minutes = Math.max(15, Math.min(180, Math.round(Number(b?.minutes) || 50)));
    const start = action === "focus" ? clockNow(tz) : nextFreeSlot(minutes, new Date(), await calendarBusy());
    if (!start) return NextResponse.json({ error: `No ${minutes}-minute gap left today.` }, { status: 409 });
    const block = addBlock(day, { start, length: minutes, title: goal.next || goal.title, goalId: goal.id, kind: "focus", status: action === "focus" ? "running" : "planned" });
    return NextResponse.json({ ok: true, block, now: coachNow() });
  }
  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
