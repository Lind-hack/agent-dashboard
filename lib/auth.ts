// Sessions. The cookie is "<user>~<session no.>~<expiry ms>.<hmac>", signed with SESSION_SECRET.
// Cookies from before accounts ("<expiry ms>.<hmac>") belong to the owner, so Lind stays signed in.
// Web Crypto only, so the same code runs in proxy.ts and in route handlers. The session number is checked
// against the user record in lib/guard.ts (bumping it signs that user out everywhere).

export const SESSION_COOKIE = "ad_session";
const MAX_AGE_S = 60 * 60 * 24 * 30;

async function hmac(data: string): Promise<string> {
  const secret = process.env.SESSION_SECRET ?? "";
  if (!secret) throw new Error("Missing env SESSION_SECRET");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

export type Session = { user: string; session: number };

export async function makeSession(user = "owner", session = 0): Promise<{ value: string; maxAge: number }> {
  if (!/^[\w-]+$/.test(user)) throw new Error("bad user id");
  const payload = `${user}~${session}~${Date.now() + MAX_AGE_S * 1000}`;
  return { value: `${payload}.${await hmac(payload)}`, maxAge: MAX_AGE_S };
}

export async function readSession(value: string | undefined): Promise<Session | null> {
  if (!value) return null;
  const dot = value.lastIndexOf(".");
  if (dot < 1) return null;
  const payload = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  const parts = payload.split("~");
  const [user, session, expiry] = parts.length === 3 ? parts : ["owner", "0", parts[0]];
  if (parts.length !== 1 && parts.length !== 3) return null;
  if (!user || !/^[\w-]+$/.test(user) || !/^\d+$/.test(session) || !/^\d+$/.test(expiry ?? "") || Number(expiry) < Date.now()) return null;
  const expected = await hmac(payload);
  if (expected.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0 ? { user, session: Number(session) } : null;
}

export async function verifySession(value: string | undefined): Promise<boolean> {
  return (await readSession(value)) !== null;
}

export const cookieOptions = (maxAge: number) => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge,
});
