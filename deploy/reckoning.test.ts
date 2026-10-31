import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "reckon-test-"));
process.env.MEMORY_VAULT_DIR = path.join(process.env.DATA_DIR, "no-vault");
process.env.DASHBOARD_TZ = "UTC";
process.env.RECKON_AT = "21:30";

const { mirror } = await import("../lib/accountability");
const { addDays } = await import("../lib/calendar");
const { answer, readReckoning, reckoningDue, verdictOf, wall } = await import("../lib/reckoning");

const at = (day: string, hhmm: string) => `${day}T${hhmm}:00.000Z`;
type B = { id: string; start: string; end: string; title: string; status: string; startedAt?: string; doneAt?: string };
function plan(day: string, blocks: B[]) {
  fs.mkdirSync(path.join(process.env.DATA_DIR!, "plans"), { recursive: true });
  fs.writeFileSync(path.join(process.env.DATA_DIR!, "plans", `${day}.json`), JSON.stringify({ day, createdAt: at(day, "06:00"), updatedAt: at(day, "06:00"), blocks: blocks.map((b) => ({ kind: "task", ...b })) }));
}
const done = (d: string, id: string, s: string, e: string, startedAt = s, doneAt = e): B => ({ id, start: s, end: e, title: id, status: "done", startedAt: at(d, startedAt), doneAt: at(d, doneAt) });
const END = Number.MAX_SAFE_INTEGER;

test("the verdict: enough, not enough, softened, no plan", () => {
  const d = "2026-09-01";
  plan(d, [done(d, "a", "09:00", "11:00"), done(d, "b", "12:00", "13:00")]);
  assert.equal(verdictOf(mirror(d, END, "UTC")).verdict, "enough");
  plan(d, [done(d, "a", "09:00", "11:00", "09:30", "11:00"), done(d, "b", "12:00", "13:00", "12:20", "13:00"), { id: "c", start: "14:00", end: "15:00", title: "c", status: "planned" }, done(d, "e", "16:00", "17:00")]);
  const v = verdictOf(mirror(d, END, "UTC"));
  assert.equal(v.verdict, "not-enough");
  assert.equal(v.saidMin, 300);
  assert.equal(v.didMin, 90 + 40 + 60);
  plan(d, [done(d, "a", "09:00", "10:00"), { id: "b", start: "11:00", end: "14:00", title: "b", status: "planned" }]);
  assert.equal(verdictOf(mirror(d, END, "UTC")).verdict, "soft");
  plan(d, []);
  assert.equal(verdictOf(mirror(d, END, "UTC")).verdict, "no-plan");
  // Mid-day only what's due counts: one block done on time and the rest still ahead is not "soft".
  plan(d, [done(d, "a", "09:00", "10:00"), { id: "b", start: "14:00", end: "18:00", title: "b", status: "planned" }]);
  assert.equal(verdictOf(mirror(d, Date.parse(at(d, "11:00")), "UTC")).verdict, "enough");
  plan(d, [{ id: "b", start: "14:00", end: "18:00", title: "b", status: "planned" }]);
  assert.equal(verdictOf(mirror(d, Date.parse(at(d, "08:00")), "UTC")).verdict, "pending");
});

test("he owes yesterday first, today only once it's over, and never a day before the reckoning began", () => {
  const today = "2026-10-10";
  const y = addDays(today, -1);
  plan(y, [{ id: "x", start: "09:00", end: "10:00", title: "x", status: "planned" }]);
  // First run: the reckoning starts today, so yesterday isn't asked about.
  assert.equal(reckoningDue(new Date(at(today, "08:00"))), null);
  fs.writeFileSync(path.join(process.env.DATA_DIR!, "coach", "reckoning", "since"), y);
  const owed = reckoningDue(new Date(at(today, "08:00")))!;
  assert.equal(owed.day, y);
  assert.equal(owed.verdict, "soft");
  answer(y, "I slept through it and told myself I'd do it later.", "Later never came.");
  assert.equal(readReckoning(y)?.reply, "Later never came.");
  plan(today, [done(today, "a", "09:00", "10:00"), { id: "b", start: "20:00", end: "21:00", title: "b", status: "planned" }]);
  assert.equal(reckoningDue(new Date(at(today, "18:00"))), null);
  assert.equal(reckoningDue(new Date(at(today, "21:10")))?.day, today, "every block is behind him after 19:00");
  assert.equal(reckoningDue(new Date(at(today, "21:40")))?.day, today);
  answer(today, "Did the morning, skipped the evening block.");
  assert.equal(reckoningDue(new Date(at(today, "22:00"))), null);
});

test("the wall keeps answered days as answered", () => {
  const w = wall(3, new Date(at("2026-10-10", "23:00")));
  assert.deepEqual(
    w.map((x) => [x.day, x.answered]),
    [
      ["2026-10-08", false],
      ["2026-10-09", true],
      ["2026-10-10", true],
    ],
  );
  assert.equal(w[1].verdict, "soft");
});
