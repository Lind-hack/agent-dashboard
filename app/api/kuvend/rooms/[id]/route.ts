import { NextResponse } from "next/server";
import { guarded } from "@/lib/guard";
import { readRoom, ROOM_ID_RE } from "@/lib/rooms";

export const dynamic = "force-dynamic";

// Where a room Kuvend started stands, and its verdict once there is one. Only what Kuvend shows.
async function GET_(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = (await ctx.params).id;
  if (!ROOM_ID_RE.test(id)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const room = readRoom(id);
  // Just created: the runner hasn't written the owner's room yet.
  if (!room) return NextResponse.json({ id, status: "queued", rounds: 0 });
  const v = room.verdict;
  return NextResponse.json({
    id,
    status: room.status,
    reason: room.reason,
    rounds: room.rounds.length,
    agreement: room.rounds.at(-1)?.judge?.agreement ?? null,
    verdict: v
      ? { outcome: v.outcome, decision: v.decision ?? null, recommendation: v.recommendation, next_step: v.next_step, actions: (v.actions ?? []).map((a) => a.title), dissent: v.dissent, confidence: v.confidence ?? null, judge: v.model }
      : null,
  });
}

export const GET = guarded(GET_);
