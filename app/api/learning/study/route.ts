import { NextResponse } from "next/server";
import { isStudyMaterial, learningOverview, setStudying } from "@/lib/learning";
import { listItems, readItem } from "@/lib/library";
import { guarded } from "@/lib/guard";

export const dynamic = "force-dynamic";

// POST { id, on } adds a source to Study (queuing its read if it needs one) or takes it out.
async function POST_(request: Request) {
  const b = (await request.json().catch(() => null)) as { id?: string; on?: boolean } | null;
  const it = b?.id ? readItem(b.id) : null;
  // A few lines of text have nothing to teach; saying so beats sitting in Study unread forever.
  if (it && b?.on && !isStudyMaterial(it) && it.learning?.state !== "ready") return NextResponse.json({ error: "That one's too short to study." }, { status: 400 });
  if (!b?.id || !setStudying(b.id, !!b.on)) return NextResponse.json({ error: "That source isn't in memory any more." }, { status: 404 });
  return NextResponse.json({ ok: true, ...learningOverview(listItems()) });
}

export const POST = guarded(POST_);
