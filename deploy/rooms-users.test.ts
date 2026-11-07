import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "rooms-users-test-"));
process.env.MEMORY_VAULT_DIR = path.join(process.env.DATA_DIR, "owner-vault");
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.GROQ_API_KEY = "gsk_OWNER_KEY_1234";
process.env.GEMINI_API_KEY = "AIza_OWNER_GEMINI";
delete process.env.NVIDIA_API_KEY;

const { createInvite, signUp, tenantOf } = await import("../lib/users");
const { runAs, ownerTenant } = await import("../lib/tenant");
const { setKey } = await import("../lib/user-keys");
const { listRooms, readRoom } = await import("../lib/rooms");
const { POST: roomsPOST } = await import("../app/api/rooms/route");
const { POST: roomPOST } = await import("../app/api/rooms/[id]/route");
const { roomTick } = await import("../runner/room");

const realFetch = globalThis.fetch;
test.after(() => {
  globalThis.fetch = realFetch;
});

function newUser(email: string) {
  return signUp({ email, name: "Mira", password: "long enough pw", invite: createInvite("t").code, tz: "UTC" });
}

// Answers like a model would, by what the prompt asks for. Records every request.
const seen: string[] = [];
function fakeModels() {
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const body = String(init?.body ?? "");
    seen.push(`${url} ${JSON.stringify(init?.headers ?? {})} ${body}`);
    const reply = body.includes("neutral judge of a debate")
      ? { agreement: 90, open_disagreements: [], per_agent: [], unverified_claims: [], scores: [] }
      : body.includes("closing")
        ? { recommendation: "Do A.", decision: "Do A first.", why: "Cheaper.", positions: [], dissent: [], next_step: "Start A", actions: [{ title: "Start A", who: "lind" }], confidence: 70, support: {} }
        : { argument: "I think A, because it is cheaper.", position: "Do A", confidence: 0.7, agrees_with: [], weakest_claims: [], evidence: [] };
    const text = JSON.stringify(reply);
    const payload = String(url).includes("generativelanguage") ? { candidates: [{ content: { parts: [{ text }] } }] } : { choices: [{ message: { content: text } }] };
    return new Response(JSON.stringify(payload), { status: 200 });
  }) as typeof fetch;
}

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return { method: "POST", body: f };
};

async function settle(fn: () => void, until: () => boolean) {
  for (let i = 0; i < 200 && !until(); i++) {
    fn();
    await new Promise((r) => setTimeout(r, 5));
  }
}

test("a user's debate runs on their own keys, start to verdict, and only they can see it", async () => {
  const u = newUser("mira@example.com");
  const t = tenantOf(u);
  fakeModels();
  const id = await runAs(t, async () => {
    setKey("GEMINI_API_KEY", "AIza_MIRA");
    setKey("GROQ_API_KEY", "gsk_MIRA");
    const res = await roomsPOST(new Request("http://x/api/rooms", form({ text: "A or B?", providers: "gemini,groq,openai", context: "A costs 10, B costs 20" })));
    assert.equal(res.status, 200);
    return ((await res.json()) as { id: string }).id;
  });
  const room0 = runAs(t, () => readRoom(id))!;
  assert.deepEqual(room0.providers, ["gemini", "groq"], "a provider without a key is dropped");
  assert.deepEqual(room0.agents, []);

  await settle(
    () => runAs(t, () => roomTick({ take: () => false, release: () => {} })),
    () => runAs(t, () => readRoom(id))?.status === "done",
  );
  const room = runAs(t, () => readRoom(id))!;
  assert.equal(room.status, "done");
  assert.equal(room.verdict?.decision, "Do A first.");
  assert.equal(room.rounds[0].answers["ai:gemini"]?.status, "done");
  assert.equal(room.rounds[0].answers["ai:groq"]?.json?.position, "Do A");
  assert.match(room.rounds[0].answers["ai:groq"]?.text ?? "", /cheaper/);
  assert.ok(seen.length > 0);
  assert.ok(!seen.join("\n").includes("OWNER"), "the owner's keys are never used");
  assert.ok(seen.some((s) => s.includes("A costs 10")), "the pasted notes reach the debaters");

  assert.ok(!runAs(ownerTenant(), () => listRooms()).some((r) => r.id === id), "the owner's room list doesn't show it");
  assert.equal(runAs(newUserTenant(), () => readRoom(id)), null, "another account can't open it");
});

function newUserTenant() {
  return tenantOf(newUser(`other${Date.now()}@example.com`));
}

test("a user needs two seats at the table, can't hand a verdict to a coding agent, and can stop a room", async () => {
  const t = tenantOf(newUser("ben@example.com"));
  fakeModels();
  await runAs(t, async () => {
    const none = await roomsPOST(new Request("http://x/api/rooms", form({ text: "A or B?", providers: "gemini" })));
    assert.equal(none.status, 400, "no key yet");
    setKey("GEMINI_API_KEY", "AIza_BEN");
    const one = await roomsPOST(new Request("http://x/api/rooms", form({ text: "A or B?", providers: "gemini" })));
    assert.equal(one.status, 400, "one AI alone can't debate");
    setKey("GROQ_API_KEY", "gsk_BEN");
    const ok = await roomsPOST(new Request("http://x/api/rooms", form({ text: "A or B?", providers: "gemini,groq" })));
    const { id } = (await ok.json()) as { id: string };
    const ctx = { params: Promise.resolve({ id }) };
    const run = await roomPOST(new Request(`http://x/api/rooms/${id}`, { method: "POST", body: JSON.stringify({ action: "run", agent: "claude" }) }), ctx);
    assert.equal(run.status, 403);
    const stop = await roomPOST(new Request(`http://x/api/rooms/${id}`, { method: "POST", body: JSON.stringify({ action: "cancel" }) }), ctx);
    assert.equal(stop.status, 200);
    roomTick({ take: () => false, release: () => {} });
    assert.equal(readRoom(id)?.status, "cancelled");
  });
});
