import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "count-verdict-test-"));
process.env.MEMORY_VAULT_DIR = path.join(process.env.DATA_DIR, "no-vault");
process.env.DASHBOARD_TZ = "UTC";

const { snapshot, verdictOf, wall } = await import("../lib/reckoning");
const { mirror } = await import("../lib/accountability");
const { addTodo } = await import("../lib/todos");

const at = (day: string, hhmm: string) => `${day}T${hhmm}:00.000Z`;

test("the reckoning and the wall judge by things done, not minutes", () => {
  const d = "2026-10-20";
  fs.mkdirSync(path.join(process.env.DATA_DIR!, "plans"), { recursive: true });
  // Two long blocks done, one short one skipped — by minutes 360 of 375 — and three tasks left open.
  fs.writeFileSync(
    path.join(process.env.DATA_DIR!, "plans", `${d}.json`),
    JSON.stringify({
      day: d,
      createdAt: at(d, "06:00"),
      updatedAt: at(d, "06:00"),
      blocks: [
        { id: "deep", kind: "task", start: "09:00", end: "12:00", title: "Deep work", status: "done", startedAt: at(d, "09:00"), doneAt: at(d, "12:00") },
        { id: "deep2", kind: "task", start: "13:00", end: "16:00", title: "Deep work 2", status: "done", startedAt: at(d, "13:00"), doneAt: at(d, "16:00") },
        { id: "a", kind: "task", start: "17:00", end: "17:15", title: "Email prof", status: "planned" },
      ],
    }),
  );
  for (const title of ["Pay rent", "Call bank", "Send invoice"]) addTodo({ title, day: d });
  assert.equal(verdictOf(mirror(d, Number.MAX_SAFE_INTEGER, "UTC")).verdict, "not-enough", "minutes alone called it 'not enough'");
  const r = snapshot(d, Number.MAX_SAFE_INTEGER);
  assert.equal(r.itemsDone, 2);
  assert.equal(r.itemsTotal, 6);
  assert.equal(r.verdict, "soft", "2 of 6 things done is softened");
  const cell = wall(30, new Date(at("2026-10-25", "12:00"))).find((w) => w.day === d);
  assert.equal(cell?.verdict, "soft", "the wall's colour follows the count");
});
