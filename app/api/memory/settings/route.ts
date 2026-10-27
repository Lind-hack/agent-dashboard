import { NextResponse } from "next/server";
import { readMemorySettings, writeMemorySettings } from "@/lib/memory-settings";

export const dynamic = "force-dynamic";
export async function GET() {
  return NextResponse.json(readMemorySettings());
}
// Cookie only: collectors may read the policy but cannot enable capture.
export async function PUT(request: Request) {
  if (request.headers.has("authorization")) return NextResponse.json({ error: "Sign in to change this setting" }, { status: 403 });
  const body = await request.json().catch(() => null);
  if (typeof body?.enabled !== "boolean") return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 });
  return NextResponse.json(writeMemorySettings(body.enabled));
}
