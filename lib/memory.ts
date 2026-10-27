import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./config";
import { groqJSON } from "./groq";
import { recentIssues } from "./linear";
import { listMemories } from "./memories";
import { listJobs } from "./store";

// Memory: one searchable index over everything Lind's agents and notes know, answered with sources.
// - chat:     dashboard chats (Claude / Codex / OpenCode / Hermes turns, hand-offs)
// - linear:   recent Linear issues
// - obsidian: the lind-brain vault Syncthing keeps on the VPS (MEMORY_VAULT_DIR)
// - notes:    Claude Code memory notes pushed up from the PC (handoff/sync-notes.mjs → data/notes)
// - mine:     memories Lind typed in on the Memory page (lib/memories.ts → data/memories.json)
// Retrieval is plain BM25 (no embeddings to host); Groq writes the answer from the top chunks only.

export type SourceKind = "mine" | "chat" | "linear" | "obsidian" | "notes";
export const SOURCE_KINDS: SourceKind[] = ["mine", "chat", "linear", "obsidian", "notes"];

type Doc = { id: string; kind: SourceKind; title: string; href?: string; at: string; text: string };
type Chunk = { doc: Doc; text: string; tf: Map<string, number>; len: number };

export type Source = { n: number; kind: SourceKind; title: string; href?: string; at: string; snippet: string };
export type MemoryAnswer = { answer: string; sources: Source[] };
export type MemoryStats = { counts: Record<SourceKind, number>; weeks: { start: string; counts: Record<SourceKind, number> }[]; vault: boolean };

const vaultDir = () => process.env.MEMORY_VAULT_DIR ?? "/home/ubuntu/.hermes/syncthing-sync/lind-brain";
// Obsidian knows the vault by its folder name on the PC ("Lind Brain"), not the VPS path.
const vaultName = () => process.env.MEMORY_VAULT_NAME ?? "Lind Brain";
export const notesDir = () => path.join(DATA_DIR, "notes");

const STOP = new Set(
  "the a an and or of to in on for is are was were be it this that with as at by from i you we my me what when where who how why did do does not no yes can could should would will about into than then there their them they have has had our your just also but if so all any some one two dhe e te të në per për me se si qe që nje një ka ishte jane janë nuk po do".split(" "),
);

// Diacritics folded so "ë"/"e" and "ç"/"c" match — notes mix Albanian with and without them.
export const tokens = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 1 && !STOP.has(t));

function walk(dir: string, out: string[] = []): string[] {
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name.startsWith(".")) continue; // .obsidian, .trash, .stfolder
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith(".md")) out.push(p);
  }
  return out;
}

const read = (p: string) => {
  try {
    return { text: fs.readFileSync(p, "utf8"), at: fs.statSync(p).mtime.toISOString() };
  } catch {
    return null;
  }
};

function chatDocs(): Doc[] {
  return listJobs().map((j) => ({
    id: `chat:${j.id}`,
    kind: "chat" as const,
    title: `${j.title} · ${j.agent}`,
    href: `/jobs/${j.id}`,
    at: j.updatedAt ?? j.createdAt,
    text: [j.description, ...(j.turns ?? []).flatMap((t) => [`Lind: ${t?.prompt ?? ""}`, `${j.agent}: ${t?.result ?? ""}`])].filter(Boolean).join("\n\n"),
  }));
}

// Linear is the one slow source, so it keeps its own 10-minute cache: adding a memory rebuilds the
// index without another round trip.
let linearCache: { at: number; docs: Doc[] } | null = null;
async function linearDocs(): Promise<Doc[]> {
  if (linearCache && Date.now() - linearCache.at < 10 * 60_000) return linearCache.docs;
  const issues = await recentIssues(150).catch(() => []);
  const docs = issues.map((i) => ({
    id: `linear:${i.identifier}`,
    kind: "linear" as const,
    title: `${i.identifier} ${i.title}`,
    href: i.url,
    at: i.updatedAt,
    text: `${i.title}\n${i.state?.name ? `Status: ${i.state.name}\n` : ""}${i.description ?? ""}`,
  }));
  linearCache = { at: Date.now(), docs };
  return docs;
}

