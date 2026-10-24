// Single-user password login. The cookie is "<expiry ms>.<hmac>", signed with SESSION_SECRET.
// Web Crypto only, so the same code runs in proxy.ts and in route handlers.

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

export async function makeSession(): Promise<{ value: string; maxAge: number }> {
  const expiry = String(Date.now() + MAX_AGE_S * 1000);
  return { value: `${expiry}.${await hmac(expiry)}`, maxAge: MAX_AGE_S };
}

export async function verifySession(value: string | undefined): Promise<boolean> {
  if (!value) return false;
  const [expiry, sig] = value.split(".");
  if (!expiry || !sig || Number(expiry) < Date.now()) return false;
  const expected = await hmac(expiry);
  if (expected.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
