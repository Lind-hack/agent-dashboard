import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./config";

// The Library: everything Lind throws at Memory — typed notes, voice, images, videos, files, links.
// One JSON per item in data/library/items, the media next to it in data/library/media. The runner
// (runner/library.ts) transcribes / describes each queued item and files it into a section; the
// web app only writes new items, edits and deletes.

export type ItemKind = "text" | "voice" | "image" | "video" | "audio" | "file" | "link";
export type ItemStatus = "queued" | "processing" | "ready" | "failed";

export type LibraryItem = {
  id: string;
  kind: ItemKind;
  status: ItemStatus;
  createdAt: string;
  updatedAt: string;
  title: string;
  summary: string;
  text: string; // what was typed, the transcript, or the description of an image/video
  note?: string; // what Lind typed along with a file
  tags: string[];
  section?: string; // section id
  media?: { file: string; mime: string; bytes: number; name?: string; poster?: string; duration?: number };
  url?: string; // kind "link"
  error?: string;
  attempts?: number;
  nextAt?: string; // retry not before
  waiting?: "vision"; // saved, but the description waits for GEMINI_API_KEY
  mirror?: string; // the vault note mirroring it (path relative to the vault)
  parent?: string; // a part of a memory dump: the dump's item id
  // A memory dump being split into parts (lib/dump.ts): windows read so far, of how many, and the parts.
  split?: { state: "splitting" | "done"; next: number; total: number; parts: string[]; fails?: number; context?: string };
};

export type Section = { id: string; name: string; description: string; hue: number; createdAt: string; createdBy: "core" | "lind" };

export const MAX_SECTIONS = 24;
export const MAX_UPLOAD = 200 * 1024 * 1024;

export const libraryDir = () => path.join(DATA_DIR, "library");
const itemsDir = () => path.join(libraryDir(), "items");
export const mediaDir = () => path.join(libraryDir(), "media");
export const uploadsDir = () => path.join(libraryDir(), "uploads");
const sectionsFile = () => path.join(libraryDir(), "sections.json");

const atomic = (file: string, data: string) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(3).toString("hex")}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
};

export const newId = () => `M-${Date.now().toString(36).toUpperCase()}${crypto.randomBytes(2).toString("hex").toUpperCase()}`;
export const validId = (id: string) => /^M-[A-Z0-9]{6,20}$/.test(id);

export function readItem(id: string): LibraryItem | null {
  if (!validId(id)) return null;
  try {
    const it = JSON.parse(fs.readFileSync(path.join(itemsDir(), `${id}.json`), "utf8")) as LibraryItem;
    // Older items may predate a field.
    return it?.id ? { ...it, tags: Array.isArray(it.tags) ? it.tags : [], title: it.title ?? "", summary: it.summary ?? "", text: it.text ?? "" } : null;
  } catch {
    return null;
  }
}

export function saveItem(it: LibraryItem) {
  it.updatedAt = new Date().toISOString();
  atomic(path.join(itemsDir(), `${it.id}.json`), JSON.stringify(it, null, 1));
}

