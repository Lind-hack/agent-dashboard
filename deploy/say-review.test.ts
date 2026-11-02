import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "say-review-test-"));
process.env.MEMORY_VAULT_DIR = path.join(process.env.DATA_DIR, "no-vault");
process.env.DASHBOARD_TZ = "UTC";

const { keepSegments } = await import("../lib/groq");
const { cleanItems, draftItems, overlap } = await import("../lib/say");

const TODAY = "2026-11-04";

test("Whisper's silence phrases and unsure non-speech segments are dropped", () => {
  const text = keepSegments(
    [
      { text: " Finish the 383 pitch today", no_speech_prob: 0.01, avg_logprob: -0.2 },
      { text: " Thank you for watching.", no_speech_prob: 0.2, avg_logprob: -0.3 },
      { text: " and call the bank tomorrow", no_speech_prob: 0.05, avg_logprob: -0.3 },
      { text: " buy milk", no_speech_prob: 0.9, avg_logprob: -1.0 },
      { text: " zzz zzz zzz", no_speech_prob: 0.1, avg_logprob: -1.5 },
    ],
    "ignored when there are segments",
  );
  assert.equal(text, "Finish the 383 pitch today and call the bank tomorrow");
  assert.equal(keepSegments(undefined, "  plain  "), "plain");
});

test("overlap is loose about word endings and ignores filler", () => {
  assert.equal(overlap("Call the bank", "i need to calling bank tomorrow"), 1);
  assert.equal(overlap("Email Arben about the invoice", "send arben an email"), 2 / 3);
  assert.equal(overlap("the a to", "anything"), 0);
});

test("drafts: invented items dropped, repeats of open tasks flagged, in-batch duplicates merged, vague flagged", () => {
  const said = "finish the 383 pitch today, call the bank tomorrow, and finish the pitch for 383 again, oh and stuff";
  const raw = [
    { kind: "task", title: "Finish 383 pitch", day: TODAY, quote: "finish the 383 pitch today", dupOf: null },
    { kind: "task", title: "Call the bank", day: "2026-11-05", quote: "call the bank tomorrow", dupOf: null },
    { kind: "task", title: "Finish pitch 383", day: TODAY, quote: "finish the pitch for 383 again", dupOf: null },
    { kind: "task", title: "Book a dentist appointment", day: TODAY, quote: "book a dentist appointment", dupOf: null },
    { kind: "task", title: "Stuff", day: TODAY, quote: "oh and stuff", dupOf: null },
  ];
  const items = cleanItems(raw, TODAY, new Set());
  const drafts = draftItems(raw, items, said, [{ id: "t1", title: "Call bank about card" }]);
  assert.deepEqual(
    drafts.map((d) => d.item.title),
    ["Finish 383 pitch", "Call the bank", "Stuff"],
    "the dentist was never said; the second pitch is the same task",
  );
  assert.equal(drafts[1].dupOf?.id, "t1");
  assert.equal(drafts[0].dupOf, undefined);
  assert.equal(drafts[2].vague, true);
});

test("the model naming a repeat is trusted when the id is real", () => {
  const raw = [{ kind: "task", title: "Pay rent", day: TODAY, quote: "pay rent", dupOf: "t9" }];
  const d = draftItems(raw, cleanItems(raw, TODAY, new Set()), "pay rent", [{ id: "t9", title: "Rent — November" }]);
  assert.equal(d[0].dupOf?.title, "Rent — November");
  const fake = [{ kind: "task", title: "Pay rent", day: TODAY, quote: "pay rent", dupOf: "nope" }];
  assert.equal(draftItems(fake, cleanItems(fake, TODAY, new Set()), "pay rent", [])[0].dupOf, undefined);
});
