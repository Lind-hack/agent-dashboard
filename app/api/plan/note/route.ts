import { NextResponse } from "next/server";
import { savePlanNote } from "@/lib/plan-store";

// Store the reviewed transcript without generating blocks or changing calendar events.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (typeof body?.day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.day) ||
      typeof body?.note !== "string" || body.note.length > 20_000) {
    return NextResponse.json({ error: "Send a day and a note of at most 20,000 characters." }, { status: 400 });
  }
  try {
    return NextResponse.json({ ok: true, plan: savePlanNote(body.day, body.note.trim()) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
