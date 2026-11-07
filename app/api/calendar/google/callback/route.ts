import { NextResponse } from "next/server";
import { saveCreds } from "@/lib/calendar";
import { guarded } from "@/lib/guard";
import { exchangeCode, googleOAuthReady, publicOrigin, STATE_COOKIE, stateFrom } from "@/lib/google-oauth";
import { isOwner } from "@/lib/tenant";

export const dynamic = "force-dynamic";

// Google sends the browser back here with ?code&state. The state must match the cookie set on the way out,
// so another site can't attach its own calendar to this account.
async function GET_(req: Request) {
  const u = new URL(req.url);
  const [expected, page] = (stateFrom(req.headers.get("cookie")) ?? "").split(".");
  const back = (msg: string) => {
    const res = NextResponse.redirect(`${publicOrigin(req)}/${page === "setup" ? "setup" : "settings"}?calendar=${encodeURIComponent(msg)}#calendar`);
    res.cookies.set(STATE_COOKIE, "", { path: "/api/calendar/google", maxAge: 0 });
    return res;
  };
  if (isOwner() || !googleOAuthReady()) return back("Google sign-in isn't available here");
  if (u.searchParams.get("error")) return back("Google sign-in was cancelled");
  const state = u.searchParams.get("state");
  if (!expected || !state || state !== expected) return back("That sign-in link expired. Try again");
  const code = u.searchParams.get("code");
  if (!code) return back("Google didn't send a sign-in code");
  try {
    const t = await exchangeCode(req, code);
    saveCreds({ client_id: process.env.GOOGLE_OAUTH_CLIENT_ID!, client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET!, refresh_token: t.refresh_token, scopes: t.scopes });
  } catch (e) {
    return back(e instanceof Error ? e.message : "Google sign-in failed");
  }
  return back("connected");
}

export const GET = guarded(GET_);
