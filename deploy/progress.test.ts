import assert from "node:assert/strict";
import { test } from "node:test";
import { parseProgress } from "../lib/progress";

const ev = (kind: string, text: string, t = "2026-10-31T10:00:00Z") => ({ kind, text, t });

test("a PLAN checklist plus STEP/DONE markers become a stepper with the active step", () => {
  const p = parseProgress([
    ev("turn", "You: fix the inbox"),
    ev("text", "PLAN:\n1. Read the inbox code\n2. Fix the sort\n3. Run the typecheck\n4. Commit and open a PR"),
    ev("text", "STEP 1/4: Read the inbox code"),
    ev("tool", "Read lib/inbox.ts"),
    ev("text", "DONE 1"),
    ev("text", "STEP 2/4: Fix the sort", "2026-10-31T10:03:00Z"),
    ev("tool", "Edit lib/inbox.ts"),
  ]);
  assert.deepEqual(p.steps.map((s) => s.status), ["done", "active", "todo", "todo"]);
  assert.equal(p.steps[1].title, "Fix the sort");
  assert.equal(p.current, 2);
  assert.equal(p.total, 4);
  assert.deepEqual(p.files, ["lib/inbox.ts"]);
});

test("only the latest turn counts", () => {
  const p = parseProgress([ev("turn", "You: a"), ev("text", "PLAN:\n1. Old step\n2. Older"), ev("turn", "You: b"), ev("tool", "Read README.md")]);
  assert.equal(p.steps.length, 0);
  assert.equal(p.phase, "Exploring the code");
});

test("without a plan, the phase comes from the latest tool calls", () => {
  assert.equal(parseProgress([ev("turn", "You: x"), ev("tool", "Bash npx tsc --noEmit")]).phase, "Running checks");
  assert.equal(parseProgress([ev("turn", "You: x"), ev("tool", "Bash git commit -m 'C-1: fix'")]).phase, "Committing");
  assert.equal(parseProgress([ev("turn", "You: x"), ev("tool", "Bash gh pr create --fill")]).phase, "Opening the pull request");
  assert.equal(parseProgress([ev("turn", "You: x"), ev("tool", "Edit app/page.tsx"), ev("tool", "Write lib/x.ts")]).phase, "Editing files");
});

test("files are collected from edit and write steps, without duplicates", () => {
  const p = parseProgress([ev("turn", "You: x"), ev("tool", "Edit app/page.tsx"), ev("tool", "Write lib/x.ts"), ev("tool", "Edit app/page.tsx"), ev("tool", "Read lib/y.ts")]);
  assert.deepEqual(p.files, ["app/page.tsx", "lib/x.ts"]);
});

test("a STEP line without a plan still shows as the current step", () => {
  const p = parseProgress([ev("turn", "You: x"), ev("text", "STEP 2/3: Write the tests")]);
  assert.equal(p.current, 2);
  assert.equal(p.total, 3);
  assert.equal(p.steps.find((s) => s.status === "active")?.title, "Write the tests");
});
