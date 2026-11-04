import assert from "node:assert/strict";
import { test } from "node:test";

const { formatTimestamp, parseCues, parsePlainTranscript, parseTimestamp, parseTranscript, transcriptText, transcriptWindows } = await import("../lib/video-transcript");

const srt = `\uFEFF1\r
00:00:01,000 --> 00:00:04,500\r
Hello <i>there</i>,\r
this is line two.\r
\r
2\r
00:00:05,000 --> 00:00:08,000\r
Second cue &amp; more.\r
`;

const vtt = `WEBVTT

NOTE this header is ignored

cue-1
00:01.000 --> 00:03.250 align:start position:10%
Hello from WebVTT.

00:03.250 --> 00:05.000
<v Lind>And a second cue.</v>
`;

test("SRT cues keep their timing and multi-line text", () => {
  const segs = parseCues(srt);
  assert.deepEqual(segs.map((s) => [s.start, s.end, s.text]), [
    [1, 4.5, "Hello there, this is line two."],
    [5, 8, "Second cue & more."],
  ]);
});

test("WebVTT cues parse minutes-only timestamps and ignore headers and cue settings", () => {
  const segs = parseCues(vtt);
  assert.deepEqual(segs.map((s) => [s.start, s.end, s.text]), [
    [1, 3.25, "Hello from WebVTT."],
    [3.25, 5, "And a second cue."],
  ]);
});

test("plain transcripts split on paragraphs and long sentences", () => {
  const segs = parsePlainTranscript("First paragraph.\n\nSecond paragraph.");
  assert.deepEqual(segs.map((s) => s.text), ["First paragraph.", "Second paragraph."]);
  assert.ok(segs.every((s) => s.start === 0 && s.end === 0));
  const long = parsePlainTranscript("x".repeat(1800));
  assert.equal(long.length, 3);
  assert.ok(long.every((s) => s.text.length <= 700));
});

test("parseTranscript identifies formats and rejects unsupported or empty input", () => {
  assert.equal(parseTranscript("talk.srt", srt).format, "srt");
  assert.equal(parseTranscript("CAPTIONS.VTT", vtt).format, "vtt");
  assert.equal(parseTranscript("transcript.txt", "one\n\ntwo").format, "text");
  assert.throws(() => parseTranscript("talk.ass", "[Script Info]"), /Unsupported transcript format/);
  assert.throws(() => parseTranscript("talk.srt", "not a subtitle"), /no timed cues/);
  assert.throws(() => parseTranscript("notes.txt", "  "), /empty/);
});

test("timestamps format consistently and timed text carries its cue time", () => {
  assert.equal(parseTimestamp("1:02:03.500"), 3723.5);
  assert.equal(formatTimestamp(0), "00:00");
  assert.equal(formatTimestamp(62.9), "01:02");
  assert.equal(formatTimestamp(3661), "1:01:01");
  const t = parseTranscript("talk.srt", srt);
  assert.match(transcriptText(t), /^\[00:01\] Hello there/);
});

test("graph windows merge nearby cues and keep them inside the size and time caps", () => {
  const t = parseTranscript("talk.srt", srt);
  const windows = transcriptWindows(t, 45, 80);
  assert.ok(windows.length >= 1);
  assert.equal(windows[0].start, 1);
  assert.ok(windows.every((w) => w.text.length <= 80 && w.end >= w.start));
});
