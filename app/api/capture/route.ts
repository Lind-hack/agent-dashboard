import { NextResponse } from "next/server";
import { capture } from "@/lib/capture";

// Dictated or typed note → task or event draft. Nothing is saved until the client confirms it.
export async function POST(request: Request) {
  const text = ((await request.json().catch(() => null))?.text ?? "").toString().trim();
  if (!text) return NextResponse.json({ error: "Say or type something first." }, { status: 400 });
  try {
    return NextResponse.json(await capture(text.slice(0, 2000)));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
