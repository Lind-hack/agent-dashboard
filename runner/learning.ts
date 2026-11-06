import fs from "node:fs";
import path from "node:path";
import { extractText } from "unpdf";
import { groqModel } from "../lib/config";
import { geminiJSON, geminiReady, type InlineImage } from "../lib/gemini";
import { emptyDigest, inStudy, mergeRead, migrateReviewKeys, normalizePart, readReviewRecords, splitPages, splitText, splitTimed, type LearningDigest, type ReadPart } from "../lib/learning";
import { listItems, mediaDir, mirrorItem, readItem, saveItem, type LibraryItem } from "../lib/library";
import { formatTimestamp } from "../lib/video-transcript";
import { askJSON } from "./dump";
import { still } from "./library";

// The Learning pass (v6, Lind: "way more detailed"): a source in Study is read start to finish, one part
// at a time. A video's part is its transcript and frames from that stretch, a PDF's part is its pages,
// figures included. The parts so far are saved after each step, so a used-up quota only makes it wait,
// and it picks up where it stopped. Sources read shallowly before v6 are redone in the background,
// one at a time, and stay reviewable meanwhile. It runs beside the capture automation, so a slow model
// never holds up the Library.

const log = (...a: unknown[]) => console.log(new Date().toISOString(), "learning:", ...a);
const PART_CHARS = 12_000;
const PDF_PAGES = 12;
const PDF_INLINE_MAX = 18 * 1024 * 1024; // what Gemini takes inline
const FRAMES = 6;
const WAIT_MAX = 6 * 3600_000;
const GIVE_UP = 6; // a first read shows as failed after this many tries at one part

let busy = false;
let migrated = false;

// What to read next: anything mid-read or waiting first, then old shallow reads, one at a time.
export function nextToRead(items: LibraryItem[], now = Date.now()): LibraryItem | undefined {
  const free = (l: LearningDigest) => !l.reading?.nextAt || Date.parse(l.reading.nextAt) <= now;
  const study = items.filter((i) => i.learning && inStudy(i));
  // A source waiting on a retry only holds up itself.
  const moving = study.find((i) => i.learning!.reading && i.learning!.state !== "failed" && free(i.learning!));
  if (moving) return moving;
  const queued = study.find((i) => i.learning!.state === "queued" && (!i.learning!.nextAt || Date.parse(i.learning!.nextAt) <= now));
  if (queued) return queued;
  return study.find((i) => i.learning!.state === "ready" && i.learning!.depth !== 2 && !i.learning!.reading);
}

export function learningTick() {
  if (busy) return;
  const items = listItems();
  if (!migrated) {
    migrateReviewKeys(items);
    migrated = true;
  }
  const next = nextToRead(items);
  if (!next) return;
  busy = true;
  void readStep(next.id)
    .catch((e) => log(next.id, e instanceof Error ? e.message : e))
    .finally(() => (busy = false));
}

// ---- the parts of a source -----------------------------------------------------------------------

export async function pdfPages(data: Buffer): Promise<string[]> {
  return (await extractText(new Uint8Array(data))).text;
}

const mediaPath = (it: LibraryItem) => path.join(mediaDir(), path.basename(it.media?.file ?? ""));
const hasMedia = (it: LibraryItem) => !!it.media?.file && fs.existsSync(mediaPath(it));
const isPdf = (it: LibraryItem) => it.media?.mime === "application/pdf" && hasMedia(it);

// The whole text of a document saved as a text file: the capture only keeps the start of it.
function fullText(it: LibraryItem): string {
  const fromFile = it.kind === "file" && hasMedia(it) && /\.(txt|md|csv|json|log|ya?ml)$/i.test(it.media?.name ?? "") ? fs.readFileSync(mediaPath(it), "utf8") : "";
  return [it.note, fromFile || it.text].filter(Boolean).join("\n\n");
}

