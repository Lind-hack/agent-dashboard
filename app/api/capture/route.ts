import { NextResponse } from "next/server";
import { capture } from "@/lib/capture";
import { guarded } from "@/lib/guard";

// Dictated or typed note → task or event draft. Nothing is saved until the client confirms it.
async function POST_(request: Request) {
  const text = ((await request.json().catch(() => null))?.text ?? "").toString().trim();
  if (!text) return NextResponse.json({ error: "Say or type something first." }, { status: 400 });
  try {
    return NextResponse.json(await capture(text.slice(0, 2000)));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export const POST = guarded(POST_);
