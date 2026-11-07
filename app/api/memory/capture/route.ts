import { NextResponse } from "next/server";
import { captureMemory } from "@/lib/memory";
import { guarded } from "@/lib/guard";

// { text } → one markdown note in the Syncthing vault inbox (100 - Me/memory/inbox).
async function POST_(request: Request) {
  const text = ((await request.json().catch(() => null))?.text ?? "").toString().trim().slice(0, 20_000);
  if (!text) return NextResponse.json({ ok: false, error: "Say or type something first." }, { status: 400 });
  const out = captureMemory(text);
  return NextResponse.json(out, { status: out.ok ? 200 : 500 });
}

export const POST = guarded(POST_);