async function partsOf(it: LibraryItem): Promise<ReadPart[]> {
  if (it.transcript?.segments.length) return splitTimed(it.transcript, PART_CHARS);
  if (isPdf(it)) return splitPages(await pdfPages(fs.readFileSync(mediaPath(it))), PART_CHARS, PDF_PAGES);
  // A silent screen recording: no words, so the frames carry it, ten minutes at a time.
  if (it.kind === "video" && hasMedia(it) && !it.text.trim() && it.media?.duration) {
    return Array.from({ length: Math.ceil(it.media.duration / 600) }, (_, i) => ({ text: "(no speech in this part: read it from the frames)", start: i * 600, end: Math.min(it.media!.duration!, (i + 1) * 600) }));
  }
  return splitText(fullText(it), PART_CHARS);
}

// ---- reading one part ----------------------------------------------------------------------------

const SYSTEM = `You write detailed study notes for Lind, a CS student, on one part of something he is learning. He will be tested on every idea in it, weeks and months from now, so these notes have to teach, not summarise.
Return JSON: {"title": string, "summary": string, "concepts": [{"term": string, "explanation": string, "example": string|null, "at": number|null, "page": number|null}], "key_points": [string], "questions": [{"q": string, "a": string, "at": number|null, "page": number|null, "kind": "recall"|"explain"|"apply"|"code"|"interview"}]}
- title: what this part is about, ≤ 10 words. summary: 3–6 sentences on what it teaches and how it builds.
- concepts: EVERY idea, term, method, formula and named thing taught here, not only the main ones, usually 5–12. term ≤ 8 words. explanation: 3–6 sentences: what it is, how it works, why it matters, and how it connects to the rest. example: a concrete example from the material, or null if it gives none.
- key_points: specific takeaways: names, numbers, steps, conditions, warnings.
- questions: 5–10, hardest thinking first, mixed: "recall" (state it), "explain" (why or how it works), "apply" (a new situation to solve), "code" (implementation or algorithm detail), "interview" (what an interviewer or examiner would ask). Each answer is what a full-marks answer contains, in 2–6 sentences.
- at: the second in the video where it's discussed, from the [mm:ss] marks; page: the PDF page. null when not known.
- What's on screen or on the page counts as much as what's said: copy code, formulas and definitions exactly, and describe diagrams, tables and figures in words.
- Never invent anything that isn't in the material. Write in English unless the material is clearly Albanian.`;

const FINAL_SYSTEM = `You have read a whole source for Lind, part by part. Pull it together. Return JSON: {"thesis": string, "key_points": [string], "language": string}.
- thesis: the main claim or purpose of the whole source, 1–3 sentences.
- key_points: the 5–12 most important takeaways across all parts. Never invent anything. Write in English unless the material is clearly Albanian.`;

async function frames(it: LibraryItem, part: ReadPart): Promise<InlineImage[]> {
  if (it.kind !== "video" || !hasMedia(it) || part.start === undefined) return [];
  const end = part.end ?? part.start;
  const times = Array.from({ length: FRAMES }, (_, i) => part.start! + ((end - part.start!) * (i + 0.5)) / FRAMES);
  const shots = await Promise.all(times.map((t) => still(mediaPath(it), t, 1024).catch(() => null)));
  return shots.flatMap((data) => (data ? [{ mime: "image/jpeg", data }] : []));
}