function mineDocs(): Doc[] {
  return listMemories().map((m) => ({
    id: `mine:${m.id}`,
    kind: "mine" as const,
    title: m.text.length > 80 ? `${m.text.slice(0, 79)}…` : m.text,
    href: `/memory?m=${encodeURIComponent(m.id)}`,
    at: m.updatedAt,
    text: [m.text, m.detail, `Skill: ${m.skill} · ${m.type}${m.pinned ? " · pinned" : ""}`, m.tags.length ? m.tags.map((t) => `#${t}`).join(" ") : ""].filter(Boolean).join("\n\n"),
  }));
}

function vaultDocs(): Doc[] {
  const root = vaultDir();
  return walk(root).flatMap((p) => {
    const f = read(p);
    if (!f) return [];
    const rel = path.relative(root, p).replace(/\\/g, "/");
    return [
      {
        id: `obsidian:${rel}`,
        kind: "obsidian" as const,
        title: rel.replace(/\.md$/, ""),
        href: `obsidian://open?vault=${encodeURIComponent(vaultName())}&file=${encodeURIComponent(rel.replace(/\.md$/, ""))}`,
        at: f.at,
        text: f.text,
      },
    ];
  });
}

function noteDocs(): Doc[] {
  return walk(notesDir()).flatMap((p) => {
    const f = read(p);
    if (!f || path.basename(p) === "MEMORY.md") return []; // the index only points at the notes
    const name = f.text.match(/^name:\s*(.+)$/m)?.[1]?.trim();
    const modified = f.text.match(/^\s*modified:\s*(\S+)/m)?.[1];
    return [
      {
        id: `notes:${path.basename(p)}`,
        kind: "notes" as const,
        title: name ?? path.basename(p, ".md"),
        at: modified && !Number.isNaN(Date.parse(modified)) ? new Date(modified).toISOString() : f.at,
        text: f.text.replace(/^---[\s\S]*?---\s*/, ""),
      },
    ];
  });
}

// ~900-char chunks on paragraph boundaries; the title rides along so it counts in every chunk.
function chunk(doc: Doc): Chunk[] {
  const paras = doc.text.split(/\n\s*\n/);
  const parts: string[] = [];
  let cur = "";
  for (const p of paras) {
    if (cur && cur.length + p.length > 900) {
      parts.push(cur);
      cur = "";
    }
    cur = cur ? `${cur}\n\n${p}` : p;
  }
  if (cur.trim() || !parts.length) parts.push(cur);
  return parts.map((text) => {
    const toks = [...tokens(doc.title), ...tokens(doc.title), ...tokens(text)];
    const tf = new Map<string, number>();
    for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1);
    return { doc, text: text.trim(), tf, len: toks.length };
  });
}

type Index = { at: number; docs: Doc[]; chunks: Chunk[]; df: Map<string, number>; avg: number };
let cache: Index | null = null;
let building: Promise<Index> | null = null;

async function index(): Promise<Index> {
  if (cache && Date.now() - cache.at < 10 * 60_000) return cache;
  building ??= (async () => {
    const docs = [...mineDocs(), ...chatDocs(), ...(await linearDocs()), ...vaultDocs(), ...noteDocs()];
    const chunks = docs.flatMap(chunk);
    const df = new Map<string, number>();
    for (const c of chunks) for (const t of c.tf.keys()) df.set(t, (df.get(t) ?? 0) + 1);
    const avg = chunks.reduce((s, c) => s + c.len, 0) / Math.max(1, chunks.length);
    cache = { at: Date.now(), docs, chunks, df, avg };
    return cache;
  })().finally(() => (building = null));
  return building;
}

export function invalidateMemory() {
  cache = null;
}

