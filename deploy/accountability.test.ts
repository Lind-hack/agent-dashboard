import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "acct-test-"));
process.env.MEMORY_VAULT_DIR = path.join(process.env.DATA_DIR, "no-vault");
process.env.DASHBOARD_TZ = "UTC";

const { judge, keptStreak, mirror, patterns } = await import("../lib/accountability");
const { addDays } = await import("../lib/calendar");
const { goalProgress } = await import("../lib/coach");
const { writeGoals } = await import("../lib/goals");
const { readPlan, removeBlock, rescheduleBlock } = await import("../lib/plan-store");
const { cleanItems } = await import("../lib/say");
const { addTodo, updateTodo } = await import("../lib/todos");

const at = (day: string, hhmm: string) => `${day}T${hhmm}:00.000Z`;
type B = { id: string; start: string; end: string; title: string; kind?: string; status: string; startedAt?: string; doneAt?: string; updatedAt?: string; goalId?: string; taskId?: string; rescheduledTo?: string };
function plan(day: string, blocks: B[]) {
  fs.mkdirSync(path.join(process.env.DATA_DIR!, "plans"), { recursive: true });
  fs.writeFileSync(path.join(process.env.DATA_DIR!, "plans", `${day}.json`), JSON.stringify({ day, createdAt: at(day, "06:00"), updatedAt: at(day, "06:00"), blocks: blocks.map((b) => ({ kind: "task", ...b })) }));
}
const ms = (iso: string) => Date.parse(iso);
const D = "2026-10-20";

test("each block is judged against the clock", () => {
  const now = ms(at(D, "12:00"));
  const j = (b: Partial<B>) => judge({ id: "x", start: "09:00", end: "10:00", title: "x", kind: "task", status: "planned", ...b } as never, D, now, "UTC")?.verdict;
  assert.equal(j({ status: "done", startedAt: at(D, "09:03"), doneAt: at(D, "10:00") }), "on-time");
  assert.equal(j({ status: "done", startedAt: at(D, "09:20"), doneAt: at(D, "10:00") }), "late");
  assert.equal(j({}), "missed");
  assert.equal(j({ status: "running", startedAt: at(D, "09:00") }), "unfinished");
  assert.equal(j({ start: "11:50", end: "13:00" }), "not-started");
  assert.equal(j({ start: "11:58", end: "13:00" }), "upcoming");
  assert.equal(j({ start: "13:00", end: "14:00" }), "upcoming");
  // Moved to tomorrow before it began: not a miss. After it ended: a miss.
  assert.equal(j({ status: "moved", updatedAt: at(D, "08:00") }), undefined);
  assert.equal(j({ status: "moved", updatedAt: at(D, "10:30") }), "missed");
  assert.equal(judge({ id: "b", start: "09:00", end: "10:00", title: "lunch", kind: "break", status: "planned" } as never, D, now, "UTC"), null);
});

test("a day is kept only with nothing missed and 80% on time; kept days make the streak", () => {
  const good = (d: string) =>
    plan(d, [
      { id: `${d}-a`, start: "09:00", end: "10:00", title: "Deep work", status: "done", startedAt: at(d, "09:01"), doneAt: at(d, "10:00") },
      { id: `${d}-b`, start: "11:00", end: "12:00", title: "Gym", status: "done", startedAt: at(d, "11:02"), doneAt: at(d, "12:00") },
    ]);
  const today = "2026-10-25";
  good(addDays(today, -1));
  good(addDays(today, -2));
  plan(addDays(today, -3), [{ id: "m", start: "09:00", end: "10:00", title: "Study", status: "planned" }]);
  const y = mirror(addDays(today, -1), Number.MAX_SAFE_INTEGER, "UTC");
  assert.equal(y.kept, true);
  assert.equal(y.onTimeRate, 100);
  assert.equal(mirror(addDays(today, -3), Number.MAX_SAFE_INTEGER, "UTC").kept, false);
  plan(today, [{ id: "t", start: "09:00", end: "10:00", title: "Code", status: "planned" }]);
  const s = keptStreak(today, "UTC", ms(at(today, "08:00")));
  assert.deepEqual(s, { days: 2, todayKept: false, todayAlive: true });
  assert.equal(keptStreak(today, "UTC", ms(at(today, "11:00"))).todayAlive, false);
});

