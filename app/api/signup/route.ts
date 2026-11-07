import { NextResponse } from "next/server";
import { cookieOptions, makeSession, SESSION_COOKIE } from "@/lib/auth";
import { clientIp, limited } from "@/lib/rate-limit";
import { signUp, SignupError } from "@/lib/users";

// { email, name, password, invite, tz } → a new account, signed in. Invite-only for now.
export async function POST(request: Request) {
  if (limited(`signup:${clientIp(request)}`, 5, 60 * 60_000)) {
    return NextResponse.json({ error: "Too many sign-ups from here. Try again in an hour." }, { status: 429 });
  }
  const body = (await request.json().catch(() => null)) as Record<string, string> | null;
  try {
    const u = signUp({ email: body?.email ?? "", name: body?.name ?? "", password: body?.password ?? "", invite: body?.invite ?? "", tz: body?.tz });
    const session = await makeSession(u.id, u.session);
    const res = NextResponse.json({ ok: true });
    res.cookies.set(SESSION_COOKIE, session.value, cookieOptions(session.maxAge));
    return res;
  } catch (e) {
    if (e instanceof SignupError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
