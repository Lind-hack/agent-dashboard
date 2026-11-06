import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "learning-sunday-test-"));
process.env.MEMORY_VAULT_DIR = path.join(process.env.DATA_DIR, "no-vault");
process.env.DASHBOARD_TZ = "UTC";
process.env.GROQ_API_KEY = "test";
process.env.SOL_ENABLED = "0";
delete process.env.NVIDIA_API_KEY;
delete process.env.GEMINI_API_KEY;
delete process.env.GOOGLE_AI_API_KEY;

const { buildReviewQueue, cardKey, dailyQueue, generateSession, gradeCard, learningOverview, readReviewRecords } = await import("../lib/learning");
const { readTopics, sortTopics, topicsView } = await import("../lib/learning-topics");
const { buildSunday, confirmRound, currentSession, drillTerm, finishSession, gradeRound, overrideTerm, startCustom, startSunday, sundayOf } = await import("../lib/learning-sunday");
const { saveItem, listItems } = await import("../lib/library");
const { sundayTick } = await import("../runner/learning-sunday");
const { listTodos } = await import("../lib/todos");

let sent: { messages: { content: string }[] }[] = [];
let answer: unknown = {};
const realFetch = globalThis.fetch;
globalThis.fetch = (async (_u: unknown, init: { body: string }) => {
  sent.push(JSON.parse(init.body));
  return answer === null ? new Response("{}", { status: 429 }) : new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(answer) } }] }), { status: 200 });
}) as typeof fetch;
test.after(() => {
  globalThis.fetch = realFetch;
});

const SUNDAY = "2026-11-08";
const now = new Date(`${SUNDAY}T10:00:00.000Z`);
const source = (id: string, title: string, studyAt: string, terms: string[], questions: string[] = []) => {
  saveItem({
    id,
    kind: "video",
    status: "ready",
    createdAt: studyAt,
    updatedAt: studyAt,
    title,
    summary: "",
    text: "",
    tags: [],
    studyAt,
    learning: { state: "ready", depth: 2, concepts: terms.map((t) => ({ term: t, explanation: `${t} is explained properly here.` })), keyPoints: [], questions: questions.map((q) => ({ q, a: `Answer to ${q}`, kind: "explain" as const })) },
  });
};
source("M-MONTHSAGO", "Discrete maths, chapter 1", "2026-05-01T10:00:00.000Z", ["Induction", "Pigeonhole"], ["Why does induction work?"]);
source("M-LASTMONTH", "Graph theory", "2026-10-01T10:00:00.000Z", ["Euler path", "Hamilton path"]);
source("M-THISWEEK", "Transformers", "2026-11-05T10:00:00.000Z", ["Attention", "Query", "Key"]);

const allKeys = () => listItems().flatMap((i) => (i.learning?.concepts ?? []).map((c) => cardKey(i.id, c.term)));

test("Sunday is the Sunday on or before a day", () => {
  assert.equal(sundayOf(SUNDAY), SUNDAY);
  assert.equal(sundayOf("2026-11-11"), SUNDAY);
  assert.equal(sundayOf("2026-11-07"), "2026-11-01");
});

test("review asks the saved questions too, not only terms", () => {
  const cards = buildReviewQueue(listItems(), {}, now);
  const q = cards.find((c) => c.type === "question")!;
  assert.equal(q.term, "Why does induction work?");
  assert.match(q.explanation, /Answer to/);
  assert.ok(gradeCard(listItems(), q.key, "good", now));
  assert.ok(readReviewRecords()[q.key]);
  assert.equal(gradeCard(listItems(), "M-THISWEEK#t:not-a-term", "good", now), null);
});

test("a deep source can't bury him: new cards a day are capped, due reviews never are", () => {
  const many = Array.from({ length: 80 }, (_, i) => `New term ${i}`);
  source("M-BIGSOURCE", "Huge lecture", "2026-11-06T10:00:00.000Z", many);
  const cards = buildReviewQueue(listItems(), readReviewRecords(), now);
  const q = dailyQueue(cards, readReviewRecords(), now, 20);
  assert.ok(q.filter((c) => c.isNew).length <= 20);
  assert.equal(q.filter((c) => !c.isNew && Date.parse(c.due) <= now.getTime()).length, cards.filter((c) => !c.isNew && Date.parse(c.due) <= now.getTime()).length);
  assert.ok(learningOverview(listItems(), now).counts.due <= q.length);
  fs.rmSync(path.join(process.env.DATA_DIR!, "library", "items", "M-BIGSOURCE.json"));
});

test("the page payload stays light: no full digests for every source", () => {
  const o = learningOverview(listItems(), now);
  const it = o.items.find((i) => i.id === "M-MONTHSAGO")!;
  assert.equal(it.conceptCount, 2);
  assert.equal(it.questionCount, 1);
  assert.deepEqual(it.learning?.concepts, []);
});

