// Transcripts for video memories: parse SRT / WebVTT / plain text, keep their timing, and turn
// them into the short timestamped windows the Visual cortex draws as nodes under the video.
// Pure functions only — the runner, the graph and the browser all import this file.

export type TranscriptFormat = "srt" | "vtt" | "text";
export type TranscriptSource = "embedded" | "file" | "whisper";
export type TranscriptSegment = { start: number; end: number; text: string };
export type Transcript = {
  source: TranscriptSource;
  format: TranscriptFormat;
  language?: string;
  segments: TranscriptSegment[];
};

export const MAX_TRANSCRIPT_SEGMENTS = 4000;
const MAX_SEGMENT_CHARS = 2000;
const MAX_WINDOW_CHARS = 700;
const MAX_WINDOWS = 500;

const decode = (s: string) =>
  s
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?…])/g, "$1")
    .trim();

const seconds = (h: string | undefined, m: string, s: string, ms?: string) =>
  Number(h ?? 0) * 3600 + Number(m) * 60 + Number(s) + Number((ms ?? "0").padEnd(3, "0").slice(0, 3)) / 1000;

export function parseTimestamp(value: string): number | null {
  const m = value.trim().match(/^(?:(\d{1,3}):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?$/);
  if (!m) return null;
  return seconds(m[1], m[2], m[3], m[4]);
}

const CUE = /^\s*((?:\d{1,3}:)?\d{1,2}:\d{1,2}[.,]\d{1,3})\s*-->\s*((?:\d{1,3}:)?\d{1,2}:\d{1,2}[.,]\d{1,3})(?:\s+.*)?$/;

// SRT and WebVTT share the same cue timing line; everything around it (indexes, headers, NOTE
// blocks, cue settings) is ignored.
export function parseCues(input: string): TranscriptSegment[] {
  const lines = input.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n");
  const out: TranscriptSegment[] = [];
  let i = 0;
  while (i < lines.length) {
    const cue = lines[i].trim().match(CUE);
    if (!cue) {
      i++;
      continue;
    }
    const start = parseTimestamp(cue[1]);
    const end = parseTimestamp(cue[2]);
    i++;
    const body: string[] = [];
    while (i < lines.length && lines[i].trim() !== "") {
      const text = decode(lines[i]);
      if (text) body.push(text);
      i++;
    }
    const text = body.join(" ").trim();
    if (text && start !== null && end !== null) out.push({ start, end: Math.max(end, start), text: text.slice(0, MAX_SEGMENT_CHARS) });
    if (out.length >= MAX_TRANSCRIPT_SEGMENTS) break;
  }
  return out;
}

// A transcript without timing still has structure: paragraphs, or sentences in long paragraphs.
export function parsePlainTranscript(input: string): TranscriptSegment[] {
  const text = input.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trim();
  if (!text) return [];
  const out: TranscriptSegment[] = [];
  const push = (s: string) => {
    const clean = decode(s);
    if (clean) out.push({ start: 0, end: 0, text: clean.slice(0, MAX_SEGMENT_CHARS) });
  };
  for (const para of text.split(/\n\s*\n/)) {
    const p = decode(para);
    if (!p) continue;
    if (p.length <= MAX_WINDOW_CHARS) {
      push(p);
      continue;
    }
    let buf = "";
    for (const sentence of p.match(/[^.!?…]+[.!?…]*/g) ?? [p]) {
      if (buf && buf.length + sentence.length > MAX_WINDOW_CHARS) {
        push(buf);
        buf = "";
      }
      if (sentence.length > MAX_WINDOW_CHARS) {
        for (let i = 0; i < sentence.length; i += MAX_WINDOW_CHARS) push(sentence.slice(i, i + MAX_WINDOW_CHARS));
        continue;
      }
      buf += sentence;
    }
    if (buf.trim()) push(buf);
    if (out.length >= MAX_TRANSCRIPT_SEGMENTS) break;
  }
  return out.slice(0, MAX_TRANSCRIPT_SEGMENTS);
}

export const transcriptExt = (name: string): string => name.match(/\.([a-z0-9]{1,5})$/i)?.[1]?.toLowerCase() ?? "";

export const isSubtitleFile = (name: string): boolean => /\.(srt|vtt)$/i.test(name);
export const isPlainTranscriptName = (name: string): boolean => /\.(txt|text|md|markdown)$/i.test(name);

// A .txt next to a video is probably its transcript only when the name says so.
export const shouldPairTranscript = (name: string): boolean => isSubtitleFile(name) || (isPlainTranscriptName(name) && /transcript|caption|subtitle|spoken|words/i.test(name));

const UNSUPPORTED = new Set(["ass", "ssa", "sub", "sbv", "ttml", "dfxp"]);

export function parseTranscript(name: string, input: string, source: TranscriptSource = "file"): Transcript {
  const ext = transcriptExt(name);
  if (ext === "srt" || ext === "vtt") {
    const segments = parseCues(input);
    if (!segments.length) throw new Error(`The .${ext} file has no timed cues — is it a valid transcript?`);
    return { source, format: ext, segments };
  }
  if (["txt", "text", "md", "markdown"].includes(ext)) {
    const segments = parsePlainTranscript(input);
    if (!segments.length) throw new Error("The transcript is empty.");
    return { source, format: "text", segments };
  }
  if (UNSUPPORTED.has(ext)) throw new Error(`Unsupported transcript format ".${ext}" — upload .srt, .vtt or .txt.`);
  throw new Error(`That isn't a transcript this memory can read${ext ? ` (.${ext})` : ""} — upload .srt, .vtt or .txt.`);
}

export function formatTimestamp(sec: number): string {
  const total = Math.max(0, Math.floor(sec));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export const hasTiming = (s: TranscriptSegment): boolean => s.start > 0 || s.end > 0;

export function transcriptText(t: Transcript, limit = Infinity): string {
  return t.segments
    .map((s) => (hasTiming(s) ? `[${formatTimestamp(s.start)}] ${s.text}` : s.text))
    .join("\n")
    .slice(0, limit);
}

// The graph's transcript nodes: consecutive cues merged into ~45-second, ~700-character windows.
export function transcriptWindows(t: Transcript, maxSeconds = 45, maxChars = MAX_WINDOW_CHARS): TranscriptSegment[] {
  const out: TranscriptSegment[] = [];
  let cur: TranscriptSegment | null = null;
  for (const s of t.segments) {
    if (!cur) {
      cur = { ...s };
      continue;
    }
    const gap = s.start - cur.end;
    const timed = hasTiming(cur) || hasTiming(s);
    const fits = cur.text.length + s.text.length + 1 <= maxChars && (!timed || (s.start - cur.start <= maxSeconds && gap <= 8));
    if (fits) {
      cur.end = Math.max(cur.end, s.end);
      cur.text = `${cur.text} ${s.text}`.trim();
    } else {
      out.push(cur);
      cur = { ...s };
    }
    if (out.length >= MAX_WINDOWS) break;
  }
  if (cur && out.length < MAX_WINDOWS) out.push(cur);
  return out;
}
