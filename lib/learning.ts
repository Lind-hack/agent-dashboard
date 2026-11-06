import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./config";
import { askJSON } from "./ask";
import { readItem, saveItem, type LibraryItem } from "./library";
import { formatTimestamp, transcriptText, type Transcript } from "./video-transcript";
import { isVideoUrl } from "./video-links";

// Learning lives on top of the Library: video transcripts and long captures are read once into a
// digest (core concepts, key points, recall questions), then reviewed with spaced repetition or
// turned into a goal plan, a code review or a mock interview. Everything here is server-side; the
// dashboard only receives the plain records.
// v6 (Lind: "not some terms I learned months back left out so I forget them"): only sources he adds to
// Study count; progress follows the term, not its position, so a deeper read keeps it.

export type Concept = { term: string; explanation: string; example?: string; at?: number; page?: number };
export type QuestionKind = "recall" | "explain" | "apply" | "code" | "interview";
export type LearningQuestion = { q: string; a: string; at?: number; page?: number; kind: QuestionKind };
export type DigestSection = { title: string; summary: string; at?: number; end?: number; page?: number; pageTo?: number };
// A read in progress: which part is next, and everything taken from the parts so far.
export type Reading = { next: number; total: number; sections: DigestSection[]; concepts: Concept[]; questions: LearningQuestion[]; keyPoints: string[]; tries: number; nextAt?: string };
export type LearningDigest = {
  state: "queued" | "analyzing" | "ready" | "failed";
  thesis?: string;
  sections?: DigestSection[];
  concepts: Concept[];
  keyPoints: string[];
  questions: LearningQuestion[];
  language?: string;
  model?: string;
  at?: string;
  error?: string;
  attempts?: number;
  nextAt?: string;
  depth?: 2; // read start to finish (v6); older digests saw only the first 16,000 characters
  reading?: Reading;
};
export type LearningItem = Omit<LibraryItem, "transcript"> & { study: boolean; studying: boolean; conceptCount: number; questionCount: number };
export type SourceHit = { id: string; title: string; kind: LibraryItem["kind"]; section?: string; createdAt: string; snippet: string; studying: boolean; state?: LearningDigest["state"]; concepts: number };

export type ReviewGrade = "again" | "hard" | "good" | "easy";
export type ReviewRecord = { due: string; interval: number; ease: number; reps: number; lapses: number; last?: string; first?: string };
export type ReviewCard = {
  key: string;
  type: "concept" | "question";
  itemId: string;
  term: string; // the term, or the question
  explanation: string; // what it is, or the model answer
  example?: string;
  questionKind?: QuestionKind;
  at?: number;
  page?: number;
  itemTitle: string;
  kind: LibraryItem["kind"];
  due: string;
  reps: number;
  interval: number;
  isNew: boolean;
};

export type LearningOverview = {
  items: LearningItem[];
  cards: ReviewCard[];
  counts: { items: number; study: number; videos: number; concepts: number; due: number; analyzed: number; pending: number; failed: number };
};

export const emptyDigest = (): LearningDigest => ({ state: "queued", concepts: [], keyPoints: [], questions: [] });

const learningDir = () => path.join(DATA_DIR, "learning");
const reviewFile = () => path.join(learningDir(), "review.json");

const atomic = (file: string, data: string) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(3).toString("hex")}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
};

// ---- what can be studied -------------------------------------------------------------------------

// A video, anything with a timed transcript, a PDF, a saved video link, or a long-enough note.
export function isStudyMaterial(it: LibraryItem): boolean {
  if (it.status === "failed") return false;
  if (it.kind === "video" || it.transcript || it.media?.mime === "application/pdf") return true;
  if (it.kind === "link" && isVideoUrl(it.url)) return true;
  if (it.kind === "link" && /transcript:/i.test(it.text ?? "")) return true;
  return (it.kind === "text" || it.kind === "file") && (it.text?.length ?? 0) >= 400;
}

// In Study: he added it, or it was analysed before Study existed. He can take either out.
export const inStudy = (it: Pick<LibraryItem, "studyAt" | "learning">) => (it.studyAt === false ? false : !!it.studyAt || it.learning?.state === "ready");

// Add or take out a source. Adding one that hasn't been read queues its read.
export function setStudying(id: string, on: boolean): LibraryItem | null {
  const it = readItem(id);
  if (!it) return null;
  it.studyAt = on ? new Date().toISOString() : false;
  if (on && !it.learning && isStudyMaterial(it)) it.learning = emptyDigest();
  saveItem(it);
  return it;
}

