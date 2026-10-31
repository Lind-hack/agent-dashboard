import { NextResponse } from "next/server";
import { briefPending, chatReply, readBrief, readChat, requestBrief, writeChat, type AssistantAction, type BriefSlot, type ChatTurn } from "@/lib/assistant";
import { applyAction } from "@/lib/apply-action";
import { coachNow, dayProgress } from "@/lib/coach";

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

  if (b?.apply) {
    const r = await applyAction(day, b.apply);
    return "error" in r ? NextResponse.json({ error: r.error }, { status: r.status }) : NextResponse.json({ ok: true, ...r });
  }

  const message = String(b?.message ?? "").trim().slice(0, 2000);
  if (!message) return NextResponse.json({ error: "Say something." }, { status: 400 });
  const mine: ChatTurn = { role: "lind", text: message, at: new Date().toISOString() };
  writeChat(day, [...readChat(day), mine]);
  const reply = await chatReply(day, message);
  writeChat(day, [...readChat(day), reply]);
  return NextResponse.json({ turn: reply });
}
