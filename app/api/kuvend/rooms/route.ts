import { NextResponse } from "next/server";
import { guarded } from "@/lib/guard";
import { kuvendTable, startRoom } from "@/lib/room-start";

export const dynamic = "force-dynamic";

// Kuvend puts a decision in front of this account's Roast room: { task, context }. The table is chosen
// here (the account's own AIs, or the owner's free agents, plus two council seats), never by the caller.
async function POST_(request: Request) {
  const body = (await request.json().catch(() => null)) as { task?: unknown; context?: unknown } | null;
  const task = typeof body?.task === "string" ? body.task.trim() : "";
  if (!task) return NextResponse.json({ error: "Send the question to debate" }, { status: 400 });
  if (task.length > 8000) return NextResponse.json({ error: "Keep the question under 8,000 characters" }, { status: 400 });
  const context = typeof body?.context === "string" ? body.context.slice(0, 30_000) : "";
  const r = startRoom({ task: `${task}\n\n(Sent from Kuvend.)`, context, ...kuvendTable() });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ id: r.id, url: `/room/${r.id}` });
}

export const POST = guarded(POST_);
