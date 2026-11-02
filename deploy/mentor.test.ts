import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "mentor-test-"));
process.env.MEMORY_VAULT_DIR = path.join(process.env.DATA_DIR, "no-vault");
process.env.DASHBOARD_TZ = "UTC";

const { cleanOrders, cleanPlan, logMetric, OUTCOME, readLog, savePlan, scorecard, weekOf } = await import("../lib/mentor");

const goal = { id: "goal-10k-a-month", horizon: "long" as const, title: "10k a month", next: "", why: "freedom", due: "2027-12-31", done: false };
const TODAY = "2026-11-04"; // a Wednesday

test("a model's plan is cleaned: numbers, dates, unique indicator keys, caps", () => {
  const p = cleanPlan(
    goal,
    {
      outcome: { label: "Monthly revenue", unit: "€/month", target: "10000" as unknown as number, by: "not a date", baseline: 0 },
      milestones: [
        { by: "2027-06-30", label: "€3k month", value: 3000 },
        { by: "2026-11-30", label: "First paying client" },
        { by: "soon", label: "dropped" },
      ],
      indicators: [
        { key: "Cold DMs", label: "Cold DMs sent", unit: "DMs", weekly: 100 },
        { key: "cold_dms", label: "Duplicate key", unit: "", weekly: 5 },
        { key: "outcome", label: "Can't shadow the outcome", unit: "", weekly: 1 },
        { key: "calls", label: "Sales calls", unit: "", weekly: 0 },
        { key: "videos", label: "Videos posted", unit: "", weekly: 5.4 },
      ],
      strategy: "Sell AI automations to local businesses.",
    },
    "groq",
    TODAY,
  )!;
  assert.equal(p.outcome.target, 10000);
  assert.equal(p.outcome.by, "2027-12-31", "falls back to the goal's due date");
  assert.deepEqual(p.milestones.map((m) => m.label), ["First paying client", "€3k month"], "sorted, bad dates dropped");
  assert.deepEqual(p.indicators.map((i) => i.key), ["cold_dms", "videos"]);
  assert.equal(p.indicators[1].weekly, 5);
  assert.equal(cleanPlan(goal, { outcome: undefined }, "groq", TODAY), null);
});

test("the scorecard: latest outcome wins, indicators add up this week only, the straight line", () => {
  const p = cleanPlan(goal, { outcome: { label: "Revenue", unit: "€", target: 10000, by: "2027-11-04", baseline: 0 }, milestones: [{ by: "2026-12-31", label: "€1k month", value: 1000 }], indicators: [{ key: "dms", label: "DMs", unit: "", weekly: 100 }], strategy: "" }, "groq", TODAY)!;
  p.createdAt = "2026-11-04T08:00:00.000Z";
  savePlan(p);
  assert.deepEqual(weekOf(TODAY), ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"]);
  logMetric(goal.id, "dms", 30, "2026-11-02");
  logMetric(goal.id, "dms", 25, "2026-11-04");
  logMetric(goal.id, "dms", 99, "2026-11-01"); // last week
  logMetric(goal.id, OUTCOME, 400, "2026-11-03");
  logMetric(goal.id, OUTCOME, 650, "2026-11-04");
  assert.equal(logMetric(goal.id, "dms", Number.NaN, TODAY), null);
  const s = scorecard(p, TODAY, readLog());
  assert.equal(s.current, 650);
  assert.equal(s.week[0].done, 55);
  assert.deepEqual(s.unlogged, []);
  assert.equal(s.expected, 0, "the plan starts today");
  assert.equal(s.nextMilestone?.label, "€1k month");
  assert.equal(scorecard(p, "2027-05-05", readLog()).expected, 4986, "halfway-ish along the line");
});

test("orders: only real goals, at most three, minutes rounded and clamped, unknown indicators dropped", () => {
  const p = cleanPlan(goal, { outcome: { label: "Revenue", unit: "€", target: 10000, by: "2027-12-31", baseline: 0 }, indicators: [{ key: "dms", label: "DMs", unit: "", weekly: 100 }], milestones: [], strategy: "" }, "groq", TODAY)!;
  const o = cleanOrders(
    [
      { goalId: goal.id, title: "Send 20 cold DMs", how: "Instagram, restaurants", minutes: 47, indicator: "DMs" },
      { goalId: "goal-made-up", title: "x", how: "", minutes: 30 },
      { goalId: goal.id, title: "Record 2 videos", how: "", minutes: 400, indicator: "views" },
      { goalId: goal.id, title: "  ", how: "", minutes: 30 },
      { goalId: goal.id, title: "Pitch 3 offers", how: "", minutes: 5 },
      { goalId: goal.id, title: "Fourth", how: "", minutes: 30 },
    ],
    new Set([goal.id]),
    [p],
  );
  assert.deepEqual(o.map((x) => x.title), ["Send 20 cold DMs", "Record 2 videos", "Pitch 3 offers"]);
  assert.deepEqual(o.map((x) => x.minutes), [45, 150, 15]);
  assert.equal(o[0].indicator, "dms");
  assert.equal(o[1].indicator, undefined);
});
