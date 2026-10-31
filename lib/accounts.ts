import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./config";

// Extra mail accounts (v5.1). The main Google account stays in data/google.json; every other one is a
// file in data/accounts/ (mode 600, never sent to the browser):
// - google:  more Gmail accounts, connected with `node handoff/google-auth.mjs --add` (mail + calendar)
// - outlook: Outlook.com / Microsoft 365 through Microsoft Graph — Outlook no longer accepts passwords
//            over IMAP, so it signs in with a device code (OUTLOOK_CLIENT_ID = Lind's own app registration)
// - imap:    any other provider with IMAP and an app password (iCloud, Yahoo, Zoho, …), read-only

export type Provider = "google" | "outlook" | "imap";
export type Account = {
  id: string;
  provider: Provider;
  email: string;
  addedAt: string;
  // google
  client_id?: string;
  client_secret?: string;
  scopes?: string[];
  // google + outlook
  refresh_token?: string;
  // imap
  host?: string;
  port?: number;
  user?: string;
  password?: string;
};
export type PublicAccount = { id: string; provider: Provider; email: string; addedAt: string; calendar: boolean; drafts: boolean };

const dir = () => path.join(DATA_DIR, "accounts");
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || crypto.randomBytes(3).toString("hex");

export function listAccounts(): Account[] {
  try {
    return fs
      .readdirSync(dir())
      .filter((f) => f.endsWith(".json"))
      .flatMap((f) => {
        try {
          const a = JSON.parse(fs.readFileSync(path.join(dir(), f), "utf8")) as Account;
          return a?.id && a.provider && a.email ? [a] : [];
        } catch {
          return [];
        }
      })
      .sort((a, z) => a.addedAt.localeCompare(z.addedAt));
  } catch {
    return [];
  }
}

export const publicAccounts = (): PublicAccount[] =>
  listAccounts().map((a) => ({
    id: a.id,
    provider: a.provider,
    email: a.email,
    addedAt: a.addedAt,
    calendar: a.provider === "google" && !!a.scopes?.some((s) => s.includes("calendar")),
    drafts: a.provider === "google" && !!a.scopes?.some((s) => s.includes("gmail.compose")),
  }));

export function saveAccount(a: Omit<Account, "id" | "addedAt"> & { id?: string }): Account {
  fs.mkdirSync(dir(), { recursive: true, mode: 0o700 });
  const id = a.id ?? `${a.provider}-${slug(a.email)}`;
  const prev = listAccounts().find((x) => x.id === id);
  const full: Account = { ...prev, ...a, id, addedAt: prev?.addedAt ?? new Date().toISOString() };
  const f = path.join(dir(), `${id}.json`);
  fs.writeFileSync(`${f}.tmp`, JSON.stringify(full), { mode: 0o600 });
  fs.renameSync(`${f}.tmp`, f);
  tokens.delete(id);
  return full;
}

export function removeAccount(id: string): boolean {
  const a = listAccounts().find((x) => x.id === id);
  if (!a) return false;
  fs.rmSync(path.join(dir(), `${a.id}.json`), { force: true });
  tokens.delete(id);
  return true;
}

// ---- access tokens -----------------------------------------------------------------------------------

const tokens = new Map<string, { value: string; until: number }>();

export async function googleToken(a: Account): Promise<string> {
  const t = tokens.get(a.id);
  if (t && Date.now() < t.until) return t.value;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: a.client_id ?? "", client_secret: a.client_secret ?? "", refresh_token: a.refresh_token ?? "", grant_type: "refresh_token" }),
    signal: AbortSignal.timeout(20_000),
  });
  const b = (await res.json().catch(() => null)) as { access_token?: string; expires_in?: number; error_description?: string } | null;
  if (!res.ok || !b?.access_token) throw new Error(`${a.email}: Google sign-in expired — run google-auth --add again (${b?.error_description ?? res.status}).`);
  tokens.set(a.id, { value: b.access_token, until: Date.now() + ((b.expires_in ?? 3600) - 120) * 1000 });
  return b.access_token;
}

// Microsoft identity platform, personal + work accounts ("common"). Refresh tokens rotate: the new one
// is saved every time.
export const outlookClientId = () => process.env.OUTLOOK_CLIENT_ID?.trim() ?? "";
export const OUTLOOK_SCOPES = "offline_access User.Read Mail.Read";
const MS = "https://login.microsoftonline.com/common/oauth2/v2.0";

export async function outlookToken(a: Account): Promise<string> {
  const t = tokens.get(a.id);
  if (t && Date.now() < t.until) return t.value;
  const res = await fetch(`${MS}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: outlookClientId(), grant_type: "refresh_token", refresh_token: a.refresh_token ?? "", scope: OUTLOOK_SCOPES }),
    signal: AbortSignal.timeout(20_000),
  });
  const b = (await res.json().catch(() => null)) as { access_token?: string; refresh_token?: string; expires_in?: number; error_description?: string } | null;
  if (!res.ok || !b?.access_token) throw new Error(`${a.email}: Microsoft sign-in expired — connect it again (${b?.error_description?.split("\n")[0] ?? res.status}).`);
  if (b.refresh_token && b.refresh_token !== a.refresh_token) saveAccount({ ...a, refresh_token: b.refresh_token });
  tokens.set(a.id, { value: b.access_token, until: Date.now() + ((b.expires_in ?? 3600) - 120) * 1000 });
  return b.access_token;
}

// Device-code sign-in for Outlook: start → show the code → poll until Lind has approved it.
export async function outlookStart(): Promise<{ device_code: string; user_code: string; verification_uri: string; interval: number; expires_in: number }> {
  if (!outlookClientId()) throw new Error("OUTLOOK_CLIENT_ID isn't set on the VPS yet — see the steps on this page.");
  const res = await fetch(`${MS}/devicecode`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: outlookClientId(), scope: OUTLOOK_SCOPES }),
  });
  const b = (await res.json().catch(() => null)) as { device_code?: string; user_code?: string; verification_uri?: string; interval?: number; expires_in?: number; error_description?: string } | null;
  if (!res.ok || !b?.device_code || !b.user_code) throw new Error(`Microsoft refused: ${b?.error_description?.split("\n")[0] ?? res.status}`);
  return { device_code: b.device_code, user_code: b.user_code, verification_uri: b.verification_uri ?? "https://microsoft.com/devicelogin", interval: b.interval ?? 5, expires_in: b.expires_in ?? 900 };
}

export async function outlookPoll(deviceCode: string): Promise<{ state: "pending" | "done" | "failed"; email?: string; error?: string }> {
  const res = await fetch(`${MS}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:device_code", client_id: outlookClientId(), device_code: deviceCode }),
  });
  const b = (await res.json().catch(() => null)) as { access_token?: string; refresh_token?: string; error?: string; error_description?: string } | null;
  if (b?.error === "authorization_pending" || b?.error === "slow_down") return { state: "pending" };
  if (!res.ok || !b?.access_token || !b.refresh_token) return { state: "failed", error: b?.error_description?.split("\n")[0] ?? b?.error ?? String(res.status) };
  const me = (await fetch("https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName", { headers: { Authorization: `Bearer ${b.access_token}` } }).then((r) => r.json()).catch(() => null)) as { mail?: string; userPrincipalName?: string } | null;
  const email = me?.mail || me?.userPrincipalName || "outlook";
  saveAccount({ provider: "outlook", email, refresh_token: b.refresh_token });
  return { state: "done", email };
}
