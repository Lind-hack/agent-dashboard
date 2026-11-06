import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { askJSON } from "./ask";
import { addDays } from "./calendar";
import { DATA_DIR } from "./config";
import { cardKey, inStudy, nextReview, readReviewRecords, saveReviewRecords, type ReviewGrade, type ReviewRecord } from "./learning";
import { readTopics, studiedTerms, topicsView } from "./learning-topics";
import { listItems, type LibraryItem } from "./library";
import { listTodos, updateTodo } from "./todos";

// The Sunday blurt (v6, Lind: "revise everything from start to finish, so terms from months back aren't
// left out and forgotten"). Every Sunday: each source added this week whole, then every older topic.
// He recites a round from memory, by voice or typing; the AI reads it against the sources and marks
// every term; he can overrule a mark. Confirming the round feeds the review schedule, and whatever he
// missed is drilled on the spot. A blurt is saved before it's graded, and the session survives being
// left halfway, so a bad connection or a busy day loses nothing. The same rounds serve a blurt on
// sources he picks, any day.
// data/learning/sessions/<id>.json

export type Mark = "recalled" | "partial" | "missed";
export type GradedTerm = { key: string; term: string; status: Mark; note?: string; overruled?: boolean };
export type Round = {
  id: string;
  kind: "week" | "older" | "picked";
  title: string;
  terms: { key: string; term: string; itemId: string }[];
  blurt?: string;
  graded?: GradedTerm[];
  feedback?: string;
  confirmed?: boolean;
  drills?: string[]; // keys to drill: what he missed
  fixed?: string[]; // drilled and got right
};
export type SessionReport = { recalled: number; partial: number; missed: number; fixed: number; strong: string[]; slipping: string[] };
export type LearningRun = { id: string; day: string; createdAt: string; state: "open" | "done"; rounds: Round[]; doneAt?: string; report?: SessionReport };

const dir = () => path.join(DATA_DIR, "learning", "sessions");
const file = (id: string) => path.join(dir(), `${id.replace(/[^a-z0-9-]/gi, "")}.json`);
const save = (s: LearningRun) => {
  fs.mkdirSync(dir(), { recursive: true });
  fs.writeFileSync(`${file(s.id)}.${process.pid}.tmp`, JSON.stringify(s));
  fs.renameSync(`${file(s.id)}.${process.pid}.tmp`, file(s.id));
};
export function readRun(id: string): LearningRun | null {
  try {
    const s = JSON.parse(fs.readFileSync(file(id), "utf8")) as LearningRun;
    return s?.id ? { ...s, rounds: Array.isArray(s.rounds) ? s.rounds : [] } : null;
  } catch {
    return null;
  }
}

const weekday = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay();
export const sundayOf = (day: string) => addDays(day, -weekday(day));
const sundayId = (sunday: string) => `sunday-${sunday}`;

// When a source joined his learning: the day he added it, or for older ones the day he saved it.
const learnedAt = (it: LibraryItem) => (typeof it.studyAt === "string" ? it.studyAt : it.createdAt).slice(0, 10);

let roundId = 0;
const round = (kind: Round["kind"], title: string, terms: Round["terms"]): Round => ({ id: `r${++roundId}-${crypto.randomBytes(2).toString("hex")}`, kind, title, terms });

// This week's sources whole, then every older topic, weakest first. Each term lands in one round.
export function buildSunday(day: string, items: LibraryItem[], records: Record<string, ReviewRecord> = readReviewRecords(), now = new Date()): LearningRun {
  const fresh = items.filter((i) => inStudy(i) && i.learning?.state === "ready" && learnedAt(i) > addDays(day, -7));
  const thisWeek = fresh.map((i) => round("week", i.title || i.kind, i.learning!.concepts.map((c) => ({ key: cardKey(i.id, c.term), term: c.term, itemId: i.id }))));
  const taken = new Set(thisWeek.flatMap((r) => r.terms.map((t) => t.key)));
  const older = topicsView(items, records, now)
    .map((t) => ({ t, terms: t.terms.filter((x) => !taken.has(x.key)) }))
    .filter(({ terms }) => terms.length)
    .sort((a, z) => a.t.score - z.t.score)
    .map(({ t, terms }) => round("older", t.name, terms.map(({ key, term, itemId }) => ({ key, term, itemId }))));
  return { id: sundayId(day), day, createdAt: now.toISOString(), state: "open", rounds: [...thisWeek, ...older].filter((r) => r.terms.length) };
}

