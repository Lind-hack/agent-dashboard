import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

// The task store writes under DATA_DIR, which lib/config reads at import: point it at a temp folder first.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "todos-test-"));
process.env.DASHBOARD_TZ = "Europe/Belgrade";
const { addTodo, importTickTick, listTodos, remainingMin, todoPercent, todosFor, updateTodo } = await import("../lib/todos");

test("a task from an earlier day, or past its deadline, is overdue; a later one waits", () => {
  addTodo({ title: "Old", day: "2026-11-01" });
  addTodo({ title: "Today", day: "2026-11-03" });
  addTodo({ title: "Deadline passed", day: "2026-11-03", due: "2026-11-02" });
  addTodo({ title: "Next week", day: "2026-11-09" });
  const l = todosFor("2026-11-03");
  assert.deepEqual(l.overdue.map((t) => t.title).sort(), ["Deadline passed", "Old"]);
  assert.deepEqual(l.today.map((t) => t.title), ["Today"]);
  assert.deepEqual(l.later.map((t) => t.title), ["Next week"]);
});

test("subtasks drive the share done and the minutes left", () => {
  const t = addTodo({ title: "Landing copy", day: "2026-11-03", estimateMin: 90, subtasks: ["Headline", "Pricing", "FAQ"] });
  const one = updateTodo(t.id, { toggleSubtask: t.subtasks[0].id })!;
  assert.equal(todoPercent(one), 33);
  assert.equal(remainingMin(one), 60);
  const done = updateTodo(t.id, { done: true })!;
  assert.equal(remainingMin(done), 0);
  assert.ok(done.doneAt);
});

test("clearing a deadline with an empty string removes it", () => {
  const t = addTodo({ title: "Due", day: "2026-11-03", due: "2026-11-03T15:00" });
  assert.equal(updateTodo(t.id, { due: "" })!.due, undefined);
});

test("TickTick tasks are imported once each, with priority mapped and the local due day", () => {
  const tasks = [{ id: "tt1", projectId: "inbox", title: "Invoice", due: "2026-11-03T13:30:00.000+0000", allDay: false, priority: 5 }];
  assert.equal(importTickTick(tasks, "2026-11-03", "Europe/Belgrade"), 1);
  assert.equal(importTickTick(tasks, "2026-11-03", "Europe/Belgrade"), 0);
  const t = listTodos().find((x) => x.ticktick?.id === "tt1")!;
  assert.equal(t.priority, 3);
  assert.equal(t.due, "2026-11-03T14:30"); // 13:30 UTC is 14:30 in Pristina in November
});