test("concepts sort into topics; the model can't invent terms, and topics stay blurtable in size", async () => {
  answer = { topics: [{ name: "Proof techniques", keys: [cardKey("M-MONTHSAGO", "Induction"), cardKey("M-MONTHSAGO", "Pigeonhole"), "made#t:up"] }, { name: "Graphs", keys: [cardKey("M-LASTMONTH", "Euler path")] }] };
  await sortTopics(listItems());
  const t = readTopics();
  assert.deepEqual(t.find((x) => x.name === "Proof techniques")?.keys.length, 2);
  assert.ok(!t.some((x) => x.keys.includes("made#t:up")));
  // Next pass: the second graph term joins the topic that exists rather than making a duplicate.
  sent = [];
  answer = { topics: [{ name: "graphs", keys: [cardKey("M-LASTMONTH", "Hamilton path")] }] };
  await sortTopics(listItems());
  assert.equal(readTopics().filter((x) => x.name.toLowerCase() === "graphs").length, 1);
  assert.match(sent[0].messages[1].content, /Proof techniques/, "it sees the topics that exist");
});

test("memory strength reads from the review record", () => {
  const keys = { strong: cardKey("M-LASTMONTH", "Euler path"), weak: cardKey("M-LASTMONTH", "Hamilton path") };
  const day = 86_400_000;
  const rec = { [keys.strong]: { due: new Date(now.getTime() + 20 * day).toISOString(), interval: 30, ease: 2.6, reps: 5, lapses: 0, last: new Date(now.getTime() - 2 * day).toISOString() }, [keys.weak]: { due: new Date(now.getTime() - 20 * day).toISOString(), interval: 3, ease: 1.5, reps: 1, lapses: 3, last: new Date(now.getTime() - 40 * day).toISOString() } };
  const g = topicsView(listItems(), rec, now).find((x) => x.name === "Graphs")!;
  assert.equal(g.terms.find((t) => t.key === keys.strong)?.memory, "strong");
  assert.equal(g.terms.find((t) => t.key === keys.weak)?.memory, "weak");
});

test("nothing is ever left out: every concept ever studied is in a Sunday round, months-old ones too", () => {
  const s = buildSunday(SUNDAY, listItems(), readReviewRecords(), now);
  const covered = s.rounds.flatMap((r) => r.terms.map((t) => t.key));
  assert.deepEqual([...covered].sort(), [...allKeys()].sort());
  assert.equal(new Set(covered).size, covered.length, "and only once");
});

test("this week's sources come first and whole, then every older topic", () => {
  const s = buildSunday(SUNDAY, listItems(), readReviewRecords(), now);
  assert.equal(s.rounds[0].kind, "week");
  assert.equal(s.rounds[0].title, "Transformers");
  assert.equal(s.rounds[0].terms.length, 3);
  assert.ok(s.rounds.slice(1).every((r) => r.kind === "older"));
  assert.ok(s.rounds.some((r) => r.title === "Proof techniques"));
});

test("terms the topic sorter never reached still get a round", () => {
  source("M-UNSORTED1", "Fresh old notes", "2026-09-01T10:00:00.000Z", ["Unsorted term"]);
  const s = buildSunday(SUNDAY, listItems(), readReviewRecords(), now);
  assert.ok(s.rounds.flatMap((r) => r.terms).some((t) => t.key === cardKey("M-UNSORTED1", "Unsorted term")));
});

test("a blurt is saved before grading, so a model failure never loses it", async () => {
  const s = startSunday(SUNDAY, now);
  const round = s.rounds[0];
  answer = null;
  await assert.rejects(gradeRound(s.id, round.id, "attention lets each token look at the others"), /busy/);
  assert.equal(currentSession(SUNDAY)!.rounds[0].blurt, "attention lets each token look at the others");
});

test("the AI marks every term; what it doesn't mention counts as missed", async () => {
  const s = currentSession(SUNDAY)!;
  const round = s.rounds[0];
  const k = (t: string) => cardKey("M-THISWEEK", t);
  answer = { feedback: "Solid on attention, nothing on keys.", terms: [{ key: k("Attention"), status: "recalled" }, { key: k("Query"), status: "partial", note: "You missed that it's learned." }, { key: "bad#key", status: "recalled" }] };
  const r = await gradeRound(s.id, round.id, "attention lets each token look at the others");
  assert.equal(r.graded?.find((t) => t.key === k("Attention"))?.status, "recalled");
  assert.equal(r.graded?.find((t) => t.key === k("Query"))?.note, "You missed that it's learned.");
  assert.equal(r.graded?.find((t) => t.key === k("Key"))?.status, "missed");
  assert.equal(r.graded?.length, 3);
  assert.match(sent.at(-1)!.messages[1].content, /attention lets each token/);
  assert.equal(readReviewRecords()[k("Key")], undefined, "nothing counts until he's seen it");
});

