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
  fs.rmSync(dir, { recursive: true, force: true });
});
