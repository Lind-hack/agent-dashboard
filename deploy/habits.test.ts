import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "habits-test-"));

const { archiveHabit, cleanHabit, habitProgress, habitsFor, listHabits, logHabit, saveHabit, scheduledOn } = await import("../lib/habits");

const MON = "2026-10-26"; // a Monday
const created = "2026-10-01T08:00:00.000Z";

test("a habit is cleaned: title, one emoji, sane target and step, valid weekdays", () => {
  const h = cleanHabit({ title: "  Drink   water ", icon: "💧💧💧", target: 2, step: 5, unit: "litres", days: [1, 1, 9, 3] })!;
  assert.equal(h.title, "Drink water");
  assert.equal(h.icon, "💧💧");
  assert.equal(h.step, 2, "a step never exceeds the target");
  assert.deepEqual(h.days, [1, 3]);
  assert.equal(cleanHabit({ title: "  " }), null);
  assert.equal(cleanHabit({ title: "Gym" })!.target, 1);
});

test("logging: + adds a step, − takes it back, never below 0 or past 3× the target", () => {
  const water = saveHabit({ title: "Drink water", icon: "💧", target: 2, step: 0.4, unit: "litres", createdAt: created })!;
  assert.equal(logHabit(water.id, MON, {})!.value, 0.4);
  assert.equal(logHabit(water.id, MON, {})!.value, 0.8);
  assert.equal(logHabit(water.id, MON, { delta: -0.4 })!.value, 0.4);
  assert.equal(logHabit(water.id, MON, { delta: -5 })!.value, 0);
  const full = logHabit(water.id, MON, { value: 99 })!;
  assert.equal(full.value, 6);
  assert.equal(full.done, true);
  assert.equal(logHabit("h-nope", MON, {}), null);
});

test("schedule, streaks and the day's progress", () => {
  const gym = saveHabit({ title: "Gym", icon: "🏋️", days: [1, 3, 5], createdAt: created })!;
  assert.equal(scheduledOn(gym, MON), true);
  assert.equal(scheduledOn(gym, "2026-10-27"), false, "Tuesday isn't a gym day");
  logHabit(gym.id, "2026-10-21", {}); // Wed
  logHabit(gym.id, "2026-10-23", {}); // Fri
  logHabit(gym.id, MON, {});
  const today = habitsFor(MON).find((x) => x.habit.id === gym.id)!;
  assert.equal(today.done, true);
  assert.equal(today.streak, 3, "Wed, Fri, Mon — the weekend doesn't break it");
  const p = habitProgress(MON);
  assert.equal(p.total, 2);
  assert.equal(p.done, 2);
  assert.ok(!habitsFor("2026-10-27").some((x) => x.habit.id === gym.id));
});

test("an edit keeps the id and history; archiving hides it but keeps the days", () => {
  const [water] = listHabits();
  const edited = saveHabit({ id: water.id, title: "Water", target: 3 })!;
  assert.equal(edited.id, water.id);
  assert.equal(edited.createdAt, water.createdAt);
  assert.ok(archiveHabit(water.id));
  assert.ok(!listHabits().some((h) => h.id === water.id));
  assert.ok(listHabits(true).some((h) => h.id === water.id));
});
