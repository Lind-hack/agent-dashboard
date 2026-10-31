import { NextResponse } from "next/server";
import { autopilotEnabled, readAutopilot, setAutopilotEnabled, undoStep, type Step } from "@/lib/autopilot";
import { coachNow } from "@/lib/coach";

export const dynamic = "force-dynamic";

// Autopilot (v5.1). GET → what it did today and whether it's on. POST { undo: step } puts the plan and
// tasks back as they were before that step; { enabled } turns it on or off.
export async function GET() {
  const day = coachNow().day;
  return NextResponse.json({ enabled: autopilotEnabled(), ...readAutopilot(day) });
}

const STEPS: Step[] = ["morning", "midday", "evening"];

export async function POST(request: Request) {
  const b = (await request.json().catch(() => null)) as { undo?: Step; enabled?: boolean } | null;
  const day = coachNow().day;
  if (typeof b?.enabled === "boolean") {
    setAutopilotEnabled(b.enabled);
    return NextResponse.json({ ok: true, enabled: autopilotEnabled() });
  }
  if (b?.undo && STEPS.includes(b.undo)) {
    const r = await undoStep(day, b.undo);
    return r.ok ? NextResponse.json({ ok: true, warning: r.error, ...readAutopilot(day) }) : NextResponse.json({ error: r.error }, { status: 409 });
  }
  return NextResponse.json({ error: "bad request" }, { status: 400 });
}
