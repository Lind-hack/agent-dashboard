import { NextResponse } from "next/server";
import { captureMemory } from "@/lib/memory";

// { text } → one markdown note in the Syncthing vault inbox (100 - Me/memory/inbox).
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (body?.text !== undefined && typeof body.text !== "string") return NextResponse.json({ error: "Invalid text." }, { status: 400 });
  const text = (body?.text ?? "").trim();
  if (text.length > 20_000) return NextResponse.json({ error: "Split this into notes of up to 20,000 characters." }, { status: 400 });
  if (body?.id !== undefined && typeof body.id !== "string") return NextResponse.json({ error: "Invalid capture ID." }, { status: 400 });
  if (!text && !body?.attachments?.length) return NextResponse.json({ ok: false, error: "Say or type something first." }, { status: 400 });
  const out = captureMemory(text, { id: body?.id, attachments: body?.attachments });
  return NextResponse.json(out, { status: out.ok ? 200 : 500 });
}
