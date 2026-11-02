import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "discipline-test-"));
process.env.MEMORY_VAULT_DIR = path.join(process.env.DATA_DIR, "no-vault");
process.env.DASHBOARD_TZ = "UTC";

const { discipline, labelOf, scoreDiscipline } = await import("../lib/discipline");

test("the score weighs doing the blocks most, with a small streak bonus", () => {
  assert.equal(scoreDiscipline({ blockRatio: 1, onTimeRate: 1, habitRatio: 1, streak: 0, idleGoals: 0, goals: 2 }), 100);
  assert.equal(scoreDiscipline({ blockRatio: 0.5, onTimeRate: 0.5, habitRatio: 0.5, streak: 0, idleGoals: 1, goals: 2 }), 50);
  assert.equal(scoreDiscipline({ blockRatio: 0.5, onTimeRate: 0.5, habitRatio: 0.5, streak: 3, idleGoals: 1, goals: 2 }), 56);
  assert.equal(scoreDiscipline({ blockRatio: 0, onTimeRate: null, habitRatio: null, streak: 0, idleGoals: 0, goals: 0 }), 0);
  assert.equal(scoreDiscipline({ blockRatio: null, onTimeRate: null, habitRatio: null, streak: 0, idleGoals: 0, goals: 0 }), 0);
  assert.deepEqual([90, 70, 40, 10].map(labelOf), ["locked in", "steady", "slipping", "off"]);
});

test("with nothing on record it says so plainly instead of inventing", () => {
  const d = discipline("2026-11-04");
  assert.equal(d.score, 0);
  assert.ok(d.lines.some((l) => l.startsWith("Blocks: none planned")));
  assert.ok(d.lines.some((l) => l.startsWith("Motivation: no journal moods")));
});
