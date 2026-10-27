import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

test("existing PC updater can bootstrap the new collector with its known libraries", () => {
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), "collector-upgrade-"));
  try {
    // The already-installed updater knows only these library names. New library dependencies
    // would cause it to reject every staged upgrade before installing the new updater.
    for (const [name, source] of [["brain-collect.mjs", "handoff/brain-collect.mjs"], ["redact.ts", "lib/redact.ts"], ["transcript.ts", "lib/transcript.ts"]]) fs.copyFileSync(source, path.join(stage, name));
    const output = execFileSync(process.execPath, ["--import", "tsx", path.join(stage, "brain-collect.mjs"), "--self-test"], { encoding: "utf8" });
    assert.match(output, /self-test ok/);
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
});