// Search everything saved, by title, tags or the text inside it; every word has to match.
export function searchSources(items: LibraryItem[], query: string, limit = 60): SourceHit[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const hit = (it: LibraryItem, snippet: string): SourceHit => ({ id: it.id, title: it.title || it.kind, kind: it.kind, section: it.section, createdAt: it.createdAt, snippet, studying: inStudy(it), state: it.learning?.state, concepts: it.learning?.concepts.length ?? 0 });
  const out: SourceHit[] = [];
  for (const it of items) {
    const body = [it.summary, it.note, it.text, it.transcript ? transcriptText(it.transcript) : ""].filter(Boolean).join("\n");
    const hay = `${it.title}\n${it.tags.join(" ")}\n${body}`.toLowerCase();
    if (!words.every((w) => hay.includes(w))) continue;
    const at = words.length ? Math.max(0, body.toLowerCase().indexOf(words[0])) : 0;
    // Whole words: start after the first space, end at the last.
    const cut = body.slice(Math.max(0, at - 60), at + 160).replace(/\s+/g, " ").trim();
    const snippet = at > 60 ? `…${cut.slice(cut.indexOf(" ") + 1)}` : cut;
    out.push(hit(it, snippet.includes(" ") ? snippet.slice(0, snippet.lastIndexOf(" ")) : snippet));
    if (out.length >= limit) break;
  }
  return out;
}

// What the analyser reads: the timed transcript first, then the note, summary and visual description.
export function learningMaterial(it: LibraryItem, limit = 16_000): string {
  const transcript = it.transcript ? transcriptText(it.transcript, limit) : "";
  const body = [it.summary, it.note, it.text].filter(Boolean).join("\n\n");
  return [transcript, body].filter(Boolean).join("\n\n").slice(0, limit);
}

// ---- the analyser's answer -----------------------------------------------------------------------

const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const seconds = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v * 10) / 10 : undefined);

export type RawDigest = {
  thesis?: string;
  concepts?: { term?: string; explanation?: string; at?: number }[];
  key_points?: string[];
  keyPoints?: string[];
  questions?: { q?: string; question?: string; a?: string; answer?: string; at?: number; kind?: string }[];
  language?: string;
};

export function normalizeDigest(raw: unknown): { thesis?: string; concepts: Concept[]; keyPoints: string[]; questions: LearningQuestion[]; language?: string } {
  const o = (raw ?? {}) as RawDigest;
  const concepts: Concept[] = [];
  const seen = new Set<string>();
  for (const c of Array.isArray(o.concepts) ? o.concepts : []) {
    const term = text(c?.term, 80);
    const explanation = text(c?.explanation, 700);
    if (!term || !explanation) continue;
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    concepts.push({ term, explanation, at: seconds(c?.at) });
    if (concepts.length >= 12) break;
  }
  const keyPoints = (Array.isArray(o.key_points) ? o.key_points : Array.isArray(o.keyPoints) ? o.keyPoints : [])
    .map((k) => text(k, 400))
    .filter(Boolean)
    .slice(0, 12);
  const questions: LearningQuestion[] = [];
  for (const q of Array.isArray(o.questions) ? o.questions : []) {
    const prompt = text(q?.q ?? q?.question, 500);
    const answer = text(q?.a ?? q?.answer, 1200);
    if (!prompt || !answer) continue;
    const kind = q?.kind === "code" || q?.kind === "interview" ? q.kind : "recall";
    questions.push({ q: prompt, a: answer, at: seconds(q?.at), kind });
    if (questions.length >= 12) break;
  }
  return { thesis: text(o.thesis, 700) || undefined, concepts, keyPoints, questions, language: text(o.language, 20) || undefined };
}

// ---- reading a whole source, part by part ---------------------------------------------------------

export type ReadPart = { text: string; start?: number; end?: number; pageFrom?: number; pageTo?: number };

export function splitTimed(t: Transcript, max: number): ReadPart[] {
  const parts: ReadPart[] = [];
  let cur = null as ReadPart | null;
  for (const s of t.segments) {
    const line = s.start !== undefined && s.end !== undefined && s.end > 0 ? `[${formatTimestamp(s.start)}] ${s.text}` : s.text;
    if (cur && cur.text.length + line.length + 1 > max) {
      parts.push(cur);
      cur = null;
    }
    cur = cur ? { ...cur, text: `${cur.text}\n${line}`, end: s.end } : { text: line, start: s.start, end: s.end };
  }
  return cur ? [...parts, cur] : parts;
}