test("patterns: late mornings, overruns and skipped blocks show up", () => {
  const today = "2026-11-10";
  for (let i = 1; i <= 4; i++) {
    const d = addDays(today, -i);
    plan(d, [
      { id: `${d}-m`, start: "08:00", end: "09:00", title: "Morning study", status: "done", startedAt: at(d, "08:30"), doneAt: at(d, "09:50") },
      { id: `${d}-e`, start: "20:00", end: "21:00", title: "Evening reading", status: "planned" },
    ]);
  }
  const p = patterns(today, "UTC");
  const txt = p.lines.join("\n");
  assert.match(txt, /Morning blocks: 0% missed, started 30 min late/);
  assert.match(txt, /Evening blocks: 100% missed/);
  assert.match(txt, /task blocks really take 1\.3× their planned length/);
  assert.match(txt, /Usually skipped: "evening reading"/);
});

test("a missed block is rescheduled once, and the original stays as a miss", () => {
  const d = "2026-10-21";
  plan(d, [{ id: "s", start: "09:00", end: "10:00", title: "Study", status: "planned" }]);
  const moved = rescheduleBlock(d, "s", "15:00")!;
  assert.equal(moved.start, "15:00");
  assert.equal(moved.end, "16:00");
  assert.equal(moved.rescheduledFrom, "s");
  assert.equal(rescheduleBlock(d, moved.id, "17:00"), null, "never twice");
  const m = mirror(d, ms(at(d, "12:00")), "UTC");
  const orig = m.rows.find((r) => r.id === "s")!;
  assert.equal(orig.verdict, "missed");
  assert.equal(orig.rescheduledTo, "15:00");
  assert.ok(removeBlock(d, moved.id));
  assert.ok(!readPlan(d)!.blocks.some((b) => b.id === moved.id));
});

test("finished tasks tied to a goal count toward it, without double-counting a done block", () => {
  writeGoals([{ id: "", title: "Ship the pitch", horizon: "now", next: "", why: "", done: false }]);
  const gid = "goal-ship-the-pitch";
  const t1 = addTodo({ title: "Draft slides", day: "2026-10-31", estimateMin: 45, goalId: gid });
  updateTodo(t1.id, { done: true });
  const t2 = addTodo({ title: "Send deck", day: "2026-10-31", estimateMin: 30, goalId: gid });
  updateTodo(t2.id, { done: true });
  const today = new Date().toISOString().slice(0, 10);
  plan(today, [{ id: "blk", start: "00:00", end: "00:20", title: "Send deck", status: "done", goalId: gid, taskId: t2.id, startedAt: at(today, "00:00"), doneAt: at(today, "00:20") }]);
  const g = goalProgress().find((x) => x.goal.id === gid)!;
  assert.equal(g.todayDoneMin, 20 + 45);
  assert.equal(g.lastWorked, today);
});

test("Say it: the model's items are checked", () => {
  const items = cleanItems(
    [
      { kind: "block", title: " Gym ", start: "6:00", length: 60, day: "2026-10-31", goalId: "nope" },
      { kind: "task", title: "Finish pitch", day: "2020-01-01", priority: 7, estimateMin: -5, goalId: "g1" },
      { kind: "event", title: "Dentist", date: "2026-11-02", start: "10:00", end: "25:00" },
      { kind: "goal", title: "Save 2k", horizon: "weird", due: "2027-03-01", weeklyMin: 2 },
      { kind: "spell", title: "nothing" },
      { kind: "task" },
    ],
    "2026-10-31",
    new Set(["g1"]),
  );
  assert.deepEqual(items, [
    { kind: "block", title: "Gym", day: "2026-10-31", start: "06:00", length: 60, goalId: undefined },
    { kind: "task", title: "Finish pitch", day: "2026-10-31", due: undefined, goalId: "g1", estimateMin: undefined, priority: undefined },
    { kind: "event", title: "Dentist", date: "2026-11-02", start: "10:00", end: undefined },
    { kind: "goal", title: "Save 2k", horizon: "short", next: "", why: "", due: "2027-03-01", weeklyMin: undefined },
  ]);
});
