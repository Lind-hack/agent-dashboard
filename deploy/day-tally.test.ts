import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tally-test-"));
process.env.MEMORY_VAULT_DIR = path.join(process.env.DATA_DIR, "no-vault");
process.env.DASHBOARD_TZ = "UTC";

const { dayGone, tally, verdictOfCount } = await import("../lib/day-tally");
const { logHabit, saveHabit } = await import("../lib/habits");
const { addTodo, updateTodo } = await import("../lib/todos");

const at = (day: string, hhmm: string) => Date.parse(`${day}T${hhmm}:00.000Z`);

test("the count verdict reads done against how much of the day has gone", () => {
  assert.equal(verdictOfCount(0, 0, 0, 0.5), "no-plan");
  assert.equal(verdictOfCount(5, 5, 0, 0.2), "enough", "everything done is enough at any hour");
  assert.equal(verdictOfCount(0, 8, 0, 0.05), "pending", "nothing done at 07:30 isn't softened yet");
  assert.equal(verdictOfCount(3, 8, 0, 0.5), "not-enough");
  assert.equal(verdictOfCount(1, 8, 0, 0.5), "soft", "well behind the clock");
  assert.equal(verdictOfCount(4, 6, 1, 0.4), "soft", "a planned block let go with little left");
  assert.equal(verdictOfCount(9, 10, 0, 1), "enough");
  assert.equal(verdictOfCount(6, 10, 0, 1), "not-enough");
  assert.equal(verdictOfCount(4, 10, 0, 1), "soft");
  assert.equal(dayGone("2026-10-01", at("2026-10-01", "06:00"), "UTC"), 0);
  assert.equal(dayGone("2026-10-01", at("2026-10-01", "15:00"), "UTC"), 0.5);
  assert.equal(dayGone("2026-10-01", at("2026-10-02", "01:00"), "UTC"), 1);
});

test("habits, tasks and blocks count once each — a block tied to a task is that task", () => {
  const day = new Date().toISOString().slice(0, 10);
  const water = saveHabit({ title: "Water", icon: "💧", createdAt: "2026-01-01T00:00:00.000Z" })!;
  saveHabit({ title: "Gym", icon: "🏋️", createdAt: "2026-01-01T00:00:00.000Z" });
  logHabit(water.id, day, {});
  const essay = addTodo({ title: "Essay", day });
  addTodo({ title: "Email prof", day });
  updateTodo(essay.id, { done: true });
  fs.mkdirSync(path.join(process.env.DATA_DIR!, "plans"), { recursive: true });
  const stamp = `${day}T06:00:00.000Z`;
  fs.writeFileSync(
    path.join(process.env.DATA_DIR!, "plans", `${day}.json`),
    JSON.stringify({
      day,
      createdAt: stamp,
      updatedAt: stamp,
      blocks: [
        { id: "b1", kind: "task", start: "09:00", end: "10:00", title: "Essay", status: "planned", taskId: essay.id },
        { id: "b2", kind: "task", start: "11:00", end: "12:00", title: "Read ch. 4", status: "planned" },
      ],
    }),
  );
  const t = tally(day, at(day, "13:00"), "UTC");
  assert.deepEqual(t.items.map((i) => i.title).sort(), ["Email prof", "Essay", "Gym", "Read ch. 4", "Water"]);
  assert.equal(t.done, 2);
  assert.equal(t.total, 5);
  assert.equal(t.missed, 1, "the unlinked block went by unstarted");
  assert.equal(t.items.find((i) => i.title === "Read ch. 4")?.missed, true);
});
