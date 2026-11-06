import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "life-context-test-"));
process.env.MEMORY_VAULT_DIR = path.join(process.env.DATA_DIR, "vault");
process.env.DASHBOARD_TZ = "UTC";
process.env.GROQ_API_KEY = "test";
process.env.SOL_ENABLED = "0";
delete process.env.NVIDIA_API_KEY;
fs.mkdirSync(process.env.MEMORY_VAULT_DIR, { recursive: true });

const { lifeContext, readStage, saveStage } = await import("../lib/life");
const { addEntry, journalWritten, mirrorAll, readJournal } = await import("../lib/journal");
const { readProfile, refreshProfile, saveProfile } = await import("../lib/buddy");
const { coachNow } = await import("../lib/coach");
const { POST } = await import("../app/api/buddy/route");
const { learned } = await import("../lib/planner");

let answer = "";
let sent: { messages: { content: string }[] }[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (_url: unknown, init: { body: string }) => {
  sent.push(JSON.parse(init.body));
  return new Response(JSON.stringify({ choices: [{ message: { content: answer } }] }), { status: 200 });
}) as typeof fetch;
test.after(() => {
  globalThis.fetch = realFetch;
});

const day = () => coachNow().day;
const note = (d: string) => fs.readFileSync(path.join(process.env.MEMORY_VAULT_DIR!, "100 - Me", "journal", `${d}.md`), "utf8");

test("everything Lind tells the Buddy lands in that day's Obsidian note; its replies don't", async () => {
  answer = JSON.stringify({ reply: "Nice one, what's left before launch?", actions: [] });
  const res = await POST(new Request("http://x/api/buddy", { method: "POST", body: JSON.stringify({ message: "still fixing checkout on 383ks, launch keeps slipping", voice: true }) }));
  assert.equal(res.status, 200);
  const md = note(day());
  assert.match(md, /## Buddy/);
  assert.match(md, /still fixing checkout on 383ks/);
  assert.doesNotMatch(md, /what's left before launch/);
  assert.equal(journalWritten(day()), false, "a chat doesn't cancel the 21:00 'how was your day?'");
  assert.ok(readJournal(day()).entries.some((e) => e.source === "buddy"), "he can see and delete it in the journal");
});

test("a Buddy message long enough to be a dictation isn't cut", async () => {
  answer = JSON.stringify({ reply: "ok", actions: [] });
  const long = `${"word ".repeat(1200)}the end of it`;
  await POST(new Request("http://x/api/buddy", { method: "POST", body: JSON.stringify({ message: long }) }));
  assert.ok(note(day()).includes("the end of it"));
});

test("days written while the vault was unreachable reach it on the next sweep", () => {
  const vault = process.env.MEMORY_VAULT_DIR!;
  process.env.MEMORY_VAULT_DIR = "/nonexistent\0/vault";
  addEntry("2026-10-01", "written while the vault was down", "text");
  process.env.MEMORY_VAULT_DIR = vault;
  mirrorAll();
  assert.match(note("2026-10-01"), /written while the vault was down/);
});

test("his stage is saved in his words, mirrored to Obsidian, and outranks everything in the context", () => {
  saveStage("383ks.com isn't launched yet. No customers. Finishing it comes before any selling.");
  assert.match(readStage().text, /isn't launched yet/);
  assert.match(fs.readFileSync(path.join(process.env.MEMORY_VAULT_DIR!, "100 - Me", "Where I am now.md"), "utf8"), /isn't launched yet/);
  saveProfile("## Right now\nHeads down on the launch.");
  addEntry(day(), "Spent the whole day on the pricing page", "text");
  const ctx = lifeContext(day());
  assert.match(ctx, /isn't launched yet/);
  assert.match(ctx, /Heads down on the launch/);
  assert.match(ctx, /Spent the whole day on the pricing page/);
  assert.match(ctx, /still fixing checkout on 383ks/, "what he told the Buddy counts");
  assert.ok(ctx.indexOf("isn't launched yet") < ctx.indexOf("Heads down"), "his own words come first");
  assert.match(ctx, /overrides/i);
});

test("the context stays a sane size however much he talks", () => {
  for (let i = 0; i < 40; i++) addEntry("2026-10-30", "long day ".repeat(300), "text");
  assert.ok(lifeContext("2026-11-02").length < 12_000);
});

test("the Today planner plans from his stage and what he's been saying", async () => {
  const body = (await learned(day(), [])).join(" ");
  assert.match(body, /isn't launched yet/);
  assert.match(body, /Heads down on the launch/);
});

test("the nightly notes still get written when Sol is out of credits", async () => {
  answer = JSON.stringify({ profile: "## Right now\nGroq wrote this because Sol was out, and it is long enough to keep." });
  await refreshProfile(day());
  assert.match(readProfile().text, /Groq wrote this/);
});
