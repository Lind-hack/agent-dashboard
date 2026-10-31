import { NextResponse } from "next/server";
import { type AssistantAction } from "@/lib/assistant";
import { applyAction } from "@/lib/apply-action";
import { appendThread, buddyReply, readProfile, readThread, type BuddyTurn } from "@/lib/buddy";
import { coachNow } from "@/lib/coach";

export const dynamic = "force-dynamic";

// The Buddy (v5.1). GET → the conversation (last 80 turns) and when the profile was last updated.
// POST { message, voice? } → a reply; { apply: action } → carries out one of its proposed actions.
export async function GET() {
  return NextResponse.json({ thread: readThread().slice(-80), profileAt: readProfile().at ?? null });
}

export async function POST(request: Request) {
  const b = (await request.json().catch(() => null)) as { message?: string; voice?: boolean; apply?: AssistantAction } | null;
  if (b?.apply) {
    const r = await applyAction(coachNow().day, b.apply);
    return "error" in r ? NextResponse.json({ error: r.error }, { status: r.status }) : NextResponse.json({ ok: true, ...r });
  }
  const message = String(b?.message ?? "").trim().slice(0, 4000);
  if (!message) return NextResponse.json({ error: "Say something." }, { status: 400 });
  const mine: BuddyTurn = { role: "lind", text: message, at: new Date().toISOString(), voice: !!b?.voice };
  appendThread(mine);
  const reply = await buddyReply(message, !!b?.voice);
  appendThread(reply);
  return NextResponse.json({ turn: reply });
}
