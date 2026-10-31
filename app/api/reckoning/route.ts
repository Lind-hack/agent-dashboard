import { NextResponse } from "next/server";
import { mirror, mirrorText } from "@/lib/accountability";
import { coachNow } from "@/lib/coach";
import { faceSet } from "@/lib/face";
import { reckonReply } from "@/lib/goggins";
import { addEntry } from "@/lib/journal";
import { invalidateMemory } from "@/lib/memory";
import { answer, readReckoning, reckoningDue, VERDICT_WORDS } from "@/lib/reckoning";

export const dynamic = "force-dynamic";

// The reckoning (v5.2). GET → the day Lind still owes an answer for (null when none), with its blocks.
// POST { day, answer } → his answer is kept with the day's numbers, the coach replies, and it goes into
// his journal too (so the Buddy and tomorrow's push know what he said).
export async function GET() {
  const due = reckoningDue();
  const rows = due ? mirror(due.day, due.day < coachNow().day ? Number.MAX_SAFE_INTEGER : Date.now()).rows : [];
  return NextResponse.json({ due, rows, face: faceSet() });
}

export async function POST(request: Request) {
  const b = (await request.json().catch(() => null)) as { day?: string; answer?: string } | null;
  const day = String(b?.day ?? "");
  const text = String(b?.answer ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day > coachNow().day) return NextResponse.json({ error: "Which day?" }, { status: 400 });
  if (text.length < 15) return NextResponse.json({ error: "That's not an answer. What happened — and what's the excuse?" }, { status: 400 });
  if (readReckoning(day)?.answeredAt) return NextResponse.json({ error: "You already answered for that day." }, { status: 409 });
  const record = mirrorText(mirror(day, day < coachNow().day ? Number.MAX_SAFE_INTEGER : Date.now()));
  const pre = answer(day, text);
  const reply = await reckonReply(pre, text, record).catch(() => "");
  const r = reply ? answer(day, text, reply) : pre;
  try {
    addEntry(day, `Reckoning — ${VERDICT_WORDS[r.verdict]} ${r.didMin} of ${r.saidMin} planned minutes done, ${r.missed} missed. ${text}`, "text");
    invalidateMemory();
  } catch {
    // the journal is a bonus; the reckoning itself is saved
  }
  return NextResponse.json({ reckoning: r });
}
