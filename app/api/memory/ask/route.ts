import { NextResponse } from "next/server";
import { askMemory } from "@/lib/memory";
import { guarded } from "@/lib/guard";

async function POST_(request: Request) {
  const q = ((await request.json().catch(() => null))?.q ?? "").toString().trim();
  if (!q) return NextResponse.json({ error: "Ask something first." }, { status: 400 });
  try {
    return NextResponse.json(await askMemory(q.slice(0, 1000)));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export const POST = guarded(POST_);
