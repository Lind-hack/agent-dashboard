import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "kuvend-link-test-"));
process.env.MEMORY_VAULT_DIR = path.join(process.env.DATA_DIR, "owner-vault");
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";

const { createInvite, signUp, tenantOf } = await import("../lib/users");
const { runAs, ownerTenant } = await import("../lib/tenant");
const { setKey } = await import("../lib/user-keys");
const { readRoom } = await import("../lib/rooms");
const { newLinkCode, revokeLinkCodes, tenantFromLinkCode } = await import("../lib/kuvend-link");
const { isKuvendRoute } = await import("../lib/bearer-routes");
const { POST: startPOST } = await import("../app/api/kuvend/rooms/route");
const { GET: roomGET } = await import("../app/api/kuvend/rooms/[id]/route");
const { GET: todosGET } = await import("../app/api/todos/route");

const user = (email: string) => tenantOf(signUp({ email, name: "Ana", password: "long enough pw", invite: createInvite("t").code, tz: "UTC" }));
const bearer = (code: string, body?: unknown) => ({ method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${code}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });

test("a link code starts a room in its own account, on that account's keys, and reads it back", async () => {
  const t = user("ana@example.com");
  const code = runAs(t, () => {
    setKey("GEMINI_API_KEY", "AIza_ANA");
    setKey("GROQ_API_KEY", "gsk_ANA");
    return newLinkCode(t);
  });
  assert.match(code, /^kvd_u_[0-9a-f]{16}_/);
  const res = await startPOST(new Request("http://x/api/kuvend/rooms", bearer(code, { task: "Is this change right?", context: "diff --git a/x b/x" })));
  assert.equal(res.status, 200);
  const { id } = (await res.json()) as { id: string };
  const room = runAs(t, () => readRoom(id))!;
  assert.deepEqual(room.providers, ["gemini", "groq"]);
  assert.deepEqual(room.seats, ["graham", "musk"]);
  assert.match(room.context ?? "", /diff --git/);
  assert.equal(runAs(ownerTenant(), () => readRoom(id)), null, "not in the owner's rooms");

  const got = await roomGET(new Request(`http://x/api/kuvend/rooms/${id}`, bearer(code)), { params: Promise.resolve({ id }) });
  assert.equal(((await got.json()) as { status: string }).status, "queued");
});

test("a code opens nothing else, a wrong or revoked code opens nothing, and the owner can link too", async () => {
  const t = user("ben@example.com");
  const code = runAs(t, () => newLinkCode(t));
  assert.ok(isKuvendRoute("/api/kuvend/rooms") && isKuvendRoute("/api/kuvend/rooms/R-ABC123DEF"));
  assert.ok(!isKuvendRoute("/api/kuvend/link") && !isKuvendRoute("/api/todos"));
  const todos = await todosGET(new Request("http://x/api/todos", bearer(code)));
  assert.equal(todos.status, 401, "the code is not a login");
  const forged = code.replace(/.$/, (c) => (c === "A" ? "B" : "A"));
  assert.equal((await startPOST(new Request("http://x/api/kuvend/rooms", bearer(forged, { task: "x" })))).status, 401);
  runAs(t, () => revokeLinkCodes());
  assert.equal(tenantFromLinkCode(code), null);

  const ownerCode = runAs(ownerTenant(), () => newLinkCode(ownerTenant()));
  assert.match(ownerCode, /^kvd_owner_/);
  assert.equal(tenantFromLinkCode(ownerCode)?.owner, true);
});
