import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "multi-user-test-"));
process.env.MEMORY_VAULT_DIR = path.join(process.env.DATA_DIR, "owner-vault");
process.env.DASHBOARD_TZ = "Europe/Belgrade";
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.DASHBOARD_PASSWORD = "owner-password";
process.env.GROQ_API_KEY = "gsk_OWNER_KEY_1234";
process.env.GEMINI_API_KEY = "AIza_OWNER_GEMINI";
process.env.LINEAR_API_KEY = "lin_owner";
process.env.GITHUB_TOKEN = "ghp_owner";
delete process.env.NVIDIA_API_KEY;

const { createInvite, signUp, logIn, tenantOf, updateUser, findUser, SignupError, listInvites } = await import("../lib/users");
const { runAs, ownerTenant, dataDir, currentTenant, perTenant, personalize, NoTenantError } = await import("../lib/tenant");
const { apiKey, setKey } = await import("../lib/user-keys");
const { addTodo, listTodos } = await import("../lib/todos");
const { listJobs, writeJob } = await import("../lib/store");
const { makeSession, readSession } = await import("../lib/auth");
const { tenantFromCookie, guarded } = await import("../lib/guard");
const { groqJSON } = await import("../lib/groq");
const { linearKey, githubToken } = await import("../lib/config");
const { POST: loginPOST } = await import("../app/api/login/route");
const { POST: signupPOST } = await import("../app/api/signup/route");
const { GET: todosGET } = await import("../app/api/todos/route");
const { GET: peopleGET } = await import("../app/api/people/route");

const realFetch = globalThis.fetch;
test.after(() => {
  globalThis.fetch = realFetch;
});

