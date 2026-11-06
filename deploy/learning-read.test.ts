import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "learning-read-test-"));
process.env.MEMORY_VAULT_DIR = path.join(process.env.DATA_DIR, "no-vault");
process.env.DASHBOARD_TZ = "UTC";
process.env.GROQ_API_KEY = "test";
delete process.env.NVIDIA_API_KEY;
delete process.env.GEMINI_API_KEY;
delete process.env.GOOGLE_AI_API_KEY;

const { buildReviewQueue, cardKey, setStudying, splitPages, splitText, splitTimed, readReviewRecords } = await import("../lib/learning");
const { saveItem, readItem, listItems } = await import("../lib/library");
const { nextToRead, pdfPages, readStep } = await import("../runner/learning");

let sent: { messages: { content: string }[] }[] = [];
let reply: (user: string) => unknown = () => ({});
const realFetch = globalThis.fetch;
globalThis.fetch = (async (_u: unknown, init: { body: string }) => {
  const b = JSON.parse(init.body);
  sent.push(b);
  const out = reply(b.messages[1].content);
  return out === null ? new Response("{}", { status: 429 }) : new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(out) } }] }), { status: 200 });
}) as typeof fetch;
test.after(() => {
  globalThis.fetch = realFetch;
});

const part = (u: string) => {
  const n = u.match(/Part (\d+) of/)?.[1] ?? "0";
  return { title: `Part ${n}`, summary: `What part ${n} teaches, in detail.`, concepts: [{ term: `Idea ${n}`, explanation: `Idea ${n} explained at length, with why it works.`, example: `Example ${n}`, at: Number(n) * 100 }], key_points: [`Point ${n}`], questions: [{ q: `Why does idea ${n} work?`, a: `Because of reason ${n}.`, kind: "explain" }] };
};
const replyAll = (u: string) => (/whole source/.test(u) ? { thesis: "The whole thing, in a line.", key_points: ["Across all parts"] } : part(u));
const base = { status: "ready" as const, createdAt: "2026-10-01T10:00:00.000Z", updatedAt: "2026-10-01T10:00:00.000Z", summary: "", text: "", tags: [] as string[], title: "" };
const lecture = (id: string, cues: number) => ({ ...base, id, kind: "link" as const, title: "Two hour lecture", transcript: { source: "file" as const, format: "text" as const, segments: Array.from({ length: cues }, (_, i) => ({ start: i * 60, end: i * 60 + 60, text: `cue ${i} ${"words ".repeat(80)}` })) } });

test("a transcript splits into parts that cover it to the last word, with their times", () => {
  const parts = splitTimed({ source: "file", format: "text", segments: Array.from({ length: 100 }, (_, i) => ({ start: i * 60, end: i * 60 + 60, text: `cue${i} ${"w ".repeat(150)}` })) }, 12_000);
  assert.ok(parts.length >= 3);
  assert.equal(parts[0].start, 0);
  assert.equal(parts.at(-1)!.end, 6000);
  assert.ok(parts.at(-1)!.text.includes("cue99"));
  assert.ok(parts.every((p) => p.text.length <= 12_500));
  assert.equal(parts.map((p) => p.text).join(" ").match(/cue\d+/g)?.length, 100, "nothing skipped");
});

test("plain text splits on paragraphs; a single huge paragraph still splits", () => {
  const p = splitText(`${"a ".repeat(4000)}\n\n${"b ".repeat(4000)}\n\nend`, 10_000);
  assert.equal(p.length, 2);
  assert.ok(p[1].text.endsWith("end"));
  assert.ok(splitText("x".repeat(25_000), 10_000).length >= 3);
});

test("pages group into parts that say which pages they hold, and blank scans still make parts", () => {
  const pages = Array.from({ length: 30 }, (_, i) => (i < 25 ? `page ${i + 1} ${"x".repeat(500)}` : ""));
  const parts = splitPages(pages, 12_000, 10);
  assert.equal(parts[0].pageFrom, 1);
  assert.equal(parts[0].pageTo, 10);
  assert.equal(parts.at(-1)!.pageTo, 30);
  assert.equal(parts.length, 3);
});

test("a long source is read to the end, part by part, and the digest covers all of it", async () => {
  sent = [];
  reply = replyAll;
  saveItem(lecture("M-LECTURE1", 120));
  setStudying("M-LECTURE1", true);
  assert.equal(nextToRead(listItems())?.id, "M-LECTURE1");
  let steps = 0;
  while (readItem("M-LECTURE1")!.learning!.state !== "ready" && steps++ < 30) await readStep("M-LECTURE1");
  const d = readItem("M-LECTURE1")!.learning!;
  assert.ok(steps >= 3, `took ${steps} steps`);
  assert.equal(d.depth, 2);
  assert.equal(d.reading, undefined);
  assert.equal(d.sections!.length, steps);
  assert.ok(sent.some((s) => s.messages[1].content.includes("cue 119")), "the last minute was read");
  assert.equal(d.concepts.length, d.sections!.length, "a concept from every part");
  assert.equal(d.concepts[0].example, "Example 1");
  assert.equal(d.questions[0].kind, "explain");
  assert.equal(d.thesis, "The whole thing, in a line.");
  assert.equal(nextToRead(listItems()), undefined);
});

