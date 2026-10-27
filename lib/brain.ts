import fs from "node:fs";
import path from "node:path";
import { redact } from "./redact";
import { DATA_DIR } from "./config";

// The brain: everything Lind does with agents, crystallized into the Obsidian vault. The PC collector
// (handoff/brain-collect.mjs) uploads condensed, redacted chats here; the runner (runner/brain.ts) turns
// them into wiki pages with Nemotron, adds GitHub commits and dashboard chats nightly, and runs the
// weekly Luna synthesis. This file is the shared storage both sides use.

export const BRAIN_DIR = () => path.join(DATA_DIR, "brain");
export const brainInbox = () => path.join(BRAIN_DIR(), "inbox");

export type BrainItem = {
  kind: "chat" | "graph" | "dashboard";
  id: string; // session id / repo / job id
  agent: string; // claude | codex | graphify | the dashboard agent
  title: string;
  project: string; // repo short name, or the folder the chat ran in
  firstAt: string;
  lastAt: string;
  text: string; // condensed and redacted on the PC
  source?: string; // where it came from (PC path, job URL)
};

export type SourceStatus = { lastRun?: string; lastOk?: string; items?: number; failures?: number; lastError?: string; note?: string };
export type BrainStatus = { updatedAt?: string; queue?: number; sources: Record<string, SourceStatus>; redactions?: number };

export const ITEM_KEY = (i: Pick<BrainItem, "kind" | "id">) => `${i.kind}-${i.id}`.replace(/[^\w.-]/g, "_").slice(0, 120);

// Latest version wins: a chat uploaded again before it was processed just replaces the queued copy.
export function queueBrainItem(item: BrainItem) {
  item = { ...item, title: redact(item.title).text, project: redact(item.project).text,
    text: redact(item.text).text, source: item.source ? redact(item.source).text : undefined };
  fs.mkdirSync(brainInbox(), { recursive: true });
  const file = path.join(brainInbox(), `${ITEM_KEY(item)}.json`);
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(item));
  fs.renameSync(`${file}.tmp`, file);
}

export function readBrainStatus(): BrainStatus {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(BRAIN_DIR(), "status.json"), "utf8")) as BrainStatus;
    return { ...s, sources: s?.sources ?? {} };
  } catch {
    return { sources: {} };
  }
}

export function validBrainItem(b: Partial<BrainItem> | null): string | null {
  if (!b) return "missing body";
  if (b.kind !== "chat" && b.kind !== "graph") return "kind must be chat or graph";
  if (typeof b.id !== "string" || !/^[\w.-]{1,100}$/.test(b.id)) return "bad id";
  if (typeof b.text !== "string" || !b.text.trim()) return "empty text";
  if (b.text.length > 4_000_000) return "text too large";
  return null;
}
