import { NextResponse } from "next/server";
import { coachNow } from "@/lib/coach";
import { goalById } from "@/lib/goals";
import { buildPlan, cleanPlan, logMetric, readMentorDay, readPlanFor, savePlan, writeMentorDay, type GoalPlan } from "@/lib/mentor";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// The Mentor (v5.4).
// GET → today's orders.
// POST { action: "plan", goalId, note? } → build (or rebuild) a goal's plan.
// POST { action: "edit", goalId, plan } → save his own changes to a plan.
// POST { action: "log", goalId, key, value, day? } → log a number (indicators add up; "outcome" is a level).
// POST { action: "orders" } → today's orders now (the runner does this every morning).
export async function GET() {
  return NextResponse.json({ day: readMentorDay(coachNow().day) });
}

export async function POST(request: Request) {
  const b = (await request.json().catch(() => null)) as { action?: string; goalId?: string; note?: string; plan?: Partial<GoalPlan>; key?: string; value?: number; day?: string } | null;
  const today = coachNow().day;
  try {
    switch (b?.action) {
      case "plan": {
        const goal = goalById(b.goalId);
        if (!goal) return NextResponse.json({ error: "No such goal." }, { status: 404 });
        return NextResponse.json({ plan: await buildPlan(goal, today, String(b.note ?? "").slice(0, 1000)) });
      }
      case "edit": {
        const goal = goalById(b.goalId);
        const old = goal ? readPlanFor(goal.id) : null;
        if (!goal || !old) return NextResponse.json({ error: "No plan for that goal." }, { status: 404 });
        const plan = cleanPlan(goal, { ...old, ...b.plan, outcome: { ...old.outcome, ...b.plan?.outcome } }, old.model, today);
        if (!plan) return NextResponse.json({ error: "The target needs a number." }, { status: 400 });
        savePlan({ ...plan, createdAt: old.createdAt });
        return NextResponse.json({ plan: readPlanFor(goal.id) });
      }
      case "log": {
        if (!goalById(b.goalId)) return NextResponse.json({ error: "No such goal." }, { status: 404 });
        const e = logMetric(String(b.goalId), String(b.key ?? ""), Number(b.value), b.day && /^\d{4}-\d{2}-\d{2}$/.test(b.day) && b.day <= today ? b.day : today);
        return e ? NextResponse.json({ entry: e }) : NextResponse.json({ error: "Give it a number." }, { status: 400 });
      }
      case "orders":
        return NextResponse.json({ day: await writeMentorDay(today) });
      default:
        return NextResponse.json({ error: "Unknown action." }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "That didn't work." }, { status: 502 });
  }
}
