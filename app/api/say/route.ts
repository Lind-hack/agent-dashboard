import { NextResponse } from "next/server";
import { applySay, parseSay, undoSay, type Undo } from "@/lib/say";

export const dynamic = "force-dynamic";

// "Say it" (v5.2). POST { text } → sorted into tasks, time blocks, calendar events and goals, each
// done at once; the answer lists them with an undo each. DELETE { undo } takes one back. Voice is
// transcribed first by /api/transcribe on the page.
export async function POST(request: Request) {
  const text = String(((await request.json().catch(() => null)) as { text?: unknown } | null)?.text ?? "").trim().slice(0, 4000);
  if (!text) return NextResponse.json({ error: "Say or type what to add." }, { status: 400 });
  try {
    const items = await parseSay(text);
    if (!items.length) return NextResponse.json({ heard: text, results: [], error: "I didn't hear a task, block, event or goal in that." });
    return NextResponse.json({ heard: text, results: await applySay(items) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}

export async function DELETE(request: Request) {
  const u = ((await request.json().catch(() => null)) as { undo?: Undo } | null)?.undo;
  if (!u || !["task", "block", "event", "goal"].includes(u.kind) || typeof u.id !== "string") return NextResponse.json({ error: "Nothing to undo." }, { status: 400 });
  try {
    const r = await undoSay(u);
    return NextResponse.json(r, { status: r.ok ? 200 : 404 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
