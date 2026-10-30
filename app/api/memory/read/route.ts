import { NextResponse } from "next/server";
import { readSource } from "@/lib/source-capture";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: Request) {
  const url = ((await request.json().catch(() => null))?.url ?? "").toString().trim().slice(0, 2000);
  if (!url) return NextResponse.json({ ok: false, error: "Paste a URL first." }, { status: 400 });
  const out = await readSource(url);
  return NextResponse.json(out, { status: out.ok ? 200 : 422 });
}
