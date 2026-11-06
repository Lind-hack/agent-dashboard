import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "say-long-test-"));
process.env.MEMORY_VAULT_DIR = path.join(process.env.DATA_DIR, "no-vault");
process.env.DASHBOARD_TZ = "UTC";
process.env.GROQ_API_KEY = "test";
delete process.env.NVIDIA_API_KEY;

const { applySay, cleanItems, draftItems, parseSay, undoSay } = await import("../lib/say");
const { listTodos } = await import("../lib/todos");
const { readJournal } = await import("../lib/journal");
const { readPlan } = await import("../lib/plan-store");
const { coachNow } = await import("../lib/coach");
const { POST } = await import("../app/api/say/route");

// The model, stubbed at the network: what it answers, and what it was sent.
let answer: string | null = "";
let sent: { model: string; messages: { content: string }[]; max_completion_tokens: number }[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (_url: unknown, init: { body: string }) => {
  sent.push(JSON.parse(init.body));
  return new Response(JSON.stringify({ choices: [{ message: { content: answer } }] }), { status: 200 });
}) as typeof fetch;
test.after(() => {
  globalThis.fetch = realFetch;
});

const today = () => coachNow().day;
const ramble = "okay so tomorrow I have to finish the landing page for 383ks. first I want to fix the hero, then write the pricing section, and I'm thinking the pricing should be simple, like two plans, and then I ship it to Vercel. ";

test("a long ramble about one job stays one task, its details kept as notes and steps", async () => {
  answer = JSON.stringify({
    items: [
      {
        kind: "task",
        title: "Finish the 383ks landing page",
        day: today(),
        quote: "finish the landing page for 383ks",
        dupOf: null,
        notes: "Pricing should be simple, two plans.",
        steps: ["Fix the hero", "Write the pricing section", "Ship it to Vercel"],
      },
    ],
  });
  const drafts = await parseSay(ramble.repeat(3));
  assert.equal(drafts.length, 1);
  const results = await applySay(drafts.map((d) => d.item));
  assert.equal(results[0].error, undefined);
  const t = listTodos().find((x) => x.title === "Finish the 383ks landing page")!;
  assert.equal(t.notes, "Pricing should be simple, two plans.");
  assert.deepEqual(t.subtasks.map((s) => s.title), ["Fix the hero", "Write the pricing section", "Ship it to Vercel"]);
});

test("the model gets room to answer a long dictation", async () => {
  sent = [];
  answer = JSON.stringify({ items: [] });
  await parseSay(ramble.repeat(12));
  assert.ok(sent[0].max_completion_tokens >= 3000, `only ${sent[0].max_completion_tokens} tokens`);
});

test("an empty or broken answer from every model is a failure, never 'no tasks said'", async () => {
  answer = null;
  await assert.rejects(parseSay(ramble), /busy/);
  answer = "";
  await assert.rejects(parseSay(ramble), /busy/);
  answer = "{}";
  await assert.rejects(parseSay(ramble), /busy/);
});

test("the route reads a 10-minute dictation to the end", async () => {
  sent = [];
  answer = JSON.stringify({ items: [] });
  const long = `${"word ".repeat(2400)}the very last sentence`;
  const res = await POST(new Request("http://x/api/say", { method: "POST", body: JSON.stringify({ text: long }) }));
  assert.equal(res.status, 200);
  assert.ok(sent[0].messages[1].content.includes("the very last sentence"));
  assert.equal((await res.json()).heard.length, long.length, "what he said comes back whole, so the page can keep it");
});

test("on the Goals page the model is told so", async () => {
  sent = [];
  answer = JSON.stringify({ items: [] });
  await POST(new Request("http://x/api/say", { method: "POST", body: JSON.stringify({ text: "I want to reach 10k a month", from: "goals" }) }));
  assert.match(sent[0].messages[1].content, /Goals page/);
});

test("half-grounded items are offered unticked, invented ones still dropped", () => {
  const said = "I should probably sort out the invoices for the agency at some point";
  const raw = [
    { kind: "task", title: "Send the agency invoices to the accountant", day: "2026-11-06", quote: "", dupOf: null },
    { kind: "task", title: "Book a dentist appointment", day: "2026-11-06", quote: "book a dentist", dupOf: null },
  ];
  const drafts = draftItems(raw, cleanItems(raw, "2026-11-06", new Set()), said, []);
  assert.deepEqual(drafts.map((d) => d.item.title), ["Send the agency invoices to the accountant"]);
  assert.equal(drafts[0].unsure, true);
});

test("a block with details carries them on a linked task, and undo takes both back", async () => {
  const day = today();
  const [r] = await applySay([{ kind: "block", title: "Write the pitch deck", day, start: "23:00", length: 30, notes: "Three slides.", steps: ["Problem", "Offer"] }]);
  const t = listTodos().find((x) => x.title === "Write the pitch deck")!;
  assert.equal(t.notes, "Three slides.");
  assert.equal(t.subtasks.length, 2);
  assert.equal(readPlan(day)?.blocks.find((b) => b.title === "Write the pitch deck")?.taskId, t.id);
  await undoSay(r.undo!);
  assert.equal(listTodos().some((x) => x.id === t.id), false);
});

test("what he said about a new goal is kept in the journal, where the mentor reads it", async () => {
  await applySay([{ kind: "goal", title: "Reach 10k a month", horizon: "long", next: "", why: "", notes: "383ks isn't launched yet, launch comes first." }]);
  assert.ok(readJournal(today()).entries.some((e) => e.text.includes("383ks isn't launched yet") && e.text.includes("Reach 10k a month")));
});