export function splitText(body: string, max: number): ReadPart[] {
  const parts: ReadPart[] = [];
  let cur = "";
  for (const para of body.split(/\n\s*\n/)) {
    for (let i = 0; i < para.length || i === 0; i += max) {
      const piece = para.slice(i, i + max);
      if (cur && cur.length + piece.length + 2 > max) {
        parts.push({ text: cur });
        cur = "";
      }
      cur = cur ? `${cur}\n\n${piece}` : piece;
    }
  }
  return cur.trim() ? [...parts, { text: cur }] : parts;
}

export function splitPages(pages: string[], maxChars: number, maxPages: number): ReadPart[] {
  const parts: ReadPart[] = [];
  let cur = null as ReadPart | null;
  for (let i = 0; i < pages.length; i++) {
    const text = `[page ${i + 1}]\n${pages[i].trim()}`;
    if (cur && (cur.text.length + text.length > maxChars || i + 1 - cur.pageFrom! >= maxPages)) {
      parts.push(cur);
      cur = null;
    }
    cur = cur ? { ...cur, text: `${cur.text}\n\n${text}`, pageTo: i + 1 } : { text, pageFrom: i + 1, pageTo: i + 1 };
  }
  return cur ? [...parts, cur] : parts;
}

const place = (o: { at?: unknown; page?: unknown }) => {
  const page = typeof o.page === "number" && o.page > 0 ? Math.round(o.page) : undefined;
  return { at: seconds(o.at), ...(page ? { page } : {}) };
};
const KINDS: QuestionKind[] = ["recall", "explain", "apply", "code", "interview"];

// One part as the model wrote it, checked. Detail is the point, so the limits are generous.
export function normalizePart(raw: unknown, itemId = "") {
  const o = (raw ?? {}) as RawDigest & { title?: string; summary?: string };
  const concepts = (Array.isArray(o.concepts) ? o.concepts : []).flatMap((c): Concept[] => {
    const term = text(c?.term, 80);
    const explanation = text(c?.explanation, 1600);
    const example = text((c as { example?: unknown })?.example, 800);
    return term && explanation ? [{ term, explanation, ...(example ? { example } : {}), ...place(c ?? {}) }] : [];
  });
  const questions = (Array.isArray(o.questions) ? o.questions : []).flatMap((q): LearningQuestion[] => {
    const prompt = text(q?.q ?? q?.question, 600);
    const answer = text(q?.a ?? q?.answer, 2000);
    return prompt && answer ? [{ q: prompt, a: answer, kind: KINDS.includes(q?.kind as QuestionKind) ? (q!.kind as QuestionKind) : "recall", ...place(q ?? {}) }] : [];
  });
  const keyPoints = (Array.isArray(o.key_points) ? o.key_points : []).map((k) => text(k, 400)).filter(Boolean);
  return { itemId, section: { title: text(o.title, 120) || "Part", summary: text(o.summary, 1200) }, concepts, questions, keyPoints };
}

// All the parts become the digest. A term repeated across parts keeps its fullest explanation, and
// anything he has already reviewed stays, even if this read didn't name it: nothing learned is dropped.
export function mergeRead(old: LearningDigest, r: Reading, final: { thesis?: string; key_points?: string[]; language?: string }, model: string, records: Record<string, ReviewRecord>, itemId: string): LearningDigest {
  const byTerm = new Map<string, Concept>();
  for (const c of r.concepts) {
    const k = slug(c.term);
    const had = byTerm.get(k);
    if (!had || c.explanation.length > had.explanation.length) byTerm.set(k, { ...had, ...c, example: c.example ?? had?.example });
  }
  for (const c of old.concepts) if (records[cardKey(itemId, c.term)] && !byTerm.has(slug(c.term))) byTerm.set(slug(c.term), c);
  const seen = new Set<string>();
  const questions = r.questions.filter((q) => !seen.has(q.q.toLowerCase()) && seen.add(q.q.toLowerCase()));
  const finalPoints = (Array.isArray(final.key_points) ? final.key_points : []).map((k) => text(k, 400)).filter(Boolean);
  return {
    state: "ready",
    thesis: text(final.thesis, 900) || old.thesis || r.sections[0]?.summary,
    sections: r.sections,
    concepts: [...byTerm.values()],
    keyPoints: finalPoints.length ? finalPoints : r.keyPoints.slice(0, 15),
    questions,
    language: text(final.language, 20) || old.language,
    model,
    at: new Date().toISOString(),
    depth: 2,
  };
}

