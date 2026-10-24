import { NextResponse } from "next/server";
import { makeSession, SESSION_COOKIE } from "@/lib/auth";
import { dashboardPassword } from "@/lib/config";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { password?: string } | null;
  // Slow down guessing a little; it's the only door in.
  await new Promise((r) => setTimeout(r, 400));
  if (!body?.password || body.password !== dashboardPassword()) {
    return NextResponse.json({ error: "Wrong password" }, { status: 401 });
  }
  const session = await makeSession();
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, session.value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: session.maxAge,
  });
  return res;
}
