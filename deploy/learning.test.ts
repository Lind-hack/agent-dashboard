import assert from "node:assert/strict";
import { test } from "node:test";

const { videoLink, isVideoUrl } = await import("../lib/video-links");
const { nextReview, normalizeDigest } = await import("../lib/learning");

test("video links resolve to a playable embed for YouTube, Vimeo and direct files", () => {
  assert.deepEqual(videoLink("https://www.youtube.com/watch?v=abc123&t=10s"), {
    provider: "youtube",
    id: "abc123",
    embed: "https://www.youtube-nocookie.com/embed/abc123",
    watch: "https://www.youtube.com/watch?v=abc123&t=10s",
  });
  assert.equal(videoLink("https://youtu.be/abc123")?.id, "abc123");
  assert.equal(videoLink("https://www.youtube.com/shorts/abc123")?.id, "abc123");
  assert.equal(videoLink("https://vimeo.com/123456")?.embed, "https://player.vimeo.com/video/123456");
  assert.equal(videoLink("https://example.com/talk.mp4?dl=0")?.provider, "file");
});

test("video links reject non-video pages, malformed URLs and non-http schemes", () => {
  assert.equal(videoLink("https://www.youtube.com/@someone"), null);
  assert.equal(videoLink("https://example.com/article"), null);
  assert.equal(videoLink("not a url"), null);
  assert.equal(videoLink("ftp://example.com/talk.mp4"), null);
  assert.equal(videoLink("javascript:alert(1)"), null);
  assert.equal(isVideoUrl("https://vimeo.com/123456"), true);
  assert.equal(isVideoUrl(""), false);
});

test("a digest keeps only usable concepts and questions, de-duplicated and capped", () => {
  const d = normalizeDigest({
    thesis: "  Attention is a soft lookup.  ",
    concepts: [
      { term: "Query", explanation: "What this token is looking for.", at: 12.4 },
      { term: "query", explanation: "duplicate", at: 30 },
      { term: "", explanation: "no term" },
      { term: "Key", explanation: "" },
      { term: "Value", explanation: "What is passed along.", at: -3 },
    ],
    key_points: [" q·k dot product ", "", 42],
    questions: [
      { q: "Why scale by √d?", a: "To keep the softmax stable.", kind: "code", at: 90 },
      { question: "What is attention?", answer: "A weighted sum of values." },
      { q: "No answer", a: "" },
    ],
  });
  assert.equal(d.thesis, "Attention is a soft lookup.");
  assert.deepEqual(d.concepts.map((c) => c.term), ["Query", "Value"]);
  assert.equal(d.concepts[0].at, 12.4);
  assert.equal(d.concepts[1].at, undefined);
  assert.deepEqual(d.keyPoints, ["q·k dot product"]);
  assert.deepEqual(d.questions.map((q) => [q.q, q.kind]), [
    ["Why scale by √d?", "code"],
    ["What is attention?", "recall"],
  ]);
});

test("a digest survives junk without throwing", () => {
  assert.deepEqual(normalizeDigest(null), { thesis: undefined, concepts: [], keyPoints: [], questions: [], language: undefined });
  assert.deepEqual(normalizeDigest({ concepts: "nope", questions: {} }).concepts, []);
});

test("review scheduling moves a new card out and brings a failed one back quickly", () => {
  const now = new Date("2026-01-01T12:00:00Z");
  const first = nextReview(null, "good", now);
  assert.equal(first.reps, 1);
  assert.equal(first.interval, 1);
  assert.equal(first.due, "2026-01-02T12:00:00.000Z");

  const again = nextReview(first, "again", now);
  assert.equal(again.reps, 0);
  assert.equal(again.lapses, 1);
  assert.ok(again.interval < 1 / 24);
  assert.ok(Date.parse(again.due) - now.getTime() < 15 * 60_000);

  const easy = nextReview(null, "easy", now);
  assert.ok(easy.interval >= 3);
  assert.ok(easy.ease > 2.5);
});
