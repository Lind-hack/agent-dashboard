import { NextResponse } from "next/server";
import { coachNow } from "@/lib/coach";
import { addEntry, readJournal, recentJournal, removeEntry } from "@/lib/journal";
import { invalidateMemory } from "@/lib/memory";

export const dynamic = "force-dynamic";

// The journal (v5.1). GET → today + the last week; POST { text, source, mood, day? } → one entry;
// DELETE ?day=&id= → removes one. Voice is transcribed first by /api/transcribe on the page.
export async function GET() {
  const day = coachNow().day;
  return NextResponse.json({ day, today: readJournal(day), week: recentJournal(day, 7) });
}

export async function POST(request: Request) {
  const b = (await request.json().catch(() => null)) as { text?: string; source?: string; mood?: number; day?: string } | null;
  const day = typeof b?.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.day) ? b.day : coachNow().day;
  try {
    const entry = addEntry(day, String(b?.text ?? ""), b?.source === "voice" ? "voice" : "text", Number(b?.mood) || undefined);
    invalidateMemory();
    return NextResponse.json({ entry, today: readJournal(day) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const u = new URL(request.url);
  const day = u.searchParams.get("day") ?? "";
  if (!removeEntry(day, u.searchParams.get("id") ?? "")) return NextResponse.json({ error: "not found" }, { status: 404 });
  invalidateMemory();
  return NextResponse.json({ ok: true });
}
