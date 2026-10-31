import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./config";
import { PILES, readMail, readPiles } from "./gmail";
import { readGoals } from "./goals";
import { groqJSON } from "./groq";
import { libraryDir, listItems, readSections, readSourceToggles } from "./library";
import { recentIssues } from "./linear";
import { listJobs } from "./store";

// Memory: one searchable index over everything Lind's agents and notes know, answered with sources.
// - chat:     dashboard chats (Claude / Codex / OpenCode / Hermes turns, hand-offs)
// - linear:   recent Linear issues
// - obsidian: the lind-brain vault Syncthing keeps on the VPS (MEMORY_VAULT_DIR)
// - notes:    Claude Code memory notes pushed up from the PC (handoff/sync-notes.mjs → data/notes)
// - capture:  the Library — everything captured on /memory (text, voice, images, video, links)
// - mail:     the last week of Gmail (subject, sender, snippet)
// v5 adds:
// - pcchat:   Claude Code / Codex sessions from the PC (the brain's vault pages, wiki/sources/chats)
// - github:   PRs and issues (runner/sources.ts → data/sources/github.json) + nightly commit pages
// - calendar: Google Calendar events (60 days back, 14 ahead), day plans with what got done, coach
//             recaps and the Day assistant's briefings
// - web:      saved links and YouTube videos, as full text (Firecrawl / Supadata transcripts)
// Records are also linked through the projects, people and topics they mention (entities), which is
// what the Visual cortex draws as the web between them.
// Retrieval is plain BM25 (no embeddings to host); Groq writes the answer from the top chunks only.

export type SourceKind = "capture" | "chat" | "linear" | "obsidian" | "notes" | "mail" | "pcchat" | "github" | "calendar" | "web";
export const SOURCE_KINDS: SourceKind[] = ["capture", "web", "chat", "pcchat", "github", "linear", "calendar", "obsidian", "notes", "mail"];
const zero = (): Record<SourceKind, number> => Object.fromEntries(SOURCE_KINDS.map((k) => [k, 0])) as Record<SourceKind, number>;

type Doc = { id: string; kind: SourceKind; title: string; href?: string; at: string; text: string; group?: string; tags?: string[]; people?: string[] };
type Chunk = { doc: Doc; text: string; tf: Map<string, number>; len: number };

export type Source = { n: number; kind: SourceKind; title: string; href?: string; at: string; snippet: string };
export type MemoryAnswer = { answer: string; sources: Source[] };
export type MemoryStats = { counts: Record<SourceKind, number>; weeks: { start: string; counts: Record<SourceKind, number> }[]; vault: boolean; enabled: Record<SourceKind, boolean> };
// One dot in the Visual cortex: group = a Library section, a mail pile, or the source kind.
export type GraphNode = { id: string; kind: SourceKind; group: string; title: string; at: string; href?: string; ents?: number[] };
export type GraphEntity = { id: number; label: string; type: "project" | "person" | "topic"; count: number };

const vaultDir = () => process.env.MEMORY_VAULT_DIR ?? "/home/ubuntu/.hermes/syncthing-sync/lind-brain";
// Obsidian knows the vault by its folder name on the PC ("Lind Brain"), not the VPS path.
const vaultName = () => process.env.MEMORY_VAULT_NAME ?? "Lind Brain";
export const notesDir = () => path.join(DATA_DIR, "notes");
export const memoryInboxDir = () => path.join(vaultDir(), "100 - Me", "memory", "inbox");

const slug = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "note";

