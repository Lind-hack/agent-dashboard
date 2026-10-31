import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "dump-test-"));
process.env.MEMORY_VAULT_DIR = path.join(process.env.DATA_DIR, "no-vault");

const { coverSegments, isDump, outline, segmentText, toBlocks, toWindows } = await import("../lib/dump");
const { createItem, deleteItem, listItems, slimItem } = await import("../lib/library");

const doc = [
  "# Export",
  "Intro line.",
  "# SECTION 1 — People",
  "## Dad",
  "Dad works in Pristina.",
  "## Kosovo tech scene",
  "Meetups every month.",
  "# SECTION 2 — Logs",
  "## 2026-09-15",
  "```",
  "# not a heading inside a fence",
  "```",
  ...Array.from({ length: 40 }, (_, i) => `Paragraph ${i} ${"x".repeat(300)}\n`),
].join("\n");

test("blocks follow headings, keep their path, ignore fenced #, and split long sections", () => {
  const b = toBlocks(doc, 2000);
  assert.deepEqual(b[0].path, ["Export"]);
  const dad = b.find((x) => x.text.includes("Dad works"))!;
  assert.deepEqual(dad.path, ["SECTION 1 — People", "Dad"]);
  assert.ok(b.every((x) => x.text.length <= 2000));
  assert.ok(!b.some((x) => x.path.includes("not a heading inside a fence")));
  // Nothing lost: every non-blank line is in some block.
  const all = b.map((x) => x.text).join("\n");
  for (const line of doc.split("\n")) if (line.trim()) assert.ok(all.includes(line.trim()), line.slice(0, 40));
});

test("windows are consecutive, cover every block and stay under the cap", () => {
  const b = toBlocks(doc, 2000);
  const w = toWindows(b, 5000);
  assert.equal(w[0][0], 0);
  assert.equal(w[w.length - 1][1], b.length);
  for (let i = 1; i < w.length; i++) assert.equal(w[i][0], w[i - 1][1]);
  for (const [a, z] of w) assert.ok(z - a === 1 || b.slice(a, z).reduce((n, x) => n + x.text.length + 2, 0) <= 5000);
});

test("segments are repaired to cover the window exactly once", () => {
  const segs = coverSegments(
    [
      { from: "b7", to: "b9", title: "Later", continues_previous: true },
      { from: "b3", to: "b5", title: "First", continues_previous: true, tags: ["Dad", 4] },
      { from: "b4", to: "b4", title: "Swallowed" },
      { from: "b99", title: "Clamped" },
    ],
    [3, 12],
  );
  assert.deepEqual(
    segs.map((s) => [s.from, s.to, s.title]),
    [
      [3, 5, "First"],
      [6, 9, "Later"],
      [10, 11, "Clamped"],
    ],
  );
  assert.equal(segs[0].continues, true);
  assert.equal(segs[1].continues, false);
  assert.deepEqual(segs[0].tags, ["dad"]);
  assert.deepEqual(
    coverSegments(null, [0, 4]).map((s) => [s.from, s.to]),
    [[0, 3]],
  );
});

test("segment text is its blocks verbatim; dumps vs notes; outline", () => {
  const b = toBlocks(doc, 2000);
  assert.equal(segmentText(b, { from: 0, to: 1 }), `${b[0].text}\n\n${b[1].text}`);
  assert.ok(isDump(doc));
  assert.ok(!isDump("a short note"));
  assert.ok(isDump(`# A\n${"y".repeat(1200)}\n# B\n${"y".repeat(1200)}\n# C\n${"y".repeat(1200)}`));
  assert.match(outline(doc), /^- Export\n- SECTION 1 — People\n {2}- Dad/);
});

test("deleting a dump deletes its parts; the list sends long texts cut short", () => {
  const dump = createItem({ kind: "text", text: doc, split: { state: "done", next: 1, total: 1, parts: [] } });
  const part = createItem({ kind: "text", text: "part", parent: dump.id, status: "ready" });
  const other = createItem({ kind: "text", text: "other" });
  assert.ok(slimItem(dump).text.length < doc.length);
  assert.equal(slimItem(other).text, "other");
  deleteItem(dump.id);
  const left = listItems().map((i) => i.id);
  assert.ok(!left.includes(dump.id) && !left.includes(part.id) && left.includes(other.id));
});
