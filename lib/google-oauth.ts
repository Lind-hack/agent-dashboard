import crypto from "node:crypto";

// "Connect Google Calendar" for accounts other than the owner (the owner's comes from the PC script).
// Needs a Google Cloud OAuth client of type "Web application" whose redirect URI is
// <public address>/api/calendar/google/callback, set as GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET.
// https://developers.google.com/identity/protocols/oauth2/web-server
export const SCOPES = ["https://www.googleapis.com/auth/calendar.readonly", "https://www.googleapis.com/auth/calendar.events"];
export const STATE_COOKIE = "g_oauth_state";

export const googleOAuthReady = () => !!process.env.GOOGLE_OAUTH_CLIENT_ID && !!process.env.GOOGLE_OAUTH_CLIENT_SECRET;

// The public address users reach (behind the Cloudflare tunnel the request itself says 127.0.0.1).
export function publicOrigin(req: Request): string {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, "");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? new URL(req.url).host;
  const proto = req.headers.get("x-forwarded-proto") ?? (/^(localhost|127\.)/.test(host) ? "http" : "https");
  return `${proto}://${host}`;
}

export const redirectUri = (req: Request) => `${publicOrigin(req)}/api/calendar/google/callback`;

export function authUrl(req: Request, state: string): string {
  const q = new URLSearchParams({
    client_id: process.env.GOOGLE_OAUTH_CLIENT_ID ?? "",
    redirect_uri: redirectUri(req),
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline", // a refresh token, so the runner can read the calendar while the user is away
    prompt: "consent", // Google only returns a refresh token on consent
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

export const newState = () => crypto.randomBytes(24).toString("base64url");

export async function exchangeCode(req: Request, code: string): Promise<{ refresh_token: string; scopes: string[] }> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_OAUTH_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? "",
      redirect_uri: redirectUri(req),
      grant_type: "authorization_code",
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const b = (await res.json().catch(() => null)) as { refresh_token?: string; scope?: string; error_description?: string } | null;
  if (!res.ok || !b?.refresh_token) throw new Error(b?.error_description ?? "Google didn't send a refresh token");
  const scopes = (b.scope ?? "").split(" ").filter(Boolean);
  if (!SCOPES.every((s) => scopes.includes(s))) throw new Error("Tick both calendar permissions on Google's screen so the planner can read your day and add blocks");
  return { refresh_token: b.refresh_token, scopes };
}

// The state cookie set on the way out, read back from the callback request.
export function stateFrom(cookieHeader: string | null): string | undefined {
  for (const part of (cookieHeader ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === STATE_COOKIE) return part.slice(i + 1).trim();
  }
}