// ---- spaced repetition ---------------------------------------------------------------------------

const DAY = 86_400_000;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function nextReview(previous: ReviewRecord | null, grade: ReviewGrade, now = new Date()): ReviewRecord {
  const prev = previous ?? { due: now.toISOString(), interval: 0, ease: 2.5, reps: 0, lapses: 0 };
  let { interval, reps, lapses } = prev;
  let ease = prev.ease;
  if (grade === "again") {
    ease = clamp(ease - 0.2, 1.3, 2.8);
    interval = 10 / 1440; // in 10 minutes
    reps = 0;
    lapses += 1;
  } else if (grade === "hard") {
    ease = clamp(ease - 0.15, 1.3, 2.8);
    interval = prev.interval <= 0 ? 1 : Math.max(1, prev.interval * 1.2);
    reps += 1;
  } else if (grade === "good") {
    ease = clamp(ease + 0.05, 1.3, 2.8);
    interval = prev.interval <= 0 ? 1 : prev.interval < 1 ? 3 : Math.round(prev.interval * ease);
    reps += 1;
  } else {
    ease = clamp(ease + 0.15, 1.3, 2.8);
    interval = prev.interval <= 0 ? 3 : Math.round(Math.max(prev.interval + 1, prev.interval * ease * 1.3));
    reps += 1;
  }
  interval = Math.min(365, interval);
  return { due: new Date(now.getTime() + Math.round(interval * DAY)).toISOString(), interval, ease, reps, lapses, last: now.toISOString(), first: previous?.first ?? now.toISOString() };
}

export function readReviewRecords(): Record<string, ReviewRecord> {
  try {
    const v = JSON.parse(fs.readFileSync(reviewFile(), "utf8"));
    if (!v || typeof v !== "object" || Array.isArray(v)) return {};
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>).flatMap(([k, r]) => {
        const o = r as Partial<ReviewRecord>;
        if (typeof o?.due !== "string" || Number.isNaN(Date.parse(o.due))) return [];
        return [[k, { due: o.due, interval: Number(o.interval) || 0, ease: Number(o.ease) || 2.5, reps: Number(o.reps) || 0, lapses: Number(o.lapses) || 0, last: o.last, first: o.first }]];
      }),
    );
  } catch {
    return {};
  }
}

const slug = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 80);
export const cardKey = (itemId: string, term: string) => `${itemId}#t:${slug(term)}`;

