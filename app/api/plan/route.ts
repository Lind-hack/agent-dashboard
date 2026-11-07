import { NextResponse } from "next/server";
import { planDay } from "@/lib/planner";
import { guarded } from "@/lib/guard";

// { note } → a proposed plan (nothing written yet).
async function POST_(request: Request) {
  const note = ((await request.json().catch(() => null))?.note ?? "").toString().trim().slice(0, 2000);
  try {
    return NextResponse.json(await planDay(note));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export const POST = guarded(POST_);
