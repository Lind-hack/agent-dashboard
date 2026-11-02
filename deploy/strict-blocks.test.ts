import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "strict-test-"));
process.env.MEMORY_VAULT_DIR = path.join(process.env.DATA_DIR, "no-vault");
process.env.DASHBOARD_TZ = "UTC";

const { mirror, mirrorText, owed } = await import("../lib/accountability");
const { dropMissed, readPlan, rescheduleBlock } = await import("../lib/plan-store");

const at = (day: string, hhmm: string) => Date.parse(`${day}T${hhmm}:00.000Z`);
function plan(day: string, blocks: { id: string; start: string; end: string; status?: string; startedAt?: string; kind?: string }[]) {
  fs.mkdirSync(path.join(process.env.DATA_DIR!, "plans"), { recursive: true });
  fs.writeFileSync(
    path.join(process.env.DATA_DIR!, "plans", `${day}.json`),
    JSON.stringify({ day, createdAt: `${day}T06:00:00.000Z`, updatedAt: `${day}T06:00:00.000Z`, blocks: blocks.map((b) => ({ kind: "task", title: b.id, status: "planned", ...b })) }),
  );
}

test("owed: only blocks whose time is over, never started, not breaks — today's and yesterday's", () => {
  const y = "2026-11-03";
  const d = "2026-11-04";
  plan(y, [{ id: "y1", start: "20:00", end: "21:00" }]);
  plan(d, [
    { id: "a", start: "09:00", end: "10:00" },
    { id: "b", start: "10:00", end: "11:00", status: "done", startedAt: `${d}T10:00:00.000Z` },
    { id: "c", start: "11:00", end: "12:00", kind: "break" },
    { id: "e", start: "15:00", end: "16:00" },
  ]);
  assert.deepEqual(owed(d, at(d, "13:00"), "UTC").map((o) => `${o.day}:${o.id}`), ["2026-11-03:y1", "2026-11-04:a"]);
});

test("dropping needs a real reason, and the reason lands on the mirror as a miss", () => {
  const d = "2026-10-05"; // in the past, so the drop happens after the block ended
  plan(d, [{ id: "gym", start: "07:00", end: "08:00" }]);
  assert.equal(dropMissed(d, "gym", "tired"), null, "one word isn't a reason");
  const dropped = dropMissed(d, "gym", "Stayed up till 2 on TikTok and slept through it");
  assert.equal(dropped?.status, "dropped");
  assert.equal(owed(d, at(d, "12:00"), "UTC").filter((o) => o.day === d).length, 0);
  const m = mirror(d, Number.MAX_SAFE_INTEGER, "UTC");
  assert.equal(m.rows[0].verdict, "missed");
  assert.match(mirrorText(m), /his reason: "Stayed up till 2 on TikTok/);
});

test("putting yesterday's block back lands it in today and leaves a tombstone; it can be put back again by hand", () => {
  const y = "2026-11-06";
  const d = "2026-11-07";
  plan(y, [{ id: "pitch", start: "18:00", end: "19:30" }]);
  plan(d, []);
  const back = rescheduleBlock(y, "pitch", "10:00", d, true)!;
  assert.equal(back.start, "10:00");
  assert.equal(back.end, "11:30");
  assert.equal(readPlan(y)!.blocks[0].status, "moved");
  assert.equal(readPlan(y)!.blocks[0].movedTo, d);
  assert.equal(readPlan(d)!.blocks[0].rescheduledFrom, "pitch");
  // Missed again: the runner can't move it, he can.
  assert.equal(rescheduleBlock(d, back.id, "14:00"), null);
  assert.equal(rescheduleBlock(d, back.id, "14:00", d, true)?.start, "14:00");
});