export function startSunday(day: string, now = new Date()): LearningRun {
  const sunday = sundayOf(day);
  const had = readRun(sundayId(sunday));
  if (had) return had;
  const s = buildSunday(sunday, listItems(), readReviewRecords(), now);
  save(s);
  return s;
}

export function startCustom(itemIds: string[], now = new Date()): LearningRun {
  const items = listItems().filter((i) => itemIds.includes(i.id) && i.learning?.state === "ready");
  if (!items.length) throw new Error("Pick a source that's been read first.");
  const s: LearningRun = { id: `custom-${crypto.randomBytes(5).toString("hex")}`, day: now.toISOString().slice(0, 10), createdAt: now.toISOString(), state: "open", rounds: items.map((i) => round("picked", i.title || i.kind, i.learning!.concepts.map((c) => ({ key: cardKey(i.id, c.term), term: c.term, itemId: i.id })))) };
  save(s);
  return s;
}

// The Sunday in play: this week's, or last week's if it's still open on a day before the next one.
export function currentSession(day: string): LearningRun | null {
  return readRun(sundayId(sundayOf(day)));
}

function edit(id: string, roundIdValue: string, fn: (r: Round, s: LearningRun) => void): LearningRun {
  const s = readRun(id);
  const r = s?.rounds.find((x) => x.id === roundIdValue);
  if (!s || !r) throw new Error("That round is gone.");
  fn(r, s);
  save(s);
  return s;
}

const SYSTEM = `You mark Lind's blurt: he recited everything he remembers about a topic, from memory, with no notes. It was often spoken and transcribed, so ignore spelling, grammar, filler and word order, and accept his own words: mark understanding, not wording.
For EVERY term in the list, using its key exactly, say how much of it he really showed:
- "recalled": he stated the core idea correctly, in any words.
- "partial": he touched it, but a key piece is missing or vague.
- "missed": he didn't mention it, or what he said about it is wrong.
Never give credit for a term he only named without saying what it is. note: for partial and missed, one short line on exactly what was missing or wrong, taken from the reference. Empty for recalled.
feedback: 2–3 sentences to him, second person: what he holds well and the biggest gap, specific to what he said.
Return JSON: {"feedback": string, "terms": [{"key": string, "status": "recalled"|"partial"|"missed", "note": string}]}`;

export async function gradeRound(id: string, rid: string, text: string): Promise<Round> {
  const blurt = text.trim().slice(0, 24_000);
  if (!blurt) throw new Error("Say or type what you remember first.");
  // Saved first: if the models fail, his recitation doesn't.
  const s = edit(id, rid, (r) => {
    r.blurt = blurt;
  });
  const r = s.rounds.find((x) => x.id === rid)!;
  const known = new Map(studiedTerms(listItems().filter((i) => r.terms.some((t) => t.itemId === i.id))).map((t) => [t.key, t.explanation]));
  const user = `Topic: ${r.title}\n\nTerms, with what the sources say:\n${r.terms.map((t) => `${t.key} | ${t.term}: ${known.get(t.key) ?? ""}`).join("\n")}\n\nHis blurt:\n${blurt}`;
  const out = await askJSON<{ feedback: string; terms: { key?: string; status?: string; note?: string }[] }>(SYSTEM, user, { maxTokens: Math.min(6000, 1000 + r.terms.length * 90), temperature: 0.1, good: (o) => Array.isArray(o.terms) && o.terms.length > 0 });
  if (!out?.terms) throw new Error("Couldn't mark that right now — the models are busy. Your blurt is saved, try again in a minute.");
  const marks = new Map(out.terms.map((t) => [String(t?.key), t]));
  const graded: GradedTerm[] = r.terms.map((t) => {
    const m = marks.get(t.key);
    const status: Mark = m?.status === "recalled" || m?.status === "partial" ? m.status : "missed";
    const note = String(m?.note ?? "").trim().slice(0, 300);
    return { key: t.key, term: t.term, status, ...(note && status !== "recalled" ? { note } : !m ? { note: "You didn't mention this one." } : {}) };
  });
  return edit(id, rid, (x) => {
    x.graded = graded;
    x.feedback = String(out.feedback ?? "").trim().slice(0, 800);
  }).rounds.find((x) => x.id === rid)!;
}