const json = (body: unknown, headers: Record<string, string> = {}) => ({ method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
const cookieOf = (res: Response) => /ad_session=([^;]+)/.exec(res.headers.get("set-cookie") ?? "")?.[1] ?? "";

function newUser(email: string, name = "Ana") {
  const code = createInvite("test").code;
  return signUp({ email, name, password: "long enough pw", invite: code, tz: "America/New_York" });
}

test("sign-up needs an unused invite, and the code forgives dashes and case", () => {
  assert.throws(() => signUp({ email: "x@y.co", name: "X", password: "long enough pw", invite: "NOPE-NOPE1" }), SignupError);
  const code = createInvite().code;
  const u = signUp({ email: "First@Example.com", name: "First", password: "long enough pw", invite: code.toLowerCase().replace("-", " "), tz: "Not/AZone" });
  assert.equal(u.email, "first@example.com");
  assert.equal(u.tz, "UTC", "a made-up zone falls back to UTC");
  assert.throws(() => signUp({ email: "second@example.com", name: "S", password: "long enough pw", invite: code }), /already used/);
  assert.equal(listInvites().find((i) => i.code === code)?.usedBy, u.id);
  assert.throws(() => newUser("FIRST@example.com"), /already an account/);
  assert.throws(() => signUp({ email: "short@example.com", name: "S", password: "short", invite: createInvite().code }), /10 characters/);
});

test("passwords are hashed, and a wrong email and a wrong password look the same", () => {
  const u = newUser("hash@example.com");
  const raw = fs.readFileSync(path.join(process.env.DATA_DIR!, "users.json"), "utf8");
  assert.ok(!raw.includes("long enough pw"));
  assert.equal(logIn("hash@example.com", "long enough pw")?.id, u.id);
  assert.equal(logIn("hash@example.com", "wrong password"), null);
  assert.equal(logIn("nobody@example.com", "long enough pw"), null);
});

test("each account has its own folder: one user's tasks never show up for another or the owner", () => {
  const a = newUser("a@example.com", "Ana");
  const b = newUser("b@example.com", "Ben");
  runAs(ownerTenant(), () => addTodo({ title: "Owner task", day: "2026-11-07" }));
  runAs(tenantOf(a), () => addTodo({ title: "Ana's task", day: "2026-11-07" }));
  assert.deepEqual(runAs(tenantOf(a), () => listTodos().map((t) => t.title)), ["Ana's task"]);
  assert.deepEqual(runAs(tenantOf(b), () => listTodos().map((t) => t.title)), []);
  assert.deepEqual(runAs(ownerTenant(), () => listTodos().map((t) => t.title)), ["Owner task"]);
  assert.equal(runAs(tenantOf(a), dataDir), path.join(process.env.DATA_DIR!, "tenants", a.id));
  assert.equal(runAs(ownerTenant(), dataDir), process.env.DATA_DIR, "the owner's data stays where it always was");
});

test("other accounts never use the owner's keys, and their own are stored encrypted", () => {
  const a = newUser("keys@example.com");
  runAs(tenantOf(a), () => {
    assert.equal(apiKey("GROQ_API_KEY"), "");
    assert.equal(apiKey("GEMINI_API_KEY"), "");
    setKey("GEMINI_API_KEY", "AIza_users_own_key_9876");
    assert.equal(apiKey("GEMINI_API_KEY"), "AIza_users_own_key_9876");
    assert.ok(!fs.readFileSync(path.join(dataDir(), "keys.json"), "utf8").includes("users_own_key"));
    assert.throws(() => linearKey(), /Not available/);
    assert.throws(() => githubToken(), /Not available/);
  });
  assert.equal(runAs(ownerTenant(), () => apiKey("GROQ_API_KEY")), "gsk_OWNER_KEY_1234");
  assert.throws(() => runAs(ownerTenant(), () => setKey("GROQ_API_KEY", "x")));
});

test("an account with no keys makes no AI call at all, and one with a key uses only that key", async () => {
  const a = newUser("nokey@example.com");
  const seen: string[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    seen.push(`${url} ${JSON.stringify(init?.headers ?? {})}`);
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] }), { status: 200 });
  }) as typeof fetch;
  assert.equal(await runAs(tenantOf(a), () => groqJSON("sys", "user")), null);
  assert.equal(seen.length, 0);
  await runAs(tenantOf(a), async () => {
    setKey("GEMINI_API_KEY", "AIza_mine");
    assert.deepEqual(await groqJSON<{ ok: boolean }>("You help Lind.", "Lind asks"), { ok: true });
  });
  assert.equal(seen.length, 1);
  assert.match(seen[0], /generativelanguage/);
  assert.match(seen[0], /AIza_mine/);
  assert.ok(!seen.join().includes("OWNER"), "the owner's keys never leave for another account");
});

