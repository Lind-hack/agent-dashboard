import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "learning-study-test-"));
process.env.MEMORY_VAULT_DIR = path.join(process.env.DATA_DIR, "no-vault");
process.env.DASHBOARD_TZ = "UTC";

const { buildReviewQueue, cardKey, gradeCard, inStudy, learningOverview, migrateReviewKeys, readReviewRecords, searchSources, setStudying } = await import("../lib/learning");
const { saveItem, readItem, listItems } = await import("../lib/library");
const { POST: studyPOST } = await import("../app/api/learning/study/route");

const base = { status: "ready" as const, createdAt: "2026-10-01T10:00:00.000Z", updatedAt: "2026-10-01T10:00:00.000Z", summary: "", text: "", tags: [] as string[] };
const digest = (terms: string[]) => ({ state: "ready" as const, concepts: terms.map((t) => ({ term: t, explanation: `${t} explained in detail.` })), keyPoints: [], questions: [] });

saveItem({ ...base, id: "M-VIDEO1", kind: "video", title: "Attention is all you need", text: "Transcript: the query vector meets the key vector", learning: digest(["Query", "Key", "Value"]) });
saveItem({ ...base, id: "M-PDFONE", kind: "file", title: "Discrete maths notes", summary: "Graphs and proofs", tags: ["maths"], text: "Induction proves statements about all naturals", media: { file: "x.pdf", mime: "application/pdf", bytes: 10, name: "dm.pdf" } });
saveItem({ ...base, id: "M-NOTEONE", kind: "text", title: "Dinner ideas", text: "Pasta again" });

test("sources already analysed start in Study; nothing else does", () => {
  assert.equal(inStudy(readItem("M-VIDEO1")!), true);
  assert.equal(inStudy(readItem("M-PDFONE")!), false);
  assert.equal(inStudy(readItem("M-NOTEONE")!), false);
});

test("search finds sources by title, topic or the text inside them, and says where", () => {
  const hits = searchSources(listItems(), "induction");
  assert.deepEqual(hits.map((h) => h.id), ["M-PDFONE"]);
  assert.match(hits[0].snippet, /Induction proves/);
  assert.deepEqual(searchSources(listItems(), "maths").map((h) => h.id), ["M-PDFONE"], "tags count");
  assert.deepEqual(searchSources(listItems(), "attention query").map((h) => h.id), ["M-VIDEO1"], "every word has to match");
  assert.deepEqual(searchSources(listItems(), "ATTENTION").map((h) => h.id), ["M-VIDEO1"]);
  assert.equal(searchSources(listItems(), "").length, 3, "an empty search lists everything");
  assert.equal(searchSources(listItems(), "no such thing").length, 0);
});

test("search finds words deep in a transcript, past what the page keeps", () => {
  saveItem({ ...base, id: "M-LONGONE", kind: "video", title: "Long lecture", transcript: { source: "whisper", format: "text", segments: [{ start: 7000, end: 7005, text: "and that is the pigeonhole principle" }] } });
  assert.deepEqual(searchSources(listItems(), "pigeonhole").map((h) => h.id), ["M-LONGONE"]);
});

test("adding a source to Study queues its full read; removing keeps the read", async () => {
  const res = await studyPOST(new Request("http://x/api/learning/study", { method: "POST", body: JSON.stringify({ id: "M-PDFONE", on: true }) }));
  assert.equal(res.status, 200);
  const it = readItem("M-PDFONE")!;
  assert.equal(inStudy(it), true);
  assert.equal(it.learning?.state, "queued");
  setStudying("M-VIDEO1", false);
  assert.equal(inStudy(readItem("M-VIDEO1")!), false);
  assert.equal(readItem("M-VIDEO1")!.learning?.state, "ready");
  setStudying("M-VIDEO1", true);
  assert.equal(readItem("M-VIDEO1")!.learning?.state, "ready", "a source already read isn't queued again");
  assert.equal((await studyPOST(new Request("http://x/api/learning/study", { method: "POST", body: JSON.stringify({ id: "nope", on: true }) }))).status, 404);
});

test("only sources in Study make review cards", () => {
  setStudying("M-VIDEO1", false);
  assert.equal(buildReviewQueue(listItems()).length, 0);
  setStudying("M-VIDEO1", true);
  assert.equal(buildReviewQueue(listItems()).length, 3);
});

test("review progress follows the term, not its position, so a deeper read keeps it", () => {
  // Saved by the old build: progress on "Key", the second concept.
  fs.mkdirSync(path.join(process.env.DATA_DIR!, "learning"), { recursive: true });
  fs.writeFileSync(path.join(process.env.DATA_DIR!, "learning", "review.json"), JSON.stringify({ "M-VIDEO1#1": { due: "2030-01-01T00:00:00.000Z", interval: 90, ease: 2.6, reps: 6, lapses: 0 } }));
  migrateReviewKeys(listItems());
  const it = readItem("M-VIDEO1")!;
  it.learning = digest(["Encoder", "Key", "Query", "Value"]);
  saveItem(it);
  const card = buildReviewQueue(listItems()).find((c) => c.term === "Key")!;
  assert.equal(card.reps, 6);
  assert.equal(card.isNew, false);
  assert.equal(buildReviewQueue(listItems()).find((c) => c.term === "Encoder")!.isNew, true);
  gradeCard(listItems(), cardKey("M-VIDEO1", "Key"), "good");
  assert.equal(Object.keys(readReviewRecords()).filter((k) => k.startsWith("M-VIDEO1")).length, 1, "one record per term");
});

test("the overview says what's in Study", () => {
  const o = learningOverview(listItems());
  assert.equal(o.items.find((i) => i.id === "M-VIDEO1")?.studying, true);
  assert.equal(o.items.find((i) => i.id === "M-NOTEONE")?.studying, false);
  assert.equal(o.counts.study, 2);
});
