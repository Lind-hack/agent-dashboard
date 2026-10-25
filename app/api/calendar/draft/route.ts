import { NextResponse } from "next/server";
import { draftEvent } from "@/lib/calendar";

// Dictated or typed note → event draft. Nothing is written to Google until /api/calendar/events.
export async function POST(request: Request) {
  const b = (await request.json().catch(() => null)) as { text?: string } | null;
  if (!b?.text?.trim()) return NextResponse.json({ error: "Say or type the event first." }, { status: 400 });
  try {
    return NextResponse.json({ draft: await draftEvent(b.text.trim()) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
