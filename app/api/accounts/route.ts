import { NextResponse } from "next/server";
import { outlookClientId, outlookPoll, outlookStart, publicAccounts, removeAccount, saveAccount } from "@/lib/accounts";
import { testImap } from "@/lib/mail-sources";
import { IMAP_PORTS } from "@/lib/net-guard";

export const dynamic = "force-dynamic";

// Extra mail accounts (v5.1). GET → the list (no secrets). POST:
//   { action: "outlook-start" }            → a device code to approve at microsoft.com/devicelogin
//   { action: "outlook-poll", deviceCode } → pending | done | failed
//   { action: "imap", email, host, port, user, password } → tested, then saved
// DELETE ?id= → removes one. Gmail accounts are added from the PC: node handoff/google-auth.mjs --add
export async function GET() {
  return NextResponse.json({ accounts: publicAccounts(), outlookReady: !!outlookClientId() });
}

// Known IMAP hosts, so Lind only has to type the address and an app password.
const IMAP_HOSTS: Record<string, string> = {
  "icloud.com": "imap.mail.me.com",
  "me.com": "imap.mail.me.com",
  "yahoo.com": "imap.mail.yahoo.com",
  "zoho.com": "imap.zoho.com",
  "gmx.com": "imap.gmx.com",
  "aol.com": "imap.aol.com",
  "proton.me": "127.0.0.1",
};

export async function POST(request: Request) {
  const b = (await request.json().catch(() => null)) as { action?: string; deviceCode?: string; email?: string; host?: string; port?: number; user?: string; password?: string } | null;
  try {
    if (b?.action === "outlook-start") return NextResponse.json(await outlookStart());
    if (b?.action === "outlook-poll" && b.deviceCode) return NextResponse.json(await outlookPoll(b.deviceCode));
    if (b?.action === "imap") {
      const email = String(b.email ?? "").trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !b.password) return NextResponse.json({ error: "An address and an app password are needed." }, { status: 400 });
      if (/@(outlook|hotmail|live|msn)\./.test(email)) return NextResponse.json({ error: "Outlook doesn't take passwords over IMAP any more — use “Connect Outlook”." }, { status: 400 });
      const host = String(b.host || IMAP_HOSTS[email.split("@")[1]] || "").trim();
      if (!host || host === "127.0.0.1") return NextResponse.json({ error: "Which IMAP server? (e.g. imap.example.com)" }, { status: 400 });
      const port = Number(b.port) || 993;
      if (!IMAP_PORTS.has(port)) return NextResponse.json({ error: "IMAP uses port 993 (or 143)." }, { status: 400 });
      const acc = { email, host, port, user: String(b.user || email), password: String(b.password) };
      await testImap(acc).catch((e) => {
        throw new Error(`Couldn't sign in to ${host}: ${e instanceof Error ? e.message : e}`);
      });
      saveAccount({ provider: "imap", ...acc });
      return NextResponse.json({ ok: true, accounts: publicAccounts() });
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
  return NextResponse.json({ error: "bad request" }, { status: 400 });
}

export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  return removeAccount(id) ? NextResponse.json({ ok: true, accounts: publicAccounts() }) : NextResponse.json({ error: "not found" }, { status: 404 });
}