export function listItems(): LibraryItem[] {
  let names: string[] = [];
  try {
    names = fs.readdirSync(itemsDir()).filter((n) => n.endsWith(".json"));
  } catch {
    return [];
  }
  return names
    .map((n) => readItem(n.slice(0, -5)))
    .filter((x): x is LibraryItem => !!x)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function deleteItem(id: string): boolean {
  const it = readItem(id);
  if (!it) return false;
  // A dump goes with its parts.
  if (it.split) for (const c of listItems()) if (c.parent === id) deleteItem(c.id);
  removeMirror(it);
  for (const f of [it.media?.file, it.media?.poster]) if (f) fs.rmSync(path.join(mediaDir(), path.basename(f)), { force: true });
  fs.rmSync(path.join(itemsDir(), `${id}.json`), { force: true });
  return true;
}

// What the browser gets in a list: long texts cut short (a dump's parts can add up to megabytes);
// the item sheet loads the whole item when it opens.
export const SLIM_TEXT = 300;
export const slimItem = (it: LibraryItem): LibraryItem => (it.text.length > SLIM_TEXT ? { ...it, text: it.text.slice(0, SLIM_TEXT) } : it);

export function createItem(fields: Partial<LibraryItem> & { kind: ItemKind }): LibraryItem {
  const now = new Date().toISOString();
  const it: LibraryItem = { id: newId(), status: "queued", createdAt: now, updatedAt: now, title: "", summary: "", text: "", tags: [], attempts: 0, ...fields };
  saveItem(it);
  return it;
}

// ---- the vault mirror ---------------------------------------------------------------------------
// A text note per item in the vault ("100 - Me/memory/<Section>/…"), so Obsidian and Hermes see it.
// Rewritten when the item is filed, renamed or moved; removed when it's deleted.

const vault = () => process.env.MEMORY_VAULT_DIR ?? "";
const insideVault = (rel: string) => {
  const root = path.resolve(vault());
  const p = path.resolve(root, rel);
  return p.startsWith(root + path.sep) ? p : null;
};

export function removeMirror(it: LibraryItem) {
  const p = it.mirror && vault() ? insideVault(it.mirror) : null;
  if (p) fs.rmSync(p, { force: true });
}

export function mirrorItem(it: LibraryItem) {
  const root = vault();
  if (!root || !fs.existsSync(root) || it.status === "queued" || it.status === "processing") return;
  const section = readSections().find((s) => s.id === it.section)?.name ?? "Unsorted";
  const safe = (s: string) => s.replace(/[\\/:*?"<>|#^[\]]/g, " ").replace(/\.+$/, "").replace(/\s+/g, " ").trim().slice(0, 70) || "Memory";
  const rel = path.posix.join("100 - Me", "memory", safe(section), `${it.createdAt.slice(0, 10)} ${safe(it.title)} ${it.id.slice(-4)}.md`);
  const target = insideVault(rel);
  if (!target) return;
  try {
    if (it.mirror && it.mirror !== rel) removeMirror(it);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const md = [
      "---",
      `name: ${JSON.stringify(it.title)}`,
      `modified: ${new Date().toISOString()}`,
      `kind: ${it.kind}`,
      `tags: [${["memory", ...it.tags].map((t) => JSON.stringify(t)).join(", ")}]`,
      `dashboard: "/memory?item=${it.id}"`,
      "---",
      "",
      it.summary,
      "",
      it.url ? `Link: ${it.url}\n` : "",
      it.text,
      "",
    ].join("\n");
    fs.writeFileSync(target, md);
    it.mirror = rel;
  } catch {
    // The vault is best effort; the Library itself is the record.
  }
}

// ---- sections ----------------------------------------------------------------------------------

// A starting set so the first captures have somewhere sensible to go; the organiser adds more.
const SEED: [string, string][] = [
  ["Ideas", "Business, content and product ideas worth coming back to"],
  ["Projects", "Notes about things being built: 383, the dashboard, the agency"],
  ["People", "Who someone is, what they said, how to reach them"],
  ["Content", "TikTok hooks, scripts, references and inspiration for @building.ai"],
  ["Learning", "Things learned: CS, AI, tools, how-tos"],
  ["Personal", "Life admin, health, places, plans"],
];

export function readSections(): Section[] {
  try {
    const s = JSON.parse(fs.readFileSync(sectionsFile(), "utf8"));
    if (Array.isArray(s)) return s.filter((x) => x?.id && x?.name);
  } catch {
    /* first run */
  }
  const now = new Date().toISOString();
  const seeded = SEED.map(([name, description], i) => ({ id: slugId(name), name, description, hue: hueFor(i), createdAt: now, createdBy: "core" as const }));
  writeSections(seeded);
  return seeded;
}

export function writeSections(s: Section[]) {
  atomic(sectionsFile(), JSON.stringify(s, null, 1));
}

export const slugId = (name: string) =>
  name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "section";

// Spread hues around the wheel so neighbouring sections never look alike.
export const hueFor = (i: number) => Math.round((i * 137.508 + 280) % 360);

export function addSection(name: string, description: string, by: Section["createdBy"]): Section | null {
  const clean = name.replace(/\s+/g, " ").trim().slice(0, 40);
  if (!clean) return null;
  const all = readSections();
  const existing = all.find((s) => s.name.toLowerCase() === clean.toLowerCase() || s.id === slugId(clean));
  if (existing) return existing;
  if (all.length >= MAX_SECTIONS) return null;
  let id = slugId(clean);
  for (let n = 2; all.some((s) => s.id === id); n++) id = `${slugId(clean)}-${n}`;
  const s: Section = { id, name: clean, description: description.trim().slice(0, 160), hue: hueFor(all.length), createdAt: new Date().toISOString(), createdBy: by };
  writeSections([...all, s]);
  return s;
}

// ---- which sources Memory searches ------------------------------------------------------------

const sourcesFile = () => path.join(libraryDir(), "sources.json");

export function readSourceToggles(): Record<string, boolean> {
  try {
    const v = JSON.parse(fs.readFileSync(sourcesFile(), "utf8"));
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

export function setSourceToggle(kind: string, on: boolean) {
  atomic(sourcesFile(), JSON.stringify({ ...readSourceToggles(), [kind]: on }));
}

// ---- media helpers ------------------------------------------------------------------------------

const EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/heic": "heic",
  "image/avif": "avif",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/wav": "wav",
  "audio/x-m4a": "m4a",
  "application/pdf": "pdf",
};

export function kindForMime(mime: string, voice = false): ItemKind {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return voice ? "voice" : "video";
  if (mime.startsWith("audio/")) return voice ? "voice" : "audio";
  return "file";
}

export function extFor(mime: string, name?: string): string {
  const fromName = name?.match(/\.([a-z0-9]{1,5})$/i)?.[1]?.toLowerCase();
  return EXT[mime] ?? fromName ?? "bin";
}

export function mimeForFile(file: string): string {
  const ext = path.extname(file).slice(1).toLowerCase();
  const hit = Object.entries(EXT).find(([, e]) => e === ext);
  return hit?.[0] ?? (ext === "jpeg" ? "image/jpeg" : "application/octet-stream");
}