// Before v6 a record was keyed by the concept's position, which a new read would scramble.
export function migrateReviewKeys(items: LibraryItem[]) {
  const all = readReviewRecords();
  let changed = false;
  for (const key of Object.keys(all)) {
    const m = key.match(/^(.+)#(\d+)$/);
    if (!m) continue;
    const term = items.find((i) => i.id === m[1])?.learning?.concepts[Number(m[2])]?.term;
    if (!term) continue;
    all[cardKey(m[1], term)] ??= all[key];
    delete all[key];
    changed = true;
  }
  if (changed) atomic(reviewFile(), JSON.stringify(all, null, 1));
}

export const saveReviewRecords = (all: Record<string, ReviewRecord>) => atomic(reviewFile(), JSON.stringify(all, null, 1));
export const questionKey = (itemId: string, q: string) => `${itemId}#q:${slug(q)}`;

export function gradeCard(items: LibraryItem[], key: string, grade: ReviewGrade, now = new Date()): ReviewRecord | null {
  const itemId = key.split("#")[0];
  const l = items.find((i) => i.id === itemId)?.learning;
  if (!l?.concepts.some((c) => cardKey(itemId, c.term) === key) && !l?.questions.some((q) => questionKey(itemId, q.q) === key)) return null;
  const all = readReviewRecords();
  const next = nextReview(all[key] ?? null, grade, now);
  all[key] = next;
  saveReviewRecords(all);
  return next;
}

// Today's sitting: everything due, plus new cards up to the day's limit, so a two-hour lecture joins
// gradually instead of burying him. Sunday covers all of it regardless.
export function dailyQueue(cards: ReviewCard[], records: Record<string, ReviewRecord>, now: Date, newPerDay = 20): ReviewCard[] {
  const today = now.toISOString().slice(0, 10);
  const started = Object.values(records).filter((r) => r.first?.startsWith(today)).length;
  const fresh = cards.filter((c) => c.isNew).slice(0, Math.max(0, newPerDay - started));
  return [...cards.filter((c) => !c.isNew && Date.parse(c.due) <= now.getTime()), ...fresh];
}

export function buildReviewQueue(items: LibraryItem[], records = readReviewRecords(), now = new Date()): ReviewCard[] {
  const cards: ReviewCard[] = [];
  for (const it of items) {
    if (it.learning?.state !== "ready" || !inStudy(it)) continue;
    const card = (key: string, c: Pick<ReviewCard, "type" | "term" | "explanation" | "example" | "questionKind" | "at" | "page">): ReviewCard => {
      const rec = records[key];
      return { key, itemId: it.id, ...c, itemTitle: it.title || it.kind, kind: it.kind, due: rec?.due ?? now.toISOString(), reps: rec?.reps ?? 0, interval: rec?.interval ?? 0, isNew: !rec };
    };
    for (const c of it.learning.concepts) cards.push(card(cardKey(it.id, c.term), { type: "concept", term: c.term, explanation: c.explanation, example: c.example, at: c.at, page: c.page }));
    for (const q of it.learning.questions) cards.push(card(questionKey(it.id, q.q), { type: "question", term: q.q, explanation: q.a, questionKind: q.kind, at: q.at, page: q.page }));
  }
  return cards.sort((a, b) => Date.parse(a.due) - Date.parse(b.due) || a.itemTitle.localeCompare(b.itemTitle));
}

// The dashboard payload: everything Lind captured (minus heavy transcripts), the review queue as it
// stands, and the counters the header shows.
export function learningOverview(items: LibraryItem[], now = new Date()): LearningOverview {
  const study = items.filter(isStudyMaterial);
  const ready = items.filter((i) => inStudy(i) && i.learning?.state === "ready");
  const records = readReviewRecords();
  const cards = dailyQueue(buildReviewQueue(items, records, now), records, now);
  const lean: LearningItem[] = items.map((it) => {
    const study = isStudyMaterial(it);
    const { transcript: _transcript, ...rest } = it;
    // The list carries counts; a source's own page loads the full notes.
    const l = it.learning;
    return { ...rest, text: (it.text ?? "").slice(0, 300), study, studying: inStudy(it), conceptCount: l?.concepts.length ?? 0, questionCount: l?.questions.length ?? 0, learning: l && { ...l, concepts: [], questions: [], keyPoints: [], sections: undefined, reading: l.reading && { ...l.reading, sections: [], concepts: [], questions: [], keyPoints: [] } } };
  });
  return {
    items: lean,
    cards,
    counts: {
      items: items.length,
      study: items.filter(inStudy).length,
      videos: items.filter((i) => i.kind === "video" || (i.kind === "link" && isVideoUrl(i.url))).length,
      concepts: ready.reduce((n, i) => n + (i.learning?.concepts.length ?? 0), 0),
      due: cards.length,
      analyzed: ready.length,
      pending: items.filter((i) => inStudy(i) && (i.learning?.state === "queued" || i.learning?.state === "analyzing")).length,
      failed: study.filter((i) => i.learning?.state === "failed").length,
    },
  };
}

// ---- sessions: goal, code review, mock interview -------------------------------------------------

export type LearningMode = "goal" | "code-review" | "interview-me";
export type LearningStep = { prompt: string; answer: string; at?: number };
export type LearningSession = { mode: LearningMode; title: string; intro: string; steps: LearningStep[]; generated: boolean; sources: string[] };

const MODE_TITLE: Record<LearningMode, string> = { goal: "Study plan", "code-review": "Code review", "interview-me": "Mock interview" };

function fallbackSteps(mode: LearningMode, items: LibraryItem[]): LearningStep[] {
  const ready = items.filter((i) => i.learning?.state === "ready");
  if (mode === "goal") {
    return ready
      .flatMap((i) => (i.learning?.concepts ?? []).map((c) => ({ prompt: `Explain “${c.term}” in your own words, without notes.`, answer: c.explanation, at: c.at })))
      .slice(0, 8);
  }
  const want = mode === "code-review" ? "code" : "interview";
  const preferred = ready.flatMap((i) => (i.learning?.questions ?? []).filter((q) => q.kind === want).map((q) => ({ prompt: q.q, answer: q.a, at: q.at })));
  const any = ready.flatMap((i) => (i.learning?.questions ?? []).map((q) => ({ prompt: q.q, answer: q.a, at: q.at })));
  const picked = (preferred.length ? preferred : any).slice(0, 8);
  if (picked.length) return picked;
  return ready
    .flatMap((i) => (i.learning?.concepts ?? []).map((c) => ({ prompt: `How would you explain “${c.term}” under interview pressure?`, answer: c.explanation, at: c.at })))
    .slice(0, 8);
}

export async function generateSession(mode: LearningMode, items: LibraryItem[], goal = ""): Promise<LearningSession> {
  const ready = items.filter((i) => i.learning?.state === "ready");
  if (!ready.length) throw new Error("Analyze at least one item first — open it in the library and tap Analyze.");
  // Every source he picked gets its share of the room.
  const share = Math.floor(14_000 / ready.length);
  const material = ready
    .map((i) => {
      const d = i.learning!;
      return [
        `## ${i.title || i.kind}${i.url ? ` (${i.url})` : ""}`,
        d.thesis ?? "",
        d.keyPoints.length ? `Key points:\n${d.keyPoints.map((k) => `- ${k}`).join("\n")}` : "",
        d.concepts.length ? `Concepts:\n${d.concepts.map((c) => `- ${c.term}: ${c.explanation}${c.at !== undefined ? ` (at ${formatTimestamp(c.at)})` : ""}`).join("\n")}` : "",
      ]
        .filter(Boolean)
        .join("\n")
        .slice(0, share);
    })
    .join("\n\n");

  const ask =
    mode === "goal"
      ? `Lind's goal: "${goal || "master this material"}". Build a short study plan that gets him there from this material. Each step is an active exercise he performs, not a heading; the answer is what a good attempt covers.`
      : mode === "code-review"
        ? `Write code-review questions that test whether Lind can explain, critique and defend the implementation and design choices in this material. Each prompt is a realistic review question; the answer is what a strong review should cover.`
        : `Act as a technical interviewer. Ask interview questions drawn from this material, one at a time, from warm-up to hard. The answer is a strong model answer.`;

  let steps: LearningStep[] = [];
  let title = MODE_TITLE[mode];
  let intro = "";
  let generated = false;
  try {
    const out = await askJSON<{ title?: string; intro?: string; steps?: { prompt?: string; answer?: string; at?: number }[] }>(
      `You are Lind's learning coach. Lind is a CS student in Kosovo; he saves videos and notes to Memory and wants to understand them deeply, not memorise them.
${ask}
Return JSON: {"title": string (≤8 words), "intro": string (1-2 sentences), "steps": [{"prompt": string, "answer": string, "at": number|null}]}.
- 4-6 steps, concise and specific to the material.
- at: seconds into the source video when that idea is discussed, or null.
- Write in English unless the material is clearly Albanian.`,
      `Goal: ${goal || "(none — general mastery)"}\n\nMaterial:\n\n${material}`,
      { maxTokens: 3500, temperature: 0.3, good: (o) => Array.isArray(o.steps) && o.steps.length > 0 },
    );
    const raw = Array.isArray(out?.steps) ? out.steps : [];
    steps = raw
      .flatMap((s) => {
        const prompt = text(s?.prompt, 600);
        const answer = text(s?.answer, 1400);
        return prompt && answer ? [{ prompt, answer, at: seconds(s?.at) }] : [];
      })
      .slice(0, 8);
    if (steps.length) generated = true;
    if (typeof out?.title === "string" && out.title.trim()) title = out.title.trim().slice(0, 100);
    if (typeof out?.intro === "string") intro = out.intro.trim().slice(0, 500);
  } catch {
    // Groq quota or network — the stored questions still make a usable session.
  }
  if (!steps.length) steps = fallbackSteps(mode, ready);
  if (!steps.length) throw new Error("Nothing to practise yet — analyze an item with a transcript first.");
  if (!intro) intro = mode === "goal" ? `A plan built from ${ready.length} saved ${ready.length === 1 ? "item" : "items"}.` : "Answer out loud first, then check the model answer.";
  return { mode, title, intro, steps, generated, sources: ready.map((i) => i.title || i.kind) };
}
