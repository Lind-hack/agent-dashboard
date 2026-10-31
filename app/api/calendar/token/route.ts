import { NextResponse } from "next/server";
import { saveAccount } from "@/lib/accounts";
import { saveCreds } from "@/lib/calendar";

// Posted by handoff/google-auth.mjs on Lind's PC (Bearer HANDOFF_TOKEN, checked in proxy.ts).
// { add: true } is another Gmail account (v5.1): it's saved under data/accounts, named by its address.
export async function POST(request: Request) {
  const b = (await request.json().catch(() => null)) as { client_id?: string; client_secret?: string; refresh_token?: string; scopes?: string[]; add?: boolean } | null;
  if (!b?.client_id || !b.client_secret || !b.refresh_token) {
    return NextResponse.json({ error: "client_id, client_secret and refresh_token are required" }, { status: 400 });
  }
  if (!b.add) {
    saveCreds({ client_id: b.client_id, client_secret: b.client_secret, refresh_token: b.refresh_token, scopes: b.scopes });
    return NextResponse.json({ ok: true });
  }
  const tok = (await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: b.client_id, client_secret: b.client_secret, refresh_token: b.refresh_token, grant_type: "refresh_token" }),
  })
    .then((r) => r.json())
    .catch(() => null)) as { access_token?: string } | null;
  if (!tok?.access_token) return NextResponse.json({ error: "Google didn't accept that sign-in" }, { status: 400 });
  const profile = (await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", { headers: { Authorization: `Bearer ${tok.access_token}` } })
    .then((r) => r.json())
    .catch(() => null)) as { emailAddress?: string } | null;
  if (!profile?.emailAddress) return NextResponse.json({ error: "Couldn't read that account's address (Gmail scope missing?)" }, { status: 400 });
  const a = saveAccount({ provider: "google", email: profile.emailAddress, client_id: b.client_id, client_secret: b.client_secret, refresh_token: b.refresh_token, scopes: b.scopes });
  return NextResponse.json({ ok: true, email: a.email });
}
