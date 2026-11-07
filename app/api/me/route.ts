import { NextResponse } from "next/server";
import { cookieOptions, makeSession, SESSION_COOKIE } from "@/lib/auth";
import { guarded } from "@/lib/guard";
import { currentTenant } from "@/lib/tenant";
import { deleteUser, findUser, logIn, SignupError, updateUser } from "@/lib/users";

export const dynamic = "force-dynamic";

// The signed-in account. PATCH { name?, tz?, setupDone?, password?, current? } · POST { signOutEverywhere: true }
// · DELETE { password } removes the account and everything in it. The owner's account lives in the env file.
async function GET_() {
  const t = currentTenant();
  const u = t.owner ? null : findUser(t.id);
  return NextResponse.json({ owner: t.owner, name: t.name, tz: t.tz, email: u?.email ?? null, setupDone: u?.setupDone ?? true });
}

function mine() {
  const t = currentTenant();
  if (t.owner) throw new SignupError("The owner's account is set in /etc/agent-dashboard.env");
  const u = findUser(t.id);
  if (!u) throw new SignupError("No such account");
  return u;
}

async function PATCH_(req: Request) {
  const b = (await req.json().catch(() => null)) as { name?: string; tz?: string; setupDone?: boolean; password?: string; current?: string } | null;
  try {
    const u = mine();
    if (b?.password !== undefined && !logIn(u.email, String(b.current ?? ""))) throw new SignupError("Your current password isn't right");
    const next = updateUser(u.id, { name: b?.name, tz: b?.tz, setupDone: b?.setupDone, password: b?.password });
    const res = NextResponse.json({ ok: true });
    // A new password signs out every other device; this one gets a fresh cookie.
    if (b?.password !== undefined) {
      const s = await makeSession(next.id, next.session);
      res.cookies.set(SESSION_COOKIE, s.value, cookieOptions(s.maxAge));
    }
    return res;
  } catch (e) {
    if (e instanceof SignupError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
}

async function POST_(req: Request) {
  const b = (await req.json().catch(() => null)) as { signOutEverywhere?: boolean } | null;
  try {
    const u = mine();
    if (!b?.signOutEverywhere) return NextResponse.json({ error: "Nothing to do" }, { status: 400 });
    updateUser(u.id, { signOutEverywhere: true });
    const res = NextResponse.json({ ok: true });
    res.cookies.delete(SESSION_COOKIE);
    return res;
  } catch (e) {
    if (e instanceof SignupError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
}

async function DELETE_(req: Request) {
  const b = (await req.json().catch(() => null)) as { password?: string } | null;
  try {
    const u = mine();
    if (!logIn(u.email, String(b?.password ?? ""))) throw new SignupError("Type your password to delete the account");
    deleteUser(u.id);
    const res = NextResponse.json({ ok: true });
    res.cookies.delete(SESSION_COOKIE);
    return res;
  } catch (e) {
    if (e instanceof SignupError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
}

export const GET = guarded(GET_);
export const PATCH = guarded(PATCH_);
export const POST = guarded(POST_);
export const DELETE = guarded(DELETE_);
