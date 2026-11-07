import { NextResponse } from "next/server";
import { forgetCreds } from "@/lib/calendar";
import { guarded } from "@/lib/guard";
import { authUrl, googleOAuthReady, newState, STATE_COOKIE } from "@/lib/google-oauth";
import { isOwner } from "@/lib/tenant";

export const dynamic = "force-dynamic";

// GET → off to Google's consent screen. DELETE → disconnect (the stored refresh token is deleted).
async function GET_(req: Request) {
  if (isOwner()) return NextResponse.json({ error: "The owner's Google sign-in comes from the PC script (google-auth)." }, { status: 400 });
  if (!googleOAuthReady()) return NextResponse.json({ error: "Google sign-in isn't set up on this server yet. Use a calendar link instead." }, { status: 404 });
  const state = newState();
  const res = NextResponse.redirect(authUrl(req, state));
  // Back to the setup guide or to Settings, whichever page the button was on.
  const back = new URL(req.url).searchParams.get("back") === "setup" ? "setup" : "settings";
  res.cookies.set(STATE_COOKIE, `${state}.${back}`, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/api/calendar/google", maxAge: 600 });
  return res;
}

async function DELETE_() {
  if (isOwner()) return NextResponse.json({ error: "The owner's Google sign-in is managed from the PC." }, { status: 400 });
  forgetCreds();
  return NextResponse.json({ ok: true });
}

export const GET = guarded(GET_);
export const DELETE = guarded(DELETE_);
