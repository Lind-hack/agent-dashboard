import assert from "node:assert/strict";
import { test } from "node:test";

function wave() {
  const b = Buffer.alloc(46);
  b.write("RIFF"); b.writeUInt32LE(38, 4); b.write("WAVE", 8);
  b.write("fmt ", 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22); b.writeUInt32LE(22050, 24); b.writeUInt32LE(44100, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(2, 40);
  return b;
}

test("accelerated speech uses the documented multipart API and returns playable audio", async (t) => {
  const previousKey = process.env.NVIDIA_API_KEY;
  process.env.NVIDIA_API_KEY = "test-key";
  t.after(() => { if (previousKey === undefined) delete process.env.NVIDIA_API_KEY; else process.env.NVIDIA_API_KEY = previousKey; });
  const expected = wave();
  t.mock.method(globalThis, "fetch", async (url: string | URL | Request, init?: RequestInit) => {
    assert.ok(String(url).endsWith("/v1/audio/synthesize"));
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-key");
    const body = init?.body as FormData;
    assert.equal(body.get("text"), "Hello Lind."); assert.equal(body.get("language"), "en-US");
    assert.equal(body.get("encoding"), "LINEAR_PCM"); assert.equal(body.get("sample_rate_hz"), "22050");
    return new Response(expected, { headers: { "Content-Type": "audio/wav" } });
  });
  const { magpieWav } = await import("../lib/magpie.ts?valid" as string);
  assert.deepEqual(await magpieWav("Hello Lind."), expected);
});

test("invalid provider audio falls back and opens a circuit instead of retrying each turn", async (t) => {
  const previousKey = process.env.NVIDIA_API_KEY; process.env.NVIDIA_API_KEY = "test-key";
  t.after(() => { if (previousKey === undefined) delete process.env.NVIDIA_API_KEY; else process.env.NVIDIA_API_KEY = previousKey; });
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; return new Response("<html>not speech</html>"); });
  const { magpieWav, magpieReady } = await import("../lib/magpie.ts?invalid" as string);
  assert.equal(await magpieWav("Hello."), null); assert.equal(magpieReady(), false);
  assert.equal(await magpieWav("Next turn."), null); assert.equal(calls, 1);
});

test("cancelling a turn does not disable the provider for the next conversation", async (t) => {
  const previousKey = process.env.NVIDIA_API_KEY; process.env.NVIDIA_API_KEY = "test-key";
  t.after(() => { if (previousKey === undefined) delete process.env.NVIDIA_API_KEY; else process.env.NVIDIA_API_KEY = previousKey; });
  const { magpieWav, magpieReady } = await import("../lib/magpie.ts?cancel" as string);
  const ctl = new AbortController(); ctl.abort();
  assert.equal(await magpieWav("Cancelled.", ctl.signal), null); assert.equal(magpieReady(), true);
});