function search(ix: Index, q: string, k: number): Chunk[] {
  const qt = [...new Set(tokens(q))];
  if (!qt.length) return [];
  const N = ix.chunks.length;
  const scored = ix.chunks
    .map((c) => {
      let s = 0;
      for (const t of qt) {
        const f = c.tf.get(t);
        if (!f) continue;
        const idf = Math.log(1 + (N - (ix.df.get(t) ?? 0) + 0.5) / ((ix.df.get(t) ?? 0) + 0.5));
        s += (idf * f * 2.2) / (f + 1.2 * (0.25 + (0.75 * c.len) / ix.avg));
      }
      return { c, s };
    })
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s);
  // At most two chunks per document, so one long note can't crowd out everything else.
  const per = new Map<string, number>();
  const out: Chunk[] = [];
  for (const { c } of scored) {
    const n = per.get(c.doc.id) ?? 0;
    if (n >= 2) continue;
    per.set(c.doc.id, n + 1);
    out.push(c);
    if (out.length >= k) break;
  }
  return out;
}

export async function askMemory(q: string): Promise<MemoryAnswer> {
  const hits = search(await index(), q, 10);
  if (!hits.length) return { answer: "Nothing in memory matches that. Try other words — a project name, a person, a file.", sources: [] };
  const sources: Source[] = hits.map((h, i) => ({
    n: i + 1,
    kind: h.doc.kind,
    title: h.doc.title,
    href: h.doc.href,
    at: h.doc.at,
    snippet: h.text.replace(/\s+/g, " ").slice(0, 280),
  }));
  const context = hits.map((h, i) => `[${i + 1}] (${h.doc.kind}, ${h.doc.at.slice(0, 10)}) ${h.doc.title}\n${h.text.slice(0, 1800)}`).join("\n\n---\n\n");
  const out = await groqJSON<{ answer: string; used: number[] }>(
    `You answer Lind's question from his own notes, chats, tickets and the memories he wrote down — only from the numbered sources given.
Return JSON: {"answer": string, "used": number[]}.
- answer: short markdown, in the question's language. Cite sources inline like [2] after the claim they support.
- If the sources don't answer it, say so plainly and mention what they do cover. Never invent facts.
- Prefer newer sources when they disagree, and say they disagree. Sources marked "mine" are memories Lind wrote himself: trust them most.
- used: the source numbers you cited.`,
    `Question: ${q}\n\nSources:\n\n${context}`,
  );
  if (!out?.answer) return { answer: "Found these, but couldn't write an answer right now (Groq is out of quota) — the sources are below.", sources };
  const used = new Set((out.used ?? []).filter((n) => typeof n === "number"));
  for (const m of out.answer.matchAll(/\[(\d+)\]/g)) used.add(Number(m[1]));
  // Cited sources first, then the rest as "also matched".
  return { answer: out.answer, sources: [...sources.filter((s) => used.has(s.n)), ...sources.filter((s) => !used.has(s.n))] };
}

export async function memoryStats(): Promise<MemoryStats> {
  const ix = await index();
  const zero = (): Record<SourceKind, number> => ({ mine: 0, chat: 0, linear: 0, obsidian: 0, notes: 0 });
  const counts = zero();
  for (const d of ix.docs) counts[d.kind]++;
  // Twelve weeks of activity: what was written or changed when, by source.
  const monday = new Date();
  monday.setUTCHours(0, 0, 0, 0);
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  const weeks = Array.from({ length: 12 }, (_, i) => {
    const s = new Date(monday);
    s.setUTCDate(s.getUTCDate() - 7 * (11 - i));
    return { start: s.toISOString().slice(0, 10), counts: zero() };
  });
  for (const d of ix.docs) {
    const t = Date.parse(d.at);
    if (Number.isNaN(t)) continue;
    const w = Math.floor((t - Date.parse(weeks[0].start)) / (7 * 86_400_000));
    if (w >= 0 && w < 12) weeks[w].counts[d.kind]++;
  }
  return { counts, weeks, vault: fs.existsSync(vaultDir()) && counts.obsidian > 0 };
}