export const overrideTerm = (id: string, rid: string, key: string, status: Mark) =>
  edit(id, rid, (r) => {
    if (r.confirmed) throw new Error("That round is already confirmed.");
    r.graded = r.graded?.map((t) => (t.key === key ? { ...t, status, overruled: true } : t));
  });

// The marks count from here, once. Partly recalled is hard, missed starts it over. Recalled only moves a
// card that was due: a topic comes up every Sunday, and that mustn't push its terms out months a week.
export function confirmRound(id: string, rid: string, now = new Date()): Round {
  return edit(id, rid, (r) => {
    if (r.confirmed) return;
    if (!r.graded) throw new Error("Blurt this one first.");
    const records = readReviewRecords();
    for (const t of r.graded) {
      const rec = records[t.key] ?? null;
      const grade: ReviewGrade | null = t.status === "missed" ? "again" : t.status === "partial" ? "hard" : !rec || Date.parse(rec.due) <= now.getTime() ? "good" : null;
      records[t.key] = grade ? nextReview(rec, grade, now) : { ...rec!, last: now.toISOString() };
    }
    saveReviewRecords(records);
    r.confirmed = true;
    r.drills = r.graded.filter((t) => t.status === "missed").map((t) => t.key);
  }).rounds.find((x) => x.id === rid)!;
}

export const drillTerm = (id: string, rid: string, key: string, got: boolean) =>
  edit(id, rid, (r) => {
    if (got && !r.fixed?.includes(key)) r.fixed = [...(r.fixed ?? []), key];
  });

export function finishSession(id: string, now = new Date()): LearningRun {
  const s = readRun(id);
  if (!s) throw new Error("That session is gone.");
  const left = s.rounds.filter((r) => !r.confirmed).length;
  if (left) throw new Error(`${left} rounds left.`);
  const all = s.rounds.flatMap((r) => r.graded ?? []);
  const fixed = s.rounds.flatMap((r) => r.fixed ?? []);
  const count = (m: Mark) => all.filter((t) => t.status === m).length;
  const held = (r: Round) => (r.graded ?? []).filter((t) => t.status === "recalled").length / Math.max(1, r.graded?.length ?? 1);
  const report: SessionReport = {
    recalled: count("recalled"),
    partial: count("partial"),
    missed: count("missed"),
    fixed: fixed.length,
    strong: s.rounds.filter((r) => held(r) >= 0.8).map((r) => r.title).slice(0, 12),
    slipping: all.filter((t) => t.status !== "recalled" && !fixed.includes(t.key)).map((t) => t.term).concat(all.filter((t) => t.status === "missed" && fixed.includes(t.key)).map((t) => t.term)).slice(0, 20),
  };
  const done: LearningRun = { ...s, state: "done", doneAt: now.toISOString(), report };
  save(done);
  for (const t of listTodos()) if (!t.done && t.link === sessionHref && t.day <= s.day) updateTodo(t.id, { done: true });
  return done;
}

export const sessionHref = "/learning?tab=sunday";
// What's on the topic map, for the page.
export const topicCount = () => readTopics().length;
