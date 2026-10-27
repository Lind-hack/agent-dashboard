import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runAgent } from "./agents";

const quota = 'timestamp=2026-10-27T21:41:14.891Z level=ERROR run=test message="stream error" providerID=opencode modelID=deepseek-v4.1-flash-free small=false agent=build error.error="AI_APICallError: Free usage limit reached."\n';

// Exercise the real process/stream boundary: the regression was a CLI that logged an error,
// emitted no JSON result, and never exited. No external model requests in these tests.
async function fixture(source: string, check: (bin: string) => Promise<void>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-test-"));
  const bin = path.join(dir, "opencode");
  fs.writeFileSync(bin, `#!/usr/bin/env node\n${source}`, { mode: 0o755 });
  const previous = process.env.OPENCODE_BIN;
  process.env.OPENCODE_BIN = bin;
  try {
    await check(bin);
  } finally {
    if (previous === undefined) delete process.env.OPENCODE_BIN;
    else process.env.OPENCODE_BIN = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function run(onEvent: (e: Record<string, unknown>) => void = () => {}, timeoutMs = 2000) {
  return runAgent({ agent: "opencode", cwd: os.tmpdir(), prompt: "hey", onEvent, onChild: () => {}, timeoutMs });
}

test("stderr-only free quota failure stops a hanging CLI, including split chunks", async () => {
  await fixture(`
    const args = process.argv.slice(2);
    if (!args.includes('--print-logs') || !args.includes('ERROR')) process.exit(2);
    process.stderr.write(${JSON.stringify(quota.slice(0, 140))});
    setTimeout(() => process.stderr.write(${JSON.stringify(quota.slice(140))}), 20);
    setInterval(() => {}, 1000);
  `, async () => {
    const events: Record<string, unknown>[] = [];
    const result = await run((e) => events.push(e));
    assert.equal(result.ok, false);
    assert.match(result.result, /free usage limit/);
    assert.match(result.result, /No paid fallback/);
    assert.equal(events.filter((e) => e.kind === "error").length, 1);
  });
});

test("title quota errors do not fail a successful answer; final line needs no newline", async () => {
  await fixture(`
    process.stderr.write(${JSON.stringify(quota.replace("small=false", "small=true"))});
    console.log(JSON.stringify({type:'text', sessionID:'ses_test', part:{text:'Hello'}}));
    process.stdout.write(JSON.stringify({type:'step_finish', part:{reason:'stop', cost:0}}));
  `, async () => {
    const result = await run();
    assert.deepEqual(result, { ok: true, sessionId: "ses_test", result: "Hello", costUsd: 0 });
  });
});

test("a JSON provider error also stops a hanging CLI and preserves the session", async () => {
  await fixture(`
    console.log(JSON.stringify({type:'error', sessionID:'ses_error', error:{data:{message:'Provider unavailable'}}}));
    setInterval(() => {}, 1000);
  `, async () => {
    const result = await run();
    assert.deepEqual(result, { ok: false, sessionId: "ses_error", result: "Provider unavailable" });
  });
});

test("timeouts survive process termination as the actionable failure", async () => {
  await fixture("setInterval(() => {}, 1000);", async () => {
    const result = await run(undefined, 100);
    assert.equal(result.ok, false);
    assert.match(result.result, /Timed out/);
  });
});

test("OpenCode with no progress stops after three minutes", async (t) => {
  await fixture(`
    console.log(JSON.stringify({type:'step_start', sessionID:'ses_idle'}));
    setInterval(() => {}, 1000);
  `, async () => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    try {
      const result = await run((e) => {
        if (e.kind === "init") {
          // onLine resets the watchdog after emitting init; advance after that callback returns.
          setImmediate(() => t.mock.timers.tick(3 * 60_000));
        }
      }, 45 * 60_000);
      assert.equal(result.ok, false);
      assert.match(result.result, /no progress for 3 min/);
    } finally {
      t.mock.timers.reset();
    }
  });
});