test("a failed part retries from where it stopped; the parts already read aren't lost", async () => {
  saveItem(lecture("M-RESUME1", 120));
  setStudying("M-RESUME1", true);
  reply = replyAll;
  await readStep("M-RESUME1");
  await readStep("M-RESUME1");
  assert.equal(readItem("M-RESUME1")!.learning!.reading!.next, 2);
  reply = () => null;
  await readStep("M-RESUME1");
  const r = readItem("M-RESUME1")!.learning!;
  assert.equal(r.reading!.next, 2);
  assert.equal(r.reading!.sections.length, 2);
  assert.match(r.error ?? "", /no model/i);
  assert.equal(nextToRead(listItems())?.id === "M-RESUME1", false, "it waits before trying again");
  reply = replyAll;
  const it = readItem("M-RESUME1")!;
  it.learning!.reading!.nextAt = undefined;
  saveItem(it);
  sent = [];
  await readStep("M-RESUME1");
  assert.match(sent[0].messages[1].content, /Part 3 of/);
  while (readItem("M-RESUME1")!.learning!.state !== "ready") await readStep("M-RESUME1");
});

test("an old shallow read gets redone in the background: reviews keep working and progress is kept", async () => {
  const old = { state: "ready" as const, concepts: [{ term: "Idea 1", explanation: "Short." }, { term: "Renamed away", explanation: "He has reviewed this one." }, { term: "Never reviewed", explanation: "Nobody cares." }], keyPoints: [], questions: [] };
  saveItem({ ...lecture("M-OLDREAD1", 60), learning: old });
  fs.mkdirSync(path.join(process.env.DATA_DIR!, "learning"), { recursive: true });
  const rec = { due: "2030-01-01T00:00:00.000Z", interval: 30, ease: 2.5, reps: 4, lapses: 0 };
  fs.writeFileSync(path.join(process.env.DATA_DIR!, "learning", "review.json"), JSON.stringify({ [cardKey("M-OLDREAD1", "Idea 1")]: rec, [cardKey("M-OLDREAD1", "Renamed away")]: rec }));
  reply = replyAll;
  assert.equal(nextToRead(listItems())?.id, "M-OLDREAD1");
  await readStep("M-OLDREAD1");
  assert.equal(readItem("M-OLDREAD1")!.learning!.state, "ready", "still reviewable mid-read");
  assert.ok(buildReviewQueue(listItems()).some((c) => c.term === "Renamed away"));
  let steps = 0;
  while (readItem("M-OLDREAD1")!.learning!.depth !== 2 && steps++ < 30) await readStep("M-OLDREAD1");
  const d = readItem("M-OLDREAD1")!.learning!;
  const idea = d.concepts.find((c) => c.term === "Idea 1")!;
  assert.match(idea.explanation, /at length/, "the deeper explanation wins");
  assert.ok(d.concepts.some((c) => c.term === "Renamed away"), "anything he has reviewed stays");
  assert.ok(!d.concepts.some((c) => c.term === "Never reviewed"));
  assert.equal(buildReviewQueue(listItems()).find((c) => c.itemId === "M-OLDREAD1" && c.term === "Idea 1")!.reps, 4);
  assert.ok(readReviewRecords()[cardKey("M-OLDREAD1", "Idea 1")]);
});

test("sources not in Study are never read", () => {
  saveItem({ ...lecture("M-NOTSTUDY", 60) });
  assert.equal(nextToRead(listItems().filter((i) => i.id === "M-NOTSTUDY")), undefined);
});

test("a real PDF comes apart into its pages", async () => {
  const pdf = (texts: string[]) => {
    const objs: string[] = ["<< /Type /Catalog /Pages 2 0 R >>", `<< /Type /Pages /Kids [${texts.map((_, i) => `${3 + i * 2} 0 R`).join(" ")}] /Count ${texts.length} >>`];
    texts.forEach((t, i) => {
      const stream = `BT /F1 12 Tf 20 100 Td (${t}) Tj ET`;
      objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents ${4 + i * 2} 0 R /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> >>`);
      objs.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    });
    let out = "%PDF-1.4\n";
    const offs: number[] = [];
    objs.forEach((o, i) => {
      offs.push(out.length);
      out += `${i + 1} 0 obj\n${o}\nendobj\n`;
    });
    const xref = out.length;
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}trailer << /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    return Buffer.from(out, "latin1");
  };
  const pages = await pdfPages(pdf(["first page", "second page", "third page"]));
  assert.equal(pages.length, 3);
  assert.match(pages[2], /third page/);
});
