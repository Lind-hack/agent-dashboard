import { NextResponse } from "next/server";
import { startConnect } from "@/lib/ticktick";

// { clientId, clientSecret } from Lind's TickTick developer app → the consent URL to open.
export async function POST(request: Request) {
  const b = (await request.json().catch(() => null)) as { clientId?: string; clientSecret?: string } | null;
  if (!b?.clientId?.trim() || !b.clientSecret?.trim()) return NextResponse.json({ error: "Paste both the Client ID and the Client Secret." }, { status: 400 });
  const host = request.headers.get("x-forwarded-host");
  const origin = host ? `https://${host}` : new URL(request.url).origin;
  return NextResponse.json({ url: startConnect(b.clientId.trim(), b.clientSecret.trim(), origin) });
}
