import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./config";
import { cardKey, inStudy, readReviewRecords, type ReviewRecord } from "./learning";
import type { LibraryItem } from "./library";

// Topics (v6): concepts from every source in Study, grouped so a Sunday can touch all of them. Lind
// blurts a topic in one go; the marks still land term by term. A term the sorter hasn't placed still
// shows up, under its source, so nothing can fall out of the weekly session.
// data/learning/topics.json

export type Topic = { id: string; name: string; keys: string[] };
export type Memory = "new" | "weak" | "fading" | "strong";
export type TopicTerm = { key: string; term: string; itemId: string; memory: Memory };
export type TopicView = { id: string; name: string; terms: TopicTerm[]; score: number; sources: string[]; sorted: boolean };

const TOPIC_MAX = 15; // about what one blurt can hold
const BATCH = 80;
const DAY = 86_400_000;
const file = () => path.join(DATA_DIR, "learning", "topics.json");

export function readTopics(): Topic[] {
  try {
    const v = JSON.parse(fs.readFileSync(file(), "utf8"));
    return Array.isArray(v) ? v.filter((t) => t?.id && t?.name && Array.isArray(t.keys)) : [];
  } catch {
    return [];
  }
}
function saveTopics(topics: Topic[]) {
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(`${file()}.${process.pid}.tmp`, JSON.stringify(topics, null, 1));
  fs.renameSync(`${file()}.${process.pid}.tmp`, file());
}

type Term = { key: string; term: string; itemId: string; title: string; explanation: string };

export function studiedTerms(items: LibraryItem[]): Term[] {
  return items.flatMap((i) => (i.learning?.state === "ready" && inStudy(i) ? i.learning.concepts.map((c) => ({ key: cardKey(i.id, c.term), term: c.term, itemId: i.id, title: i.title || i.kind, explanation: c.explanation })) : []));
}

// How well it's held: how much of its interval has gone by, and how often it has been lost.
export function memoryOf(rec: ReviewRecord | undefined, now: Date): Memory {
  if (!rec?.last) return "new";
  const left = Math.exp(-Math.max(0, now.getTime() - Date.parse(rec.last)) / DAY / Math.max(1, rec.interval));
  if (left < 0.35 || rec.lapses >= 3 || rec.interval < 1) return "weak";
  return left >= 0.5 && rec.interval >= 7 ? "strong" : "fading";
}
const WEIGHT: Record<Memory, number> = { new: 0, weak: 0, fading: 0.5, strong: 1 };

// Every topic with its live terms, then whatever hasn't been placed yet, under its source.
export function topicsView(items: LibraryItem[], records = readReviewRecords(), now = new Date()): TopicView[] {
  const terms = new Map(studiedTerms(items).map((t) => [t.key, t]));
  const titles = new Map(items.map((i) => [i.id, i.title || i.kind]));
  const placed = new Set<string>();
  const view = (id: string, name: string, keys: string[], sorted: boolean): TopicView | null => {
    const live = keys.flatMap((k) => {
      const t = terms.get(k);
      if (!t || placed.has(k)) return [];
      placed.add(k);
      return [{ key: k, term: t.term, itemId: t.itemId, memory: memoryOf(records[k], now) }];
    });
    if (!live.length) return null;
    return { id, name, terms: live, sorted, score: live.reduce((s, t) => s + WEIGHT[t.memory], 0) / live.length, sources: [...new Set(live.map((t) => titles.get(t.itemId) ?? ""))] };
  };
  const out = readTopics().flatMap((t) => view(t.id, t.name, t.keys, true) ?? []);
  const rest = new Map<string, string[]>();
  for (const t of terms.values()) if (!placed.has(t.key)) rest.set(t.itemId, [...(rest.get(t.itemId) ?? []), t.key]);
  for (const [itemId, keys] of rest) {
    const v = view(`source-${itemId}`, titles.get(itemId) ?? "Unsorted", keys, false);
    if (v) out.push(v);
  }
  return out;
}

const SYSTEM = `You keep the map of what Lind has studied. Group the new terms into topics a student would recognise ("Graph traversal", "Attention in transformers"). A topic holds 3 to ${TOPIC_MAX} closely related terms: small enough to recite from memory in one go.
Return JSON: {"topics": [{"name": string, "keys": [string]}]}.
- Put a term in an existing topic when it belongs there, using that topic's exact name. Otherwise make a new one; never one topic per term.
- Group by subject, not by source. Every key you were given goes in exactly one topic. Use keys exactly as given.`;

// Places the terms that have no topic yet. Whatever a model doesn't place stays unsorted and is tried
// again next time; it's still in the weekly session through topicsView.
export async function sortTopics(items: LibraryItem[], ask: <T>(system: string, user: string, tokens: number) => Promise<Partial<T>> = defaultAsk): Promise<number> {
  const topics = readTopics();
  const terms = studiedTerms(items);
  const live = new Set(terms.map((t) => t.key));
  const placed = new Set(topics.flatMap((t) => t.keys));
  const todo = terms.filter((t) => !placed.has(t.key)).slice(0, BATCH);
  if (!todo.length) return 0;
  const user = `Topics so far:\n${topics.map((t) => `- ${t.name} (${t.keys.length} terms)`).join("\n") || "(none)"}\n\nNew terms (key | term | from):\n${todo.map((t) => `${t.key} | ${t.term} | ${t.title}`).join("\n")}`;
  const out = await ask<{ topics: { name?: string; keys?: unknown[] }[] }>(SYSTEM, user, 3000);
  let moved = 0;
  for (const raw of Array.isArray(out.topics) ? out.topics : []) {
    const name = String(raw?.name ?? "").trim().slice(0, 80);
    const keys = [...new Set((Array.isArray(raw?.keys) ? raw.keys : []).map(String))].filter((k) => live.has(k) && !placed.has(k));
    if (!name || !keys.length) continue;
    for (const k of keys) {
      placed.add(k);
      // Full topics spill into a numbered sibling, so each stays one blurt long.
      const open = topics.find((t) => (t.name.toLowerCase() === name.toLowerCase() || t.name.toLowerCase().startsWith(`${name.toLowerCase()} ·`)) && t.keys.length < TOPIC_MAX);
      if (open) open.keys.push(k);
      else {
        const same = topics.filter((t) => t.name.toLowerCase() === name.toLowerCase() || t.name.toLowerCase().startsWith(`${name.toLowerCase()} ·`)).length;
        topics.push({ id: crypto.randomBytes(4).toString("hex"), name: same ? `${name} · ${same + 1}` : name, keys: [k] });
      }
      moved++;
    }
  }
  if (moved) saveTopics(topics);
  return moved;
}

async function defaultAsk<T>(system: string, user: string, tokens: number): Promise<Partial<T>> {
  const { askJSON } = await import("./ask");
  return (await askJSON<T>(system, user, { maxTokens: tokens, temperature: 0.2, good: (o) => Object.keys(o).length > 0 })) ?? {};
}
