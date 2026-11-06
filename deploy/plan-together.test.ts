import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "plan-together-test-"));
process.env.MEMORY_VAULT_DIR = path.join(process.env.DATA_DIR, "no-vault");
process.env.DASHBOARD_TZ = "UTC";
process.env.GROQ_API_KEY = "test";
process.env.SOL_ENABLED = "0";
delete process.env.NVIDIA_API_KEY;
delete process.env.GEMINI_API_KEY;
delete process.env.GOOGLE_AI_API_KEY;

const { answerTalk, cancelTalk, cleanPlan, lockTalk, readPlanFor, readTalk, savePlan, startTalk, writeMentorDay } = await import("../lib/mentor");
const { saveStage, readStage } = await import("../lib/life");
const { writeGoals, readGoals } = await import("../lib/goals");
const { addTodo, listTodos, updateTodo } = await import("../lib/todos");
const { readJournal, addEntry } = await import("../lib/journal");
const { POST } = await import("../app/api/mentor/route");

let answer = "";
let sent: { messages: { role: string; content: string }[] }[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (_url: unknown, init: { body: string }) => {
  sent.push(JSON.parse(init.body));
  return new Response(JSON.stringify({ choices: [{ message: { content: answer } }] }), { status: 200 });
}) as typeof fetch;
test.after(() => {
  globalThis.fetch = realFetch;
});

const TODAY = "2026-11-06";
writeGoals([
  { id: "", title: "10k a month", horizon: "long", next: "", why: "", due: "2027-12-31", done: false },
  { id: "", title: "Get fit", horizon: "short", next: "", why: "", done: false },
]);
const [money, fit] = readGoals();
const rawPlan = (label = "Launch 383ks.com") => ({
  outcome: { label: "Monthly revenue", unit: "€/month", target: 10000, by: "2027-12-31", baseline: 0 },
  milestones: [{ by: "2026-12-01", label }],
  indicators: [{ key: "launch_items", label: "Launch checklist items closed", unit: "", weekly: 10 }],
  strategy: "Finish before selling.",
  assumes: ["383ks.com isn't live", "No paying customers yet"],
});

test("planning starts with the mentor's read of where he is, from his stage and his week", async () => {
  saveStage("383ks.com isn't launched yet. No customers.");
  addEntry(TODAY, "Stuck on checkout again", "text");
  sent = [];
  answer = JSON.stringify({ read: "You have no live product, so selling isn't the constraint yet.", questions: ["What's left before launch?", "How many hours a week do you have?", "Q3", "Q4", "Q5", "Q6"] });
  const talk = await startTalk(money, TODAY);
  const body = sent[0].messages.map((m) => m.content).join(" ");
  assert.match(body, /isn't launched yet/);
  assert.match(body, /Stuck on checkout again/);
  assert.match(talk.read, /no live product/);
  assert.equal(talk.questions.length, 4, "at most four questions");
  assert.deepEqual(readTalk(money.id)?.questions, talk.questions);
});

test("the mentor carries no fixed story about his businesses", () => {
  const system = sent[0].messages[0].content;
  assert.doesNotMatch(system, /AI agency|383 news|200k/);
});

test("no read or no questions is a failure, not an empty talk", async () => {
  answer = JSON.stringify({ read: "", questions: [] });
  await assert.rejects(startTalk(fit, TODAY), /try again/i);
  assert.equal(readTalk(fit.id), null);
});

test("his answers make a draft, nothing is a plan until he locks it, and he can correct it by talking", async () => {
  sent = [];
  answer = JSON.stringify(rawPlan());
  const talk = await answerTalk(money, TODAY, "Checkout and the pricing page are left, about 20 hours a week");
  assert.equal(talk.draft?.milestones[0].label, "Launch 383ks.com");
  assert.deepEqual(talk.draft?.assumes, ["383ks.com isn't live", "No paying customers yet"]);
  assert.match(sent[0].messages[1].content, /Checkout and the pricing page are left/);
  assert.match(sent[0].messages[1].content, /no live product/, "the draft builds on the read he saw");
  assert.equal(readPlanFor(money.id), null, "still only a draft");
  assert.ok(readJournal(TODAY).entries.some((e) => e.text.includes("Checkout and the pricing page are left")), "what he said is remembered");

  sent = [];
  answer = JSON.stringify(rawPlan("Soft launch to 10 friends"));
  const fixed = await answerTalk(money, TODAY, "Do a soft launch first");
  assert.equal(fixed.draft?.milestones[0].label, "Soft launch to 10 friends");
  assert.match(sent[0].messages[1].content, /Launch 383ks.com/, "the correction sees the draft it corrects");
  assert.match(sent[0].messages[1].content, /Do a soft launch first/);
});

test("a draft that finishes after he stopped planning doesn't bring the talk back", async () => {
  answer = JSON.stringify({ read: "r", questions: ["q"] });
  await startTalk(fit, TODAY);
  const stub = globalThis.fetch;
  globalThis.fetch = (async () => {
    cancelTalk(fit.id); // he taps stop while the model is thinking
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(rawPlan()) } }] }), { status: 200 });
  }) as typeof fetch;
  await assert.rejects(answerTalk(fit, TODAY, "three times a week"), /stopped planning/);
  globalThis.fetch = stub;
  assert.equal(readTalk(fit.id), null);
});

