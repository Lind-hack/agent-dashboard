import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./config";

// Memories Lind writes himself, on the Memory page. One JSON file (data/memories.json), written only by
// the web app; the runner reads it to put pinned memories into every agent's brief, and lib/memory.ts
// indexes all of them next to chats, Linear, Obsidian and notes so Ask (and the Core) can find them.

// The skill a memory belongs to. Each one has its own look on the Memory page (components/memory-journal.tsx).
export type MemorySkill = "build" | "create" | "business" | "life";
export const MEMORY_SKILLS: MemorySkill[] = ["build", "create", "business", "life"];

export type MemoryType = "fact" | "preference" | "decision" | "goal" | "person" | "howto";
export const MEMORY_TYPES: MemoryType[] = ["fact", "preference", "decision", "goal", "person", "howto"];

export type UserMemory = {
  id: string;
  text: string; // the memory itself, one or two sentences
  detail?: string; // optional longer context: why, where it came from, examples
  skill: MemorySkill;
  type: MemoryType;
  tags: string[];
  importance: 1 | 2 | 3;
  pinned: boolean; // pinned memories go into every agent's brief
  createdAt: string;
  updatedAt: string;
};

export type MemoryInput = Partial<Pick<UserMemory, "text" | "detail" | "skill" | "type" | "tags" | "importance" | "pinned">>;

const file = () => path.join(DATA_DIR, "memories.json");

const clip = (s: unknown, n: number) => (typeof s === "string" ? s.trim().slice(0, n) : "");
const cleanTags = (v: unknown) =>
  [...new Set((Array.isArray(v) ? v : []).map((t) => clip(t, 32).toLowerCase().replace(/^#/, "").replace(/\s+/g, "-")).filter(Boolean))].slice(0, 8);
const cleanImportance = (v: unknown): 1 | 2 | 3 => (v === 1 || v === 3 ? v : 2);
const validDate = (v: unknown) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? v : new Date(0).toISOString());

// The file may predate the current shape (or be hand-edited): every field is checked on the way in.
function normalize(raw: unknown): UserMemory | null {
  const m = raw as Partial<UserMemory> | null;
  const text = clip(m?.text, 2000);
  if (!m || typeof m.id !== "string" || !text) return null;
  const detail = clip(m?.detail, 6000);
  return {
    id: m.id,
    text,
    ...(detail ? { detail } : {}),
    skill: MEMORY_SKILLS.includes(m?.skill as MemorySkill) ? (m.skill as MemorySkill) : "life",
    type: MEMORY_TYPES.includes(m?.type as MemoryType) ? (m.type as MemoryType) : "fact",
    tags: cleanTags(m?.tags),
    importance: cleanImportance(m?.importance),
    pinned: m?.pinned === true,
    createdAt: validDate(m?.createdAt),
    updatedAt: validDate(m?.updatedAt ?? m?.createdAt),
  };
}

// null = the file exists but can't be parsed: readers see nothing, writers refuse rather than overwrite it.
function load(): unknown[] | null {
  let text: string;
  try {
    text = fs.readFileSync(file(), "utf8");
  } catch {
    return [];
  }
  try {
    const raw = JSON.parse(text) as { items?: unknown } | null;
    return Array.isArray(raw?.items) ? raw.items : [];
  } catch {
    return null;
  }
}

export function listMemories(): UserMemory[] {
  return (load() ?? [])
    .map(normalize)
    .filter((m): m is UserMemory => !!m)
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt));
}

function save(items: UserMemory[]) {
  if (load() === null) throw new Error("data/memories.json is unreadable — fix or move it before saving more.");
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const f = file();
  fs.writeFileSync(`${f}.tmp`, JSON.stringify({ version: 1, items }, null, 2));
  fs.renameSync(`${f}.tmp`, f);
}

export function addMemory(input: MemoryInput): UserMemory {
  const text = clip(input.text, 2000);
  if (!text) throw new Error("Write the memory first.");
  const now = new Date().toISOString();
  const m = normalize({ detail: input.detail, skill: input.skill, type: input.type, tags: input.tags, importance: input.importance, pinned: input.pinned, text, id: `m-${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`, createdAt: now, updatedAt: now })!;
  const items = listMemories();
  if (items.length >= 2000) throw new Error("Memory is full (2,000 entries) — delete a few first.");
  save([m, ...items]);
  return m;
}

export function updateMemory(id: string, input: MemoryInput): UserMemory | null {
  const items = listMemories();
  const i = items.findIndex((m) => m.id === id);
  if (i < 0) return null;
  const EDITABLE = ["text", "detail", "skill", "type", "tags", "importance", "pinned"];
  const changes = Object.fromEntries(Object.entries(input ?? {}).filter(([k, v]) => EDITABLE.includes(k) && v !== undefined));
  const next = normalize({ ...items[i], ...changes, id, updatedAt: new Date().toISOString() });
  if (!next) throw new Error("A memory can't be empty.");
  items[i] = next;
  save(items);
  return next;
}

export function deleteMemory(id: string): boolean {
  const items = listMemories();
  const rest = items.filter((m) => m.id !== id);
  if (rest.length === items.length) return false;
  save(rest);
  return true;
}

// For the agents' brief: pinned memories, most important first, capped so a long list can't swamp the task.
export function pinnedForBrief(max = 3000): string {
  const lines: string[] = [];
  let used = 0;
  const pinned = listMemories()
    .filter((m) => m.pinned)
    .sort((a, b) => b.importance - a.importance || b.updatedAt.localeCompare(a.updatedAt));
  for (const m of pinned) {
    const line = `- (${m.skill}, ${m.type}) ${m.text.replace(/\s+/g, " ")}`;
    if (used + line.length > max) break;
    lines.push(line);
    used += line.length;
  }
  return lines.join("\n");
}