async function readPart(it: LibraryItem, part: ReadPart, n: number, total: number) {
  const where = part.pageFrom ? ` (pages ${part.pageFrom}–${part.pageTo})` : part.start !== undefined ? ` (${formatTimestamp(part.start)}–${formatTimestamp(part.end ?? part.start)})` : "";
  const user = [`Title: ${it.title || it.kind}`, `Source: ${it.kind}${it.url ? ` — ${it.url}` : ""}`, ...(it.note ? [`Lind's note: ${it.note}`] : []), "", `Part ${n} of ${total}${where}:`, part.text].join("\n");
  // Gemini sees the frames, or the PDF's pages with their figures; everything else is text.
  if (geminiReady()) {
    const images = isPdf(it) && (it.media?.bytes ?? 0) < PDF_INLINE_MAX ? [{ mime: "application/pdf", data: fs.readFileSync(mediaPath(it)) }] : await frames(it, part);
    if (images.length) {
      const prompt = `${SYSTEM}\n\n${isPdf(it) ? `Read ONLY pages ${part.pageFrom}–${part.pageTo} of the attached PDF, figures and tables included.` : "The images are frames from this stretch of the video, in order."}\n\n${user}`;
      const seen = await geminiJSON(prompt, images).catch((e: unknown) => log(it.id, "vision", e instanceof Error ? e.message : e));
      if (seen && normalizePart(seen, it.id).concepts.length) return normalizePart(seen, it.id);
    }
  }
  return normalizePart(await askJSON(SYSTEM, user, 5000), it.id);
}

// One step: read the next part, or, when all are read, put the digest together.
export async function readStep(id: string): Promise<void> {
  const it = readItem(id);
  if (!it?.learning) return;
  const l = it.learning;
  try {
    const parts = await partsOf(it);
    if (!parts.length || !parts.some((p) => p.text.trim().length >= 200 || p.pageFrom || p.start !== undefined)) throw new Error("Not enough text to study yet — a transcript or document is needed.");
    const reading = l.reading ?? { next: 0, total: parts.length, sections: [], concepts: [], questions: [], keyPoints: [], tries: 0 };
    const first = l.state !== "ready";
    const index = Math.min(reading.next, parts.length - 1);
    const done = await readPart(it, parts[index], index + 1, parts.length);
    if (!done.concepts.length && !done.questions.length) throw new Error("The analyser returned nothing usable — will retry.");
    const fresh = readItem(id);
    if (!fresh?.learning) return;
    const next = { ...reading, next: index + 1, total: parts.length, tries: 0, nextAt: undefined, sections: [...reading.sections, { ...done.section, ...sectionPlace(parts[index]) }], concepts: [...reading.concepts, ...done.concepts], questions: [...reading.questions, ...done.questions], keyPoints: [...reading.keyPoints, ...done.keyPoints] };
    if (next.next < parts.length) {
      fresh.learning = { ...fresh.learning, state: first ? "analyzing" : "ready", reading: next, error: undefined };
      saveItem(fresh);
      log("read", id, `${next.next}/${parts.length}`);
      return;
    }
    const final = await askJSON<{ thesis?: string; key_points?: string[]; language?: string }>(FINAL_SYSTEM, `Title: ${it.title}\n\nThe whole source, part by part:\n${next.sections.map((s) => `- ${s.title}: ${s.summary}`).join("\n").slice(0, 16_000)}`, 1500).catch(() => null);
    fresh.learning = mergeRead(fresh.learning, next, final ?? {}, groqModel(), readReviewRecords(), id);
    mirrorItem(fresh);
    saveItem(fresh);
    log("ready", id, `${fresh.learning.concepts.length} concepts, ${fresh.learning.questions.length} questions`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const fresh = readItem(id);
    if (!fresh?.learning) return;
    const was = fresh.learning;
    const reading = was.reading ?? { next: 0, total: 0, sections: [], concepts: [], questions: [], keyPoints: [], tries: 0 };
    const tries = reading.tries + 1;
    const nextAt = new Date(Date.now() + Math.min(WAIT_MAX, 60_000 * 4 ** tries)).toISOString();
    const dead = was.state !== "ready" && tries >= GIVE_UP;
    fresh.learning = { ...emptyDigest(), ...was, ...(was.state === "ready" ? {} : { state: dead ? ("failed" as const) : ("analyzing" as const) }), reading: { ...reading, tries, nextAt }, error: msg.slice(0, 300) };
    saveItem(fresh);
    log("failed", id, msg);
  }
}

const sectionPlace = (p: ReadPart) => ({ ...(p.start !== undefined ? { at: p.start, end: p.end } : {}), ...(p.pageFrom ? { page: p.pageFrom, pageTo: p.pageTo } : {}) });
