import { NextResponse } from "next/server";
import { coachNow } from "@/lib/coach";
import { readGoals } from "@/lib/goals";
import { applySay, cleanItems, parseSay, SAY_MAX, undoSay, type Undo } from "@/lib/say";

export const dynamic = "force-dynamic";

// "Say it" (v5.2; v5.4 reviews first). POST { text } → the items it heard, as drafts to review
// (nothing saved; repeats of open tasks and vague ones flagged). POST { items } → the ones he kept,
// checked again and carried out, each with an undo. DELETE { undo } takes one back. Voice is
// transcribed first by /api/transcribe (mode=say) on the page.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { text?: unknown; items?: unknown; from?: unknown } | null;
  try {
    if (Array.isArray(body?.items)) {
      const items = cleanItems(body.items, coachNow().day, new Set(readGoals().filter((g) => !g.done).map((g) => g.id)));
      if (!items.length) return NextResponse.json({ error: "Nothing to add." }, { status: 400 });
      return NextResponse.json({ results: await applySay(items) });
    }
    const text = String(body?.text ?? "").trim().slice(0, SAY_MAX);
    if (!text) return NextResponse.json({ error: "Say or type what to add." }, { status: 400 });
    const drafts = await parseSay(text, body?.from === "goals" ? "goals" : "today");
    return NextResponse.json({ heard: text, drafts });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}

export async function DELETE(request: Request) {
  const u = ((await request.json().catch(() => null)) as { undo?: Undo } | null)?.undo;
  if (!u || !["task", "block", "event", "goal", "habit"].includes(u.kind) || typeof u.id !== "string") return NextResponse.json({ error: "Nothing to undo." }, { status: 400 });
  try {
    const r = await undoSay(u);
    return NextResponse.json(r, { status: r.ok ? 200 : 404 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
