import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "v51-test-"));
// The vault sits under a regular file, so nothing can be written there — like the live "100 - Me" today.
fs.writeFileSync(path.join(process.env.DATA_DIR, "blocker"), "");
process.env.MEMORY_VAULT_DIR = path.join(process.env.DATA_DIR, "blocker", "vault");
process.env.DASHBOARD_TZ = "Europe/Belgrade";
process.env.AUTOPILOT_ENABLED = "1";

const { blockPace } = await import("../lib/coach");
const { withLock } = await import("../lib/file-lock");
const { addEntry, readJournal, removeEntry } = await import("../lib/journal");
const { readGoals, writeGoals } = await import("../lib/goals");
const { addTodo, listTodos } = await import("../lib/todos");
const { readAutopilot, runEvening, undoStep } = await import("../lib/autopilot");
const { coachNow } = await import("../lib/coach");
const { shiftDay } = await import("../lib/plan-store");

const blk = (start: string, end: string, status: string, extra: Record<string, unknown> = {}) => ({ id: `${start}-${status}`, start, end, title: `${start} block`, kind: "focus", status, ...extra }) as never;
const m = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));

test("time-block pace: due minutes so far vs done, missed blocks listed, breaks ignored", () => {
  const now = Date.UTC(2026, 10, 3, 11, 0);
  const p = blockPace(
    [
      blk("09:00", "10:00", "done", { startedAt: new Date(now - 120 * 60_000).toISOString(), doneAt: new Date(now - 70 * 60_000).toISOString() }), // 50 real minutes
      blk("10:00", "10:30", "planned"), // missed
      blk("10:30", "10:45", "planned", { kind: "break" }),
      blk("10:45", "12:00", "running", { startedAt: new Date(now - 10 * 60_000).toISOString() }), // 15 due, 10 done
      blk("13:00", "14:00", "planned"), // not due yet
    ],
    m("11:00"),
    now,
  );
  assert.equal(p.dueMin, 60 + 30 + 15);
  assert.equal(p.doneMin, 50 + 10);
  assert.equal(p.behindMin, 45);
  assert.deepEqual(p.missed.map((x) => x.start), ["10:00"]);
});

test("the file lock serialises and is released even when the work throws", () => {
  assert.equal(withLock("t", () => 7), 7);
  assert.throws(() => withLock("t", () => { throw new Error("boom"); }), /boom/);
  assert.equal(withLock("t", () => "again"), "again"); // not stuck
});

test("journal entries save with a mood, list per day, and delete", () => {
  const e = addEntry("2026-11-03", "  Shipped the funnel copy, gym skipped.  ", "voice", 4);
  assert.equal(e.text, "Shipped the funnel copy, gym skipped.");
  assert.equal(e.mood, 4);
  assert.equal(readJournal("2026-11-03").entries.length, 1);
  assert.ok(removeEntry("2026-11-03", e.id));
  assert.equal(readJournal("2026-11-03").entries.length, 0);
  assert.throws(() => addEntry("2026-11-03", "   ", "text"));
});

test("goals save to the dashboard even when the vault isn't writable, weekly target kept", () => {
  const r = writeGoals([{ id: "", horizon: "now", title: "Ship the funnel", next: "copy", why: "money", weeklyMin: 360, done: false }]);
  assert.equal(r.ok, true);
  assert.equal(r.vault, false);
  const g = readGoals();
  assert.equal(g[0].title, "Ship the funnel");
  assert.equal(g[0].weeklyMin, 360);
});

test("evening rollover moves open tasks to tomorrow, and undo puts them back", async () => {
  const day = coachNow().day;
  const a = addTodo({ title: "Open one", day });
  const b = addTodo({ title: "Old open", day: shiftDay(day, -2) });
  const c = addTodo({ title: "Finished", day });
  const { updateTodo } = await import("../lib/todos");
  updateTodo(c.id, { done: true });
  const log = runEvening();
  assert.equal(log.moved, 2);
  const tomorrow = shiftDay(day, 1);
  const byId = new Map(listTodos().map((t) => [t.id, t]));
  assert.equal(byId.get(a.id)!.day, tomorrow);
  assert.equal(byId.get(b.id)!.day, tomorrow);
  assert.equal(byId.get(c.id)!.day, day);
  assert.ok(readAutopilot(day).steps.evening);
  const u = await undoStep(day, "evening");
  assert.equal(u.ok, true);
  const after = new Map(listTodos().map((t) => [t.id, t]));
  assert.equal(after.get(a.id)!.day, day);
  assert.equal(after.get(b.id)!.day, shiftDay(day, -2));
  assert.ok(readAutopilot(day).steps.evening?.undoneAt);
  assert.equal((await undoStep(day, "evening")).ok, false); // only once
});

test("a stale lock left by a crashed process is taken over; a live one is not", () => {
  const lockFile = path.join(process.env.DATA_DIR!, "locks", "stale.lock");
  fs.mkdirSync(path.dirname(lockFile), { recursive: true });
  fs.writeFileSync(lockFile, "dead:owner");
  const old = new Date(Date.now() - 60_000);
  fs.utimesSync(lockFile, old, old);
  assert.equal(withLock("stale", () => "took it"), "took it");
  assert.equal(fs.existsSync(lockFile), false);
  fs.writeFileSync(lockFile, "live:owner"); // fresh
  assert.throws(() => withLock("stale", () => "never"), /busy/);
  assert.equal(fs.readFileSync(lockFile, "utf8"), "live:owner");
  fs.rmSync(lockFile);
});

test("savePlanIf leaves the plan alone when the guard sees it changed", async () => {
  const { savePlanIf, savePlan, readPlan } = await import("../lib/plan-store");
  savePlan("2026-11-04", [{ blockId: "mine", start: "09:00", end: "10:00", title: "Mine", kind: "focus" }]);
  const r = savePlanIf("2026-11-04", (cur) => ((cur?.blocks.length ?? 0) ? null : [{ blockId: "auto", start: "09:00", end: "10:00", title: "Auto", kind: "focus" }]));
  assert.equal(r, null);
  assert.deepEqual(readPlan("2026-11-04")!.blocks.map((b) => b.id), ["mine"]);
});
