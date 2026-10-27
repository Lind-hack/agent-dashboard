import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "memory-settings-"));
process.env.DATA_DIR = dir;
const { readMemorySettings, writeMemorySettings } = await import("../lib/memory-settings");
test("capture is opt-in, persists, and fails closed on damaged settings", () => {
  assert.equal(readMemorySettings().enabled, false);
  writeMemorySettings(true);
  assert.equal(readMemorySettings().enabled, true);
  writeMemorySettings(false);
  assert.equal(readMemorySettings().enabled, false);
  fs.writeFileSync(path.join(dir, "memory-settings.json"), '{"enabled":"yes"}');
  assert.equal(readMemorySettings().enabled, false);
});

test("collector credentials can read policy but cannot enable capture", async () => {
  const { GET, PUT } = await import("../app/api/memory/settings/route");
  const read = await GET();
  assert.equal((await read.json()).enabled, false);
  const denied = await PUT(new Request("http://localhost/api/memory/settings", { method: "PUT", headers: { authorization: "Bearer collector", "Content-Type": "application/json" }, body: JSON.stringify({ enabled: true }) }));
  assert.equal(denied.status, 403);
  const invalid = await PUT(new Request("http://localhost/api/memory/settings", { method: "PUT", body: JSON.stringify({ enabled: "yes" }) }));
  assert.equal(invalid.status, 400);
});

test("chat ingestion is blocked while disabled, then redacted and queued when enabled", async () => {
  const { gzipSync } = await import("node:zlib");
  const { POST } = await import("../app/api/brain/ingest/route");
  const item = { kind: "chat", id: "test", agent: "claude", text: "GROQ_API_KEY=gsk_abcdefghijklmnopqrstuvwxyz012345" };
  const request = () => new Request("http://localhost/api/brain/ingest", { method: "POST", body: gzipSync(JSON.stringify(item)) });
  assert.equal((await POST(request())).status, 409);
  assert.equal(fs.existsSync(path.join(dir, "brain/inbox/chat-test.json")), false);
  writeMemorySettings(true);
  assert.equal((await POST(request())).status, 200);
  assert.doesNotMatch(fs.readFileSync(path.join(dir, "brain/inbox/chat-test.json"), "utf8"), /gsk_abcdefghijklmnopqrstuvwxyz/);
  writeMemorySettings(false);
});

test("dashboard backfill uses per-chat cursors and respects capture policy", async () => {
  const { queueDashboardChats } = await import("../runner/brain");
  const { writeJob } = await import("../lib/store");
  const state = { pages: {}, github: {}, seenShas: {} };
  const fixture = (id: string, ago: number, status: string) => {
    writeJob({ id } as never); // establish store directory; fixture timestamps must survive writeJob
    fs.writeFileSync(path.join(dir, "jobs", `${id}.json`), JSON.stringify({ id, agent: "codex", title: id, status, updatedAt: new Date(Date.now() - ago).toISOString(), createdAt: "2026-01-01T00:00:00Z", turns: [{ prompt: "Fix timer", result: "Fixed timer" }] }));
  };
  fixture("older", 3600_000, "running");
  fixture("newer", 1800_000, "waiting");
  assert.equal(queueDashboardChats(state), 0);
  writeMemorySettings(true);
  assert.equal(queueDashboardChats(state), 1);
  assert.equal(queueDashboardChats(state), 0);
  fixture("older", 3600_000, "waiting");
  assert.equal(queueDashboardChats(state), 1);
  writeMemorySettings(false);
  fs.rmSync(dir, { recursive: true, force: true });
});
