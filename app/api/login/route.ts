import { NextResponse } from "next/server";
import { cookieOptions, makeSession, SESSION_COOKIE } from "@/lib/auth";
import { dashboardPassword } from "@/lib/config";
import { clientIp, limited } from "@/lib/rate-limit";
import { logIn, normEmail } from "@/lib/users";

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(SESSION_COOKIE);
  return res;
}

// { email, password }. The owner signs in with DASHBOARD_PASSWORD and no email (or OWNER_EMAIL);
// everyone else with the account they signed up with.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { email?: string; password?: string } | null;
  // Slow down guessing a little, and stop it after a few tries.
  await new Promise((r) => setTimeout(r, 400));
  if (limited(`login:${clientIp(request)}`, 10, 10 * 60_000)) {
    return NextResponse.json({ error: "Too many tries. Wait ten minutes and try again." }, { status: 429 });
  }
  const email = normEmail(body?.email ?? "");
  const password = String(body?.password ?? "");
  const ownerEmail = normEmail(process.env.OWNER_EMAIL ?? "");
  let session: { value: string; maxAge: number } | null = null;
  if ((!email || (ownerEmail && email === ownerEmail)) && password && password === dashboardPassword()) {
    session = await makeSession("owner", 0);
  } else if (email) {
    const u = logIn(email, password);
    if (u) session = await makeSession(u.id, u.session);
  }
  if (!session) return NextResponse.json({ error: email ? "Wrong email or password" : "Wrong password" }, { status: 401 });
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, session.value, cookieOptions(session.maxAge));
  return res;
}
