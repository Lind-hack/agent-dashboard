import { NextResponse } from "next/server";
import { saveCreds } from "@/lib/calendar";

// Posted by handoff/google-auth.mjs on Lind's PC (Bearer HANDOFF_TOKEN, checked in proxy.ts).
export async function POST(request: Request) {
  const b = (await request.json().catch(() => null)) as { client_id?: string; client_secret?: string; refresh_token?: string; scopes?: string[] } | null;
  if (!b?.client_id || !b.client_secret || !b.refresh_token) {
    return NextResponse.json({ error: "client_id, client_secret and refresh_token are required" }, { status: 400 });
  }
  saveCreds({ client_id: b.client_id, client_secret: b.client_secret, refresh_token: b.refresh_token, scopes: b.scopes });
  return NextResponse.json({ ok: true });
}