// "Remember this" from the dashboard: one markdown file in the Syncthing vault inbox. Never write to
// data/notes — the PC sync replaces that folder wholesale on every upload, so anything added there
// would vanish. Returns the file name so the UI can be honest about where it went.
export function captureMemory(text: string): { ok: true; file: string } | { ok: false; error: string } {
  const body = text.trim();
  if (!body) return { ok: false, error: "Nothing to remember." };
  const tz = process.env.DASHBOARD_TZ ?? "Europe/Belgrade";
  const now = new Date();
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now).map((x) => [x.type, x.value]));
  const stamp = `${p.year}-${p.month}-${p.day}-${p.hour}${p.minute}`;
  const name = body.split("\n")[0].replace(/[#*_`>[\]]/g, "").trim().slice(0, 90) || "Memory";
  const dir = memoryInboxDir();
  let file = path.join(dir, `${stamp}-${slug(name)}.md`);
  try {
    fs.mkdirSync(dir, { recursive: true });
    let n = 2;
    while (fs.existsSync(file)) file = path.join(dir, `${stamp}-${slug(name)}-${n++}.md`);
    const md = ["---", `name: ${JSON.stringify(name)}`, `modified: ${now.toISOString()}`, "tags: [me, inbox]", "---", "", body, ""].join("\n");
    fs.writeFileSync(file, md);
    invalidateMemory();
    return { ok: true, file: path.basename(file) };
  } catch (err) {
    return { ok: false, error: `The vault isn't writable: ${err instanceof Error ? err.message : String(err)}` };
  }
}

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

async function linearDocs(): Promise<Doc[]> {
  const issues = await recentIssues(150).catch(() => []);
  return issues.map((i) => ({
    id: `linear:${i.identifier}`,
    kind: "linear" as const,
    title: `${i.identifier} ${i.title}`,
    href: i.url,
    at: i.updatedAt,
    text: `${i.title}\n${i.state?.name ? `Status: ${i.state.name}\n` : ""}${i.description ?? ""}`,
  }));
}

// Vault folders the brain writes, as their own sources: PC agent chats and GitHub commit/graph pages.
const vaultKind = (rel: string): SourceKind => (rel.startsWith("wiki/sources/chats/") ? "pcchat" : rel.startsWith("wiki/sources/commits/") || rel.startsWith("wiki/sources/graphs/") ? "github" : "obsidian");

function vaultDocs(): Doc[] {
  const root = vaultDir();
  return walk(root).flatMap((p) => {
    const f = read(p);
    // Library items mirrored into the vault are already indexed as captures.
    if (!f || /^dashboard: "\/memory\?item=/m.test(f.text.slice(0, 600))) return [];
    const rel = path.relative(root, p).replace(/\\/g, "/");
    // Plan notes mirror data/plans, which the calendar source reads with what actually got done.
    if (rel.startsWith("100 - Me/plans/")) return [];
    const kind = vaultKind(rel);
    const tags = f.text.slice(0, 600).match(/^tags:\s*\[([^\]]*)\]/m)?.[1]?.split(",").map((t) => t.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
    return [
      {
        id: `obsidian:${rel}`,
        kind,
        group: kind === "obsidian" ? rel.split("/")[0] : undefined,
        tags,
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
    const name = f.text.match(/^name:\s*(.+)$/m)?.[1]?.trim()?.replace(/^"(.*)"$/, "$1");
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

function captureDocs(): Doc[] {
  return listItems()
    .filter((i) => i.status === "ready" || i.text || i.note)
    .map((i) => ({
      id: `capture:${i.id}`,
      kind: (i.kind === "link" ? "web" : "capture") as SourceKind,
      tags: i.tags,
      group: i.section ?? "unsorted",
      title: i.title || i.kind,
      href: `/memory?item=${i.id}`,
      at: i.createdAt,
      text: [i.summary, i.note, i.text, i.url, i.tags.length ? `Tags: ${i.tags.join(", ")}` : ""].filter(Boolean).join("\n\n"),
    }));
}

function mailDocs(): Doc[] {
  const piles = readPiles();
  return readMail().messages.map((m) => ({
    id: `mail:${m.id}`,
    kind: "mail" as const,
    group: piles[m.id]?.pile ?? "mail",
    title: `${m.subject} — ${m.from}`,
    people: m.from ? [m.from] : [],
    href: m.link ?? `https://mail.google.com/mail/u/0/#inbox/${m.threadId}`,
    at: m.at,
    text: `From: ${m.from} <${m.fromEmail}>\nSubject: ${m.subject}\n${m.snippet}${m.attachments?.length ? `\nAttachments: ${m.attachments.join(", ")}` : ""}`,
  }));
}

function readSource<T>(name: string): T[] {
  try {
    const v = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "sources", name), "utf8"));
    return Array.isArray(v?.items) ? v.items : [];
  } catch {
    return [];
  }
}

function githubDocs(): Doc[] {
  return readSource<{ id: string; kind: "pr" | "issue"; repo: string; number: number; title: string; body: string; state: string; url: string; at: string; author: string; labels: string[] }>("github.json").map((g) => ({
    id: `github:${g.id}`,
    kind: "github" as const,
    group: g.repo,
    title: `${g.repo} ${g.kind === "pr" ? "PR" : "issue"} #${g.number} ${g.title}`,
    href: g.url,
    at: g.at,
    tags: [g.repo, ...g.labels],
    text: `${g.title}\n${g.kind === "pr" ? "Pull request" : "Issue"} in ${g.repo}, ${g.state}${g.labels.length ? `, labels: ${g.labels.join(", ")}` : ""}\n\n${g.body}`,
  }));
}

function readDir(dir: string, re: RegExp): { name: string; json: Record<string, unknown> }[] {
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => re.test(f))
      .flatMap((f) => {
        try {
          return [{ name: f, json: JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) }];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

// What Lind's days looked like: events, the plan with what got done, the recap and the briefings.
function calendarDocs(): Doc[] {
  const since = new Date(Date.now() - 120 * 86_400_000).toISOString().slice(0, 10);
  const events = readSource<{ id: string; title: string; start: string; end: string; allDay: boolean; location?: string; description?: string; link?: string; planned: boolean }>("calendar.json")
    .filter((e) => !e.planned)
    .map((e) => ({
      id: `calendar:${e.id}:${e.start}`,
      kind: "calendar" as const,
      group: "events",
      title: `${e.title} · ${e.start.slice(0, 10)}`,
      href: e.link,
      at: e.start.length > 10 ? e.start : `${e.start}T09:00:00Z`,
      text: `${e.title}\n${e.allDay ? e.start : `${e.start.slice(0, 16).replace("T", " ")} – ${e.end.slice(11, 16)}`}${e.location ? `\nWhere: ${e.location}` : ""}${e.description ? `\n\n${e.description}` : ""}`,
    }));
  const plans = readDir(path.join(DATA_DIR, "plans"), /^\d{4}-\d{2}-\d{2}\.json$/)
    .filter((p) => p.name.slice(0, 10) >= since)
    .map(({ name, json }) => {
      const day = name.slice(0, 10);
      const blocks = (Array.isArray(json.blocks) ? json.blocks : []) as { start?: string; end?: string; title?: string; status?: string }[];
      return {
        id: `calendar:plan:${day}`,
        kind: "calendar" as const,
        group: "plans",
        title: `Day plan · ${day}`,
        href: "/calendar",
        at: `${day}T07:00:00Z`,
        text: `Plan for ${day}${json.summary ? ` — ${json.summary}` : ""}\n${blocks.map((b) => `- ${b.start}–${b.end} ${b.title} (${b.status})`).join("\n")}`,
      };
    });
  const recaps = readDir(path.join(DATA_DIR, "coach"), /^recap-\d{4}-\d{2}-\d{2}\.json$/).map(({ name, json }) => {
    const day = name.slice(6, 16);
    return {
      id: `calendar:recap:${day}`,
      kind: "calendar" as const,
      group: "plans",
      title: `Recap · ${day} · ${json.score}/100`,
      href: `/goals?recap=${day}`,
      at: `${day}T21:30:00Z`,
      text: `Day recap ${day}: score ${json.score}/100, ${json.done}/${json.total} blocks, ${json.focusMin} focus minutes.\n${json.note ?? ""}\nSkipped: ${(Array.isArray(json.skipped) ? json.skipped : []).join("; ")}`,
    };
  });
  const briefs = readDir(path.join(DATA_DIR, "assistant"), /^brief-\d{4}-\d{2}-\d{2}-\w+\.json$/).map(({ name, json }) => ({
    id: `calendar:brief:${name}`,
    kind: "calendar" as const,
    group: "plans",
    title: `${String(json.slot ?? "")} briefing · ${String(json.day ?? "")} · ${String(json.headline ?? "")}`,
    href: "/calendar#assistant",
    at: String(json.createdAt ?? new Date().toISOString()),
    text: `${json.headline}\n${(Array.isArray(json.focus) ? json.focus : []).join("; ")}\n\n${json.body ?? ""}`,
  }));
  // The journal (v5.1): Lind's own words about each day.
  const journal = readDir(path.join(DATA_DIR, "journal"), /^\d{4}-\d{2}-\d{2}\.json$/).map(({ name, json }) => {
    const day = name.slice(0, 10);
    const entries = (Array.isArray(json.entries) ? json.entries : []) as { text?: string; at?: string }[];
    return {
      id: `calendar:journal:${day}`,
      kind: "calendar" as const,
      group: "journal",
      title: `Journal · ${day}`,
      href: "/buddy",
      at: entries.at(-1)?.at ?? `${day}T21:00:00Z`,
      text: entries.map((e) => e.text ?? "").join("\n\n"),
    };
  });
  return [...events, ...plans, ...recaps, ...briefs, ...journal];
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

type Index = { at: number; stamp: string; docs: Doc[]; chunks: Chunk[]; df: Map<string, number>; avg: number; graph?: { entities: GraphEntity[]; links: Map<string, number[]> } };

// The runner files captures and fetches mail in another process; their files' mtimes tell this
// one to rebuild without waiting out the 10 minutes.
const mtime = (p: string) => {
  try {
    return fs.statSync(p).mtimeMs;
  } catch {
    return 0;
  }
};
const changeStamp = () =>
  [path.join(libraryDir(), "items"), path.join(libraryDir(), "sections.json"), path.join(DATA_DIR, "mail", "messages.json"), path.join(DATA_DIR, "mail", "piles.json"), path.join(DATA_DIR, "sources", "github.json"), path.join(DATA_DIR, "sources", "calendar.json"), path.join(DATA_DIR, "plans")].map(mtime).join(":");
let cache: Index | null = null;
let building: Promise<Index> | null = null;

async function index(): Promise<Index> {
  const stamp = changeStamp();
  if (cache && Date.now() - cache.at < 10 * 60_000 && cache.stamp === stamp) return cache;
  building ??= (async () => {
    const docs = [...captureDocs(), ...chatDocs(), ...(await linearDocs()), ...vaultDocs(), ...noteDocs(), ...mailDocs(), ...githubDocs(), ...calendarDocs()];
    const chunks = docs.flatMap(chunk);
    const df = new Map<string, number>();
    for (const c of chunks) for (const t of c.tf.keys()) df.set(t, (df.get(t) ?? 0) + 1);
    const avg = chunks.reduce((s, c) => s + c.len, 0) / Math.max(1, chunks.length);
    cache = { at: Date.now(), stamp, docs, chunks, df, avg };
    return cache;
  })().finally(() => (building = null));
  return building;
}

export function invalidateMemory() {
  cache = null;
}

export const enabledSources = (): Record<SourceKind, boolean> => {
  const t = readSourceToggles();
  return Object.fromEntries(SOURCE_KINDS.map((k) => [k, t[k] !== false])) as Record<SourceKind, boolean>;
};

function search(ix: Index, q: string, k: number): Chunk[] {
  const qt = [...new Set(tokens(q))];
  if (!qt.length) return [];
  const on = enabledSources();
  const N = ix.chunks.length;
  const scored = ix.chunks
    .filter((c) => on[c.doc.kind])
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
    `You answer Lind's question from his own notes, chats and tickets — only from the numbered sources given.
Return JSON: {"answer": string, "used": number[]}.
- answer: short markdown, in the question's language. Cite sources inline like [2] after the claim they support.
- If the sources don't answer it, say so plainly and mention what they do cover. Never invent facts.
- Prefer newer sources when they disagree, and say they disagree.
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
  return { counts, weeks, vault: fs.existsSync(vaultDir()) && counts.obsidian > 0, enabled: enabledSources() };
}

export type GraphGroup = { key: string; label: string; kind: SourceKind; hue?: number };

const GROUP_LABEL: Partial<Record<SourceKind, string>> = { chat: "Agent chats", linear: "Linear", notes: "Claude notes", pcchat: "PC chats", web: "Web & video" };

// ---- entities: the projects, people and topics records share --------------------------------------

// Words that show up as tags or [[links]] everywhere but don't name a project, person or topic.
const ENTITY_STOP = new Set(
  "me inbox plan plans memory notes note todo misc daily index log logs source sources chat chats obsidian readme agents agent claude codex content verification workflow workflows can will should done work task tasks project projects idea ideas people person summary overview status changelog docs doc wiki concept concepts entity entities maintenance draft drafts template templates archive test tests decisions decision data context home scratchpad workspace journal reference synthesis lint personal learning tools general other".split(" "),
);
// File-like names ("README", "AGENTS", "CLAUDE.md") are documents, not topics.
const looksLikeFile = (s: string) => /^[A-Z0-9_-]{3,}$/.test(s) || /\.(md|ts|tsx|js|json|py)$/i.test(s);

// Names worth linking on: repos and their Linear/brain projects, goal titles, Library sections, the
// vault's entity pages, [[wikilinks]], tags and mail senders. A name only becomes a hub when at least
// two records mention it.
function extractEntities(docs: Doc[]): { entities: GraphEntity[]; links: Map<string, number[]> } {
  const dict = new Map<string, { label: string; type: GraphEntity["type"]; re: RegExp }>();
  const add = (label: string, type: GraphEntity["type"]) => {
    const clean = label.replace(/^Project - /, "").trim();
    const key = fold(clean);
    if (key.length < (type === "topic" ? 4 : 3) || ENTITY_STOP.has(key) || STOP.has(key) || looksLikeFile(clean) || dict.has(key)) return;
    const esc = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    dict.set(key, { label: clean, type, re: new RegExp(`(^|[^\\p{L}\\p{N}])${esc}($|[^\\p{L}\\p{N}])`, "u") });
  };
  for (const d of docs) {
    if (d.kind === "github" && d.group) add(d.group, "project");
    const m = d.id.match(/^obsidian:wiki\/entities\/(.+)\.md$/);
    if (m) add(m[1], m[1].startsWith("Project - ") ? "project" : "topic");
  }
  for (const s of readSections()) add(s.name, "topic");
  for (const g of readGoals()) add(g.title, "project");
  const tagCount = new Map<string, number>();
  const personCount = new Map<string, number>();
  for (const d of docs) {
    for (const t of d.tags ?? []) tagCount.set(fold(t), (tagCount.get(fold(t)) ?? 0) + 1);
    for (const p of d.people ?? []) personCount.set(p, (personCount.get(p) ?? 0) + 1);
    for (const w of d.text.slice(0, 20_000).matchAll(/\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g)) add(w[1].split("/").pop() ?? w[1], "topic");
  }
  for (const [t, n] of tagCount) if (n >= 3) add(t, "topic");
  // Senders by name; a bare address (often Lind's own) isn't a person to link on.
  for (const [p, n] of personCount) if (n >= 2 && !p.includes("@") && !/noreply|no-reply|notification/i.test(p)) add(p, "person");

  const ids = new Map<string, number>();
  const entities: GraphEntity[] = [];
  const links = new Map<string, number[]>();
  const list = [...dict.entries()];
  for (const d of docs) {
    const hay = fold(`${d.title}\n${(d.tags ?? []).join(" ")}\n${(d.people ?? []).join(" ")}\n${d.text.slice(0, 3000)}`);
    const hit: number[] = [];
    for (const [key, e] of list) {
      if (!hay.includes(key) || !e.re.test(hay)) continue;
      let id = ids.get(key);
      if (id === undefined) {
        id = entities.length;
        ids.set(key, id);
        entities.push({ id, label: e.label, type: e.type, count: 0 });
      }
      entities[id].count++;
      hit.push(id);
      if (hit.length >= 8) break;
    }
    if (hit.length) links.set(d.id, hit);
  }
  // Hubs: shared by 2+ records but not by nearly everything (that's noise, not a link).
  const keep = new Set(entities.filter((e) => e.count >= 2 && e.count <= Math.max(40, docs.length * 0.15)).sort((a, z) => z.count - a.count).slice(0, 90).map((e) => e.id));
  for (const [k, v] of links) {
    const f = v.filter((x) => keep.has(x));
    if (f.length) links.set(k, f);
    else links.delete(k);
  }
  return { entities: entities.filter((e) => keep.has(e.id)), links };
}

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

// The Visual cortex: captures grouped by section, mail by pile, GitHub by repo, the vault by top
// folder, the rest by source — plus the entity hubs and which records link to each.
export async function memoryGraph(): Promise<{ nodes: GraphNode[]; groups: GraphGroup[]; entities: GraphEntity[] }> {
  const ix = await index();
  ix.graph ??= extractEntities(ix.docs);
  const { entities, links } = ix.graph;
  const groupOf = (d: Doc) => (d.kind === "capture" ? `capture:${d.group}` : d.kind === "mail" ? `mail:${d.group}` : d.kind === "calendar" ? `calendar:${d.group}` : d.kind === "obsidian" ? `obsidian:${d.group}` : d.kind === "github" ? `github:${d.group ?? "commits"}` : d.kind);
  const nodes: GraphNode[] = ix.docs.map((d) => ({
    id: d.id,
    kind: d.kind,
    group: groupOf(d),
    title: d.title.slice(0, 140),
    at: d.at,
    href: d.href,
    ents: links.get(d.id),
  }));
  const seen = new Map<string, SourceKind>();
  for (const n of nodes) seen.set(n.group, n.kind);
  const fixed: GraphGroup[] = [
    ...readSections().map((s) => ({ key: `capture:${s.id}`, label: s.name, kind: "capture" as const, hue: s.hue })),
    { key: "capture:unsorted", label: "Unsorted", kind: "capture" },
    ...PILES.map((p) => ({ key: `mail:${p.key}`, label: `Mail · ${p.label}`, kind: "mail" as const })),
    { key: "mail:mail", label: "Mail · unsorted", kind: "mail" },
    { key: "calendar:events", label: "Calendar", kind: "calendar" },
    { key: "calendar:plans", label: "Plans & recaps", kind: "calendar" },
    { key: "calendar:journal", label: "Journal", kind: "calendar" },
  ];
  const known = new Set(fixed.map((g) => g.key));
  // Everything else gets a group named after its source (or vault folder) in the order it appears.
  const rest: GraphGroup[] = [...seen.entries()]
    .filter(([k]) => !known.has(k))
    .map(([key, kind]) => ({ key, kind, label: key.startsWith("obsidian:") ? `Vault · ${key.slice(9) || "root"}` : key.startsWith("github:") ? `GitHub · ${key.slice(7)}` : (GROUP_LABEL[kind] ?? kind) }));
  const order = (k: SourceKind) => SOURCE_KINDS.indexOf(k);
  const groups = [...fixed.filter((g) => seen.has(g.key)), ...rest].sort((a, z) => order(a.kind) - order(z.kind));
  return { nodes, groups, entities };
}