test("he can overrule a mark; confirming applies it once; missed terms come back soonest", () => {
  const s = currentSession(SUNDAY)!;
  const round = s.rounds[0];
  const k = (t: string) => cardKey("M-THISWEEK", t);
  overrideTerm(s.id, round.id, k("Query"), "recalled");
  assert.equal(currentSession(SUNDAY)!.rounds[0].graded?.find((t) => t.key === k("Query"))?.overruled, true);
  const done = confirmRound(s.id, round.id, now);
  assert.deepEqual(done.drills, [k("Key")]);
  const rec = readReviewRecords();
  assert.ok(Date.parse(rec[k("Key")].due) - now.getTime() < 86_400_000, "missed: back within a day");
  assert.ok(rec[k("Query")].interval >= 1);
  const lapses = rec[k("Key")].lapses;
  confirmRound(s.id, round.id, now);
  assert.equal(readReviewRecords()[k("Key")].lapses, lapses, "confirming twice changes nothing");
});

test("a recalled term doesn't get pushed further out every week just for being in its topic", () => {
  const s = currentSession(SUNDAY)!;
  const key = cardKey("M-THISWEEK", "Query");
  const before = readReviewRecords()[key].interval;
  const r = s.rounds[0];
  r.confirmed = false;
  fs.writeFileSync(path.join(process.env.DATA_DIR!, "learning", "sessions", `${s.id}.json`), JSON.stringify(s));
  confirmRound(s.id, r.id, now);
  assert.equal(readReviewRecords()[key].interval, before);
});

test("drilling a missed term, then finishing, gives the report and ticks the task", async () => {
  const s = currentSession(SUNDAY)!;
  const k = cardKey("M-THISWEEK", "Key");
  drillTerm(s.id, s.rounds[0].id, k, true);
  assert.deepEqual(currentSession(SUNDAY)!.rounds[0].fixed, [k]);
  assert.throws(() => finishSession(s.id, now), /rounds left/, "every round has to be done");
  for (const r of currentSession(SUNDAY)!.rounds.slice(1)) {
    answer = { feedback: "ok", terms: r.terms.map((t) => ({ key: t.key, status: "recalled" })) };
    await gradeRound(s.id, r.id, "I remember all of it, truly");
    confirmRound(s.id, r.id, now);
  }
  const done = finishSession(s.id, now);
  assert.equal(done.state, "done");
  assert.equal(done.report?.missed, 1);
  assert.equal(done.report?.fixed, 1);
  assert.ok(done.report!.recalled >= 3);
  assert.ok(done.report!.slipping.some((x) => x.includes("Key")));
});

test("Sunday 10:00 opens the session once, with a push and a task; before then nothing", async () => {
  const pushes: string[] = [];
  const notify = async (n: { key: string }) => void pushes.push(n.key);
  const next = "2026-11-15";
  await sundayTick({ day: next, minute: "09:59", notify, now: new Date(`${next}T09:59:00Z`) });
  assert.equal(currentSession(next), null);
  await sundayTick({ day: next, minute: "10:00", notify, now: new Date(`${next}T10:00:00Z`) });
  await sundayTick({ day: next, minute: "10:01", notify, now: new Date(`${next}T10:01:00Z`) });
  assert.equal(currentSession(next)?.state, "open");
  assert.deepEqual(pushes, [`learning:sunday:${next}`]);
  assert.equal(listTodos().filter((t) => t.day === next && /blurt/i.test(t.title)).length, 1);
});

test("an unfinished Sunday carries into Monday with another push", async () => {
  const pushes: string[] = [];
  const notify = async (n: { key: string }) => void pushes.push(n.key);
  await sundayTick({ day: "2026-11-16", minute: "10:00", notify, now: new Date("2026-11-16T10:00:00Z") });
  assert.deepEqual(pushes, ["learning:sunday-again:2026-11-15"]);
  assert.equal(currentSession("2026-11-16")?.id, "sunday-2026-11-15");
});

test("a blurt on sources he picks uses the same rounds, any day", () => {
  const s = startCustom(["M-LASTMONTH"], now);
  assert.equal(s.rounds.length, 1);
  assert.equal(s.rounds[0].terms.length, 2);
  assert.match(s.id, /^custom-/);
});

test("practice sessions use every source he picks, not just the first eight", async () => {
  sent = [];
  for (let i = 0; i < 12; i++) source(`M-MANY${String(i).padStart(4, "A").replace(/\d/g, (d) => "ABCDEFGHIJ"[Number(d)])}`, `Source number ${i}`, "2026-10-10T10:00:00.000Z", [`Term ${i}`]);
  answer = { title: "t", intro: "i", steps: [{ prompt: "p", answer: "a", at: null }] };
  const s = await generateSession("interview-me", listItems().filter((i) => i.title.startsWith("Source number")));
  assert.equal(s.sources.length, 12);
  assert.match(sent[0].messages[1].content, /Source number 0/);
  assert.match(sent[0].messages[1].content, /Source number 11/);
});
