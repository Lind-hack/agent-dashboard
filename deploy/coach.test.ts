import assert from "node:assert/strict";
import { test } from "node:test";
import { coachMoments, type MomentBlock } from "../lib/coach-moments";
import { parseWeekly } from "../lib/goals";

// A day in minutes: block 10:00–11:00 → start 600, end 660.
const at = (min: number) => Date.UTC(2026, 10, 2, 0, min);
const block = (over: Partial<MomentBlock> = {}): MomentBlock => ({ id: "b1", title: "Write the landing copy", kind: "focus", status: "planned", startMs: at(600), endMs: at(660), ...over });

test("a block that is starting gets one start push, within the first 3 minutes only", () => {
  assert.deepEqual(coachMoments([block()], at(600)).map((m) => m.kind), ["start"]);
  assert.deepEqual(coachMoments([block()], at(602)).map((m) => m.kind), ["start"]);
  assert.deepEqual(coachMoments([block()], at(604)).map((m) => m.kind), []);
  assert.deepEqual(coachMoments([block()], at(599)).map((m) => m.kind), []);
});

test("not started 10 minutes in → a nudge; started → no nudge", () => {
  assert.deepEqual(coachMoments([block()], at(611)).map((m) => m.kind), ["nudge"]);
  assert.deepEqual(coachMoments([block({ status: "running" })], at(611)).map((m) => m.kind), []);
  // A nudge stops making sense once the block is nearly over.
  assert.deepEqual(coachMoments([block()], at(655)).map((m) => m.kind), []);
});

test("a long running block gets a halfway check-in; a short one does not", () => {
  assert.deepEqual(coachMoments([block({ status: "running" })], at(631)).map((m) => m.kind), ["checkin"]);
  const short = block({ status: "running", endMs: at(625) });
  assert.deepEqual(coachMoments([short], at(613)).map((m) => m.kind), []);
});

test("a running block at its end asks if it's done, for 15 minutes", () => {
  assert.deepEqual(coachMoments([block({ status: "running" })], at(660)).map((m) => m.kind), ["end"]);
  assert.deepEqual(coachMoments([block({ status: "running" })], at(676)).map((m) => m.kind), []);
});

test("breaks and finished blocks never push; keys are stable per block and moment", () => {
  assert.deepEqual(coachMoments([block({ kind: "break" }), block({ id: "b2", status: "done" })], at(600)), []);
  const [m] = coachMoments([block()], at(600));
  assert.equal(m.key, "coach:start:b1");
});

test("weekly targets parse hours and minutes", () => {
  assert.equal(parseWeekly("6h"), 360);
  assert.equal(parseWeekly("1h30"), 90);
  assert.equal(parseWeekly("2h 15m"), 135);
  assert.equal(parseWeekly("90"), 90);
  assert.equal(parseWeekly("lots"), undefined);
});
