import { NextResponse } from "next/server";
import { captureMemory } from "@/lib/memory";

// { text } → one markdown note in the Syncthing vault inbox (100 - Me/memory/inbox).
export async function POST(request: Request) {
  const text = ((await request.json().catch(() => null))?.text ?? "").toString().trim().slice(0, 20_000);
  if (!text) return NextResponse.json({ ok: false, error: "Say or type something first." }, { status: 400 });
  const out = captureMemory(text);
  return NextResponse.json(out, { status: out.ok ? 200 : 500 });
}
