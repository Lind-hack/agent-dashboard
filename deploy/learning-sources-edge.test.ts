import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "learning-edge-test-"));
process.env.MEMORY_VAULT_DIR = path.join(process.env.DATA_DIR, "no-vault");
process.env.DASHBOARD_TZ = "UTC";
process.env.GROQ_API_KEY = "test";
process.env.SUPADATA_API_KEY = "test";
delete process.env.NVIDIA_API_KEY;
delete process.env.GEMINI_API_KEY;
delete process.env.GOOGLE_AI_API_KEY;

const { isStudyMaterial, learningOverview, mergeRead, questionKey, setStudying } = await import("../lib/learning");
const { POST: studyPOST } = await import("../app/api/learning/study/route");
const { buildSunday } = await import("../lib/learning-sunday");
const { readItem, saveItem, listItems } = await import("../lib/library");
const { nextToRead } = await import("../runner/learning");
const { platformTranscript, videoTranscript } = await import("../runner/library");

const realFetch = globalThis.fetch;
test.after(() => {
  globalThis.fetch = realFetch;
});
const at = "2026-10-01T10:00:00.000Z";
const base = { createdAt: at, updatedAt: at, summary: "", text: "", tags: [] as string[], title: "t" };

test("a saved article can be studied", () => {
  assert.equal(isStudyMaterial({ ...base, id: "M-ARTICLE1", kind: "link", status: "ready", url: "https://example.com/a", text: "w ".repeat(300) }), true);
});

test("a video added while it's still being captured waits for its transcript", () => {
  saveItem({ ...base, id: "M-CAPTURING", kind: "video", status: "processing" });
  setStudying("M-CAPTURING", true);
  assert.equal(nextToRead(listItems()), undefined);
  const it = readItem("M-CAPTURING")!;
  it.status = "ready";
  saveItem(it);
  assert.equal(nextToRead(listItems())?.id, "M-CAPTURING");
});

test("adding a failed source again retries it", () => {
  saveItem({ ...base, id: "M-FAILED01", kind: "video", status: "ready", studyAt: false, learning: { state: "failed", concepts: [], keyPoints: [], questions: [], error: "x" } });
  setStudying("M-FAILED01", true);
  assert.equal(readItem("M-FAILED01")!.learning?.state, "queued");
});

test("a big unsorted source is split into rounds one blurt long, with nothing dropped", () => {
  const terms = Array.from({ length: 40 }, (_, i) => ({ term: `Term ${i}`, explanation: "e" }));
  saveItem({ ...base, id: "M-BIGOLD01", kind: "video", status: "ready", title: "Big old source", studyAt: "2026-05-01T10:00:00.000Z", learning: { state: "ready", concepts: terms, keyPoints: [], questions: [] } });
  const s = buildSunday("2026-11-08", listItems().filter((i) => i.id === "M-BIGOLD01"));
  assert.equal(s.rounds.length, 3);
  assert.ok(s.rounds.every((r) => r.terms.length <= 15));
  assert.equal(s.rounds.flatMap((r) => r.terms).length, 40);
});

test("an old item with half a digest can't crash the page", () => {
  fs.mkdirSync(path.join(process.env.DATA_DIR!, "library", "items"), { recursive: true });
  fs.writeFileSync(path.join(process.env.DATA_DIR!, "library", "items", "M-HALFDIGEST.json"), JSON.stringify({ ...base, id: "M-HALFDIGEST", kind: "video", status: "ready", learning: { state: "ready" } }));
  assert.deepEqual(readItem("M-HALFDIGEST")!.learning?.concepts, []);
  assert.doesNotThrow(() => learningOverview(listItems()));
  fs.rmSync(path.join(process.env.DATA_DIR!, "library", "items", "M-HALFDIGEST.json"));
});

test("a reviewed question survives a deeper read, and long questions don't share a record", () => {
  const long = `${"why ".repeat(30)}`;
  assert.notEqual(questionKey("M-X", `${long}does A work`), questionKey("M-X", `${long}does B work`));
  const q = { q: "Why does it work?", a: "Because.", kind: "explain" as const };
  const dropped = { q: "Never reviewed?", a: "No.", kind: "recall" as const };
  const merged = mergeRead({ state: "ready", concepts: [], keyPoints: [], questions: [q, dropped] }, { next: 1, total: 1, sections: [], concepts: [], questions: [{ q: "New one?", a: "Yes.", kind: "recall" }], keyPoints: [], tries: 0 }, {}, "m", { [questionKey("M-X", q.q)]: { due: at, interval: 3, ease: 2.5, reps: 2, lapses: 0 } }, "M-X");
  assert.deepEqual(merged.questions.map((x) => x.q), ["New one?", "Why does it work?"]);
});

test("too-short notes can't sit in Study unread; plans use only what's in Study", async () => {
  saveItem({ ...base, id: "M-TINYNOTE", kind: "text", status: "ready", text: "pasta" });
  const res = await studyPOST(new Request("http://x/api/learning/study", { method: "POST", body: JSON.stringify({ id: "M-TINYNOTE", on: true }) }));
  assert.equal(res.status, 400);
  assert.equal(readItem("M-TINYNOTE")!.studyAt, undefined);
});

test("YouTube cues keep their times and merge into blurtable pieces, to the very end", () => {
  const cues = Array.from({ length: 2400 }, (_, i) => ({ text: `line ${i}`, offset: i * 3000, duration: 3000 }));
  const t = platformTranscript(cues, "en")!;
  assert.ok(t.segments.length < 400 && t.segments.length > 200, `${t.segments.length} segments`);
  assert.equal(t.segments[0].start, 0);
  assert.equal(t.segments.at(-1)!.end, 7200);
  assert.ok(t.segments.at(-1)!.text.includes("line 2399"), "the last line of a two-hour video is there");
});

test("a long YouTube video that comes back as a job is waited for", async () => {
  const urls: string[] = [];
  globalThis.fetch = (async (u: string) => {
    urls.push(String(u));
    if (String(u).includes("/transcript?")) return new Response(JSON.stringify({ jobId: "job1" }), { status: 202 });
    return new Response(JSON.stringify(urls.length < 3 ? { status: "active" } : { status: "completed", lang: "en", content: [{ text: "the end of a long talk", offset: 7_000_000, duration: 4000 }] }), { status: 200 });
  }) as typeof fetch;
  const t = await videoTranscript(new URL("https://www.youtube.com/watch?v=abc"), 0);
  assert.match(urls[0], /text=false/);
  assert.match(urls[1], /transcript\/job1/);
  assert.equal(t?.segments[0].text, "the end of a long talk");
  assert.equal(t?.segments[0].start, 7000);
});

test("no transcript from the platform is no transcript, not a crash", async () => {
  globalThis.fetch = (async () => new Response("{}", { status: 404 })) as typeof fetch;
  assert.equal(await videoTranscript(new URL("https://www.youtube.com/watch?v=abc"), 0), null);
});
