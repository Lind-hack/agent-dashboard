import { NextResponse } from "next/server";
import { createEvent, type EventDraft } from "@/lib/calendar";

export async function POST(request: Request) {
  const d = (await request.json().catch(() => null))?.draft as Partial<EventDraft> | undefined;
  if (!d?.title?.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(d.date ?? "")) {
    return NextResponse.json({ error: "The event needs a title and a date." }, { status: 400 });
  }
  const hhmm = (v?: string) => (v && /^\d{2}:\d{2}$/.test(v) ? v : undefined);
  try {
    const event = await createEvent({
      title: d.title.trim(),
      date: d.date!,
      start: hhmm(d.start),
      end: hhmm(d.end),
      allDay: !hhmm(d.start),
      location: d.location?.trim() || undefined,
    });
    return NextResponse.json({ event });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Signed in with the read-only scope: say what fixes it instead of Google's wording.
    const hint = /insufficient|scope|permission/i.test(msg) ? " Re-run google-auth on your PC to allow adding events." : "";
    return NextResponse.json({ error: msg + hint }, { status: 500 });
  }
}