test("prompts written for Lind name the account's owner instead", () => {
  const a = newUser("name@example.com", "Mira");
  runAs(tenantOf(a), () => {
    const s = personalize("Plan Lind's day. Lind is busy.", true);
    assert.match(s, /Plan Mira's day\. Mira is busy\./);
    assert.match(s, /don't assume their gender/);
    assert.ok(!/\bLind\b/.test(s));
  });
  assert.equal(runAs(ownerTenant(), () => personalize("Lind")), "Lind");
});

test("coding-agent chats are the owner's alone", () => {
  runAs(ownerTenant(), () => writeJob({ id: "J-1", title: "Owner chat", agent: "claude", repo: "Lind-hack/x", status: "queued", turns: [], seenCommentIds: [], createdAt: "2026-11-07T00:00:00Z", updatedAt: "2026-11-07T00:00:00Z" } as never));
  assert.equal(runAs(ownerTenant(), listJobs).length, 1);
  const a = newUser("jobs@example.com");
  assert.equal(runAs(tenantOf(a), listJobs).length, 0);
});

test("state kept per account stays per account", () => {
  const a = newUser("state@example.com");
  const s = perTenant(() => ({ n: 0 }));
  runAs(tenantOf(a), () => (s().n = 5));
  assert.equal(runAs(ownerTenant(), () => s().n), 0);
  assert.equal(runAs(tenantOf(a), () => s().n), 5);
});

test("sessions: old cookies are the owner's, new ones carry the account, and signing out everywhere ends them", async () => {
  // A cookie from before accounts: "<expiry>.<hmac of expiry>".
  const { createHmac } = await import("node:crypto");
  const expiry = String(Date.now() + 60_000);
  const legacy = `${expiry}.${createHmac("sha256", process.env.SESSION_SECRET!).update(expiry).digest("hex")}`;
  assert.deepEqual(await readSession(legacy), { user: "owner", session: 0 });
  assert.equal((await tenantFromCookie(legacy))?.owner, true);
  assert.equal(await readSession(`${expiry}.${"0".repeat(64)}`), null);

  const a = newUser("session@example.com");
  const c = (await makeSession(a.id, a.session)).value;
  assert.equal((await tenantFromCookie(c))?.id, a.id);
  updateUser(a.id, { signOutEverywhere: true });
  assert.equal(await tenantFromCookie(c), null);
  updateUser(a.id, { disabled: true });
  const c2 = (await makeSession(a.id, findUser(a.id)!.session)).value;
  assert.equal(await tenantFromCookie(c2), null, "a paused account can't sign in");
  // Tampering with the user part breaks the signature.
  const forged = c.replace(a.id, "owner");
  assert.equal(await readSession(forged), null);
});

test("login and sign-up routes: owner by password, accounts by email, and the cookie opens only your own data", async () => {
  const owner = await loginPOST(new Request("http://x/api/login", json({ password: "owner-password" })));
  assert.equal(owner.status, 200);
  const bad = await loginPOST(new Request("http://x/api/login", json({ email: "a@example.com", password: "owner-password" })));
  assert.equal(bad.status, 401, "the owner password doesn't open someone else's account");

  const code = createInvite().code;
  const res = await signupPOST(new Request("http://x/api/signup", json({ email: "route@example.com", name: "Rae", password: "long enough pw", invite: code, tz: "Europe/Paris" })));
  assert.equal(res.status, 200);
  const cookie = cookieOf(res);
  const u = findUser((await readSession(cookie))!.user)!;
  runAs(tenantOf(u), () => addTodo({ title: "Rae's own", day: "2026-11-07" }));

  const mine = await todosGET(new Request("http://x/api/todos", { headers: { cookie: `ad_session=${cookie}` } }));
  const body = JSON.stringify(await mine.json());
  assert.match(body, /Rae's own/);
  assert.ok(!body.includes("Owner task") && !body.includes("Ana's task"));

  const people = await peopleGET(new Request("http://x/api/people", { headers: { cookie: `ad_session=${cookie}` } }));
  assert.equal(people.status, 403, "only the owner sees the people list");
  const anon = await todosGET(new Request("http://x/api/todos", { headers: { cookie: "ad_session=nonsense.abc" } }));
  assert.equal(anon.status, 401);
});

test("inside the web server, code that forgot to say whose data it reads fails instead of reading the owner's", async () => {
  process.env.NEXT_RUNTIME = "nodejs";
  try {
    assert.throws(() => dataDir(), NoTenantError);
    assert.equal(runAs(ownerTenant(), () => currentTenant().owner), true);
    const wrapped = guarded(async () => new Response(dataDir()));
    const res = await wrapped(new Request("http://x/api/anything"));
    assert.equal(res.status, 401);
  } finally {
    delete process.env.NEXT_RUNTIME;
  }
});

test("Lind's own life is left out of another account's instructions, but their own words are kept", async () => {
  const { withoutOwnerBio } = await import("../lib/tenant");
  const a = newUser("bio@example.com", "Noa");
  runAs(tenantOf(a), () => {
    const sys = personalize("You are Lind's Buddy. Lind is a first-year CS student in Pristina; he runs the @building.ai TikTok. Be honest.", true);
    assert.ok(!/TikTok|Pristina|CS student/.test(sys), sys);
    assert.match(sys, /You are Noa's Buddy\./);
    assert.match(sys, /Be honest\./);
    assert.equal(personalize("I posted a TikTok today."), "I posted a TikTok today.");
  });
  assert.equal(withoutOwnerBio("My notes. I posted a TikTok about the 383 news site."), "My notes. I posted a TikTok about the 383 news site.");
});
