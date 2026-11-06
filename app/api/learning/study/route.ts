import { NextResponse } from "next/server";
import { learningOverview, setStudying } from "@/lib/learning";
import { listItems } from "@/lib/library";

export const dynamic = "force-dynamic";

// POST { id, on } adds a source to Study (queuing its read if it needs one) or takes it out.
export async function POST(request: Request) {
  const b = (await request.json().catch(() => null)) as { id?: string; on?: boolean } | null;
  if (!b?.id || !setStudying(b.id, !!b.on)) return NextResponse.json({ error: "That source isn't in memory any more." }, { status: 404 });
  return NextResponse.json({ ok: true, ...learningOverview(listItems()) });
}