test("locking makes it the plan and ends the talk", () => {
  const plan = lockTalk(money.id)!;
  assert.ok(plan.lockedAt);
  assert.equal(readPlanFor(money.id)?.milestones[0].label, "Soft launch to 10 friends");
  assert.equal(readTalk(money.id), null);
  assert.equal(lockTalk(money.id), null, "nothing left to lock");
});

test("orders come only from locked plans; old unlocked plans go quiet and their open orders leave Today", async () => {
  const old = cleanPlan(fit, rawPlan("Old plan"), "groq", TODAY)!;
  savePlan(old); // what's on the server today: no lockedAt
  const wrong = addTodo({ title: "Cold email 100 businesses", day: TODAY, goalId: fit.id, source: "mentor", priority: 3 });
  const done = addTodo({ title: "Old order he finished", day: TODAY, goalId: fit.id, source: "mentor" });
  updateTodo(done.id, { done: true });
  const mine = addTodo({ title: "His own task for the goal", day: TODAY, goalId: fit.id });

  answer = JSON.stringify({
    note: "On track.",
    orders: [
      { goalId: fit.id, title: "Run 5k", how: "Run.", minutes: 30, indicator: null },
      { goalId: money.id, title: "Close 3 launch checklist items", how: "Start with checkout.", minutes: 60, indicator: "launch_items" },
    ],
  });
  const day = await writeMentorDay(TODAY);
  assert.deepEqual(day.orders.map((o) => o.title), ["Close 3 launch checklist items"]);
  const ids = listTodos().map((t) => t.id);
  assert.ok(!ids.includes(wrong.id), "the wrong order is gone");
  assert.ok(ids.includes(done.id), "finished work stays");
  assert.ok(ids.includes(mine.id), "his own tasks stay");
});

test("with no locked plan there are no orders at all", async () => {
  fs.rmSync(path.join(process.env.DATA_DIR!, "mentor", "plans", `${money.id}.json`));
  await assert.rejects(writeMentorDay("2026-11-07"), /no goal has a plan/i);
});

test("the route runs the talk, and editing a locked plan keeps it locked", async () => {
  const call = (body: object) => POST(new Request("http://x/api/mentor", { method: "POST", body: JSON.stringify(body) }));
  answer = JSON.stringify({ read: "You have a gym nearby.", questions: ["How often can you train?"] });
  const started = await (await call({ action: "talk-start", goalId: fit.id })).json();
  assert.equal(started.talk.questions.length, 1);
  answer = JSON.stringify(rawPlan());
  assert.ok((await (await call({ action: "talk-answer", goalId: fit.id, text: "three times a week" })).json()).talk.draft);
  assert.ok((await (await call({ action: "talk-lock", goalId: fit.id })).json()).plan.lockedAt);
  const edited = await (await call({ action: "edit", goalId: fit.id, plan: { strategy: "Edited." } })).json();
  assert.ok(edited.plan.lockedAt, "still locked");
  assert.equal((await call({ action: "talk-start", goalId: "goal-nope" })).status, 404);
  assert.equal((await call({ action: "talk-answer", goalId: fit.id, text: " " })).status, 400);
  assert.equal((await call({ action: "stage", text: "Launched in beta." })).status, 200);
  assert.match(readStage().text, /Launched in beta/);
  answer = JSON.stringify({ read: "r", questions: ["q"] });
  await startTalk(fit, TODAY);
  cancelTalk(fit.id);
  assert.equal(readTalk(fit.id), null);
});
