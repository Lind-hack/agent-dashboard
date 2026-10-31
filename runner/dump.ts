import fs from "node:fs";
import path from "node:path";
import { coverSegments, isDump, outline, PART_MAX, segmentText, TEXT_FILE, toBlocks, toWindows, windowText, type Segment } from "../lib/dump";
import { geminiJSON, geminiReady } from "../lib/gemini";
import { groqJSON } from "../lib/groq";
import { addSection, createItem, listItems, mediaDir, mirrorItem, readItem, readSections, saveItem, type LibraryItem, type Section } from "../lib/library";
import { nemotron, nvidiaReady } from "../lib/nvidia";

// Memory dumps, runner side (v5.2): a long paste or text file is read in full, one window (~12k
// characters) per tick, and split into one Library item per topic — each with its own title,
// summary, tags and section, and a link back to the dump. The dump itself becomes the table of
// contents. Progress is saved after every window, so a rate limit or a restart only pauses it.

const log = (...a: unknown[]) => console.log(new Date().toISOString(), "library:", ...a);

const LIND = "Lind is a CS student in Kosovo who runs the @building.ai TikTok (AI/tech), builds the 383 news site, an AI agency and an agent dashboard.";

const textName = (it: LibraryItem) => it.media?.name ?? it.media?.file ?? "";

export const canSplit = (it: LibraryItem) => !it.parent && (it.kind === "text" || (it.kind === "file" && !!it.media?.file && TEXT_FILE.test(textName(it))));

// The whole text of a dump: what was typed, or the full file (never the 30k excerpt in item.text).
export function dumpContent(it: LibraryItem): string {
  if (it.kind === "text") return it.text;
  try {
    return fs.readFileSync(path.join(mediaDir(), path.basename(it.media?.file ?? "")), "utf8");
  } catch {
    return "";
  }
}

// Called before an item is read: a dump is marked for splitting instead of being filed whole.
export function startSplitIfDump(it: LibraryItem): boolean {
  if (it.split || !canSplit(it)) return false;
  const content = dumpContent(it);
  if (!isDump(content)) return false;
  it.split = { state: "splitting", next: 0, total: toWindows(toBlocks(content)).length, parts: [] };
  it.status = "queued";
  it.nextAt = undefined;
  saveItem(it);
  log("dump", it.id, `${content.length} characters in ${it.split.total} windows`);
  return true;
}

// Dumps saved before splitting existed (or filed whole) are found once each and queued again.
const checked = new Set<string>();
export function unsplitDump(items: LibraryItem[]): LibraryItem | undefined {
  for (const it of items) {
    if (checked.has(it.id) || it.status !== "ready" || it.split || !canSplit(it)) continue;
    checked.add(it.id);
    if (isDump(dumpContent(it))) return it;
  }
}

const sectionList = (sections: Section[]) => sections.map((s) => `- ${s.id}: ${s.name} — ${s.description}`).join("\n");
const sectionRules = (sections: Section[]) =>
  `section: the id of the best existing section. Only when NONE fits, set section null and propose new_section (a short broad name like "Fitness", "Family" or "Clients", never one part's title). There are ${sections.length} of max 24 sections${sections.length >= 24 ? " — the limit is reached, pick an existing one" : ""}.\nExisting sections:\n${sectionList(sections)}`;

// A dump can be hundreds of thousands of tokens — far past Groq's free daily caps — so the bulk
// reading goes to Nemotron (free, no daily cap), then Gemini, then Groq's ladder. Throws with each
// model's reason when none answered (the step is retried later).
async function askJSON<T>(system: string, user: string, maxTokens: number): Promise<Partial<T>> {
  const why: string[] = [];
  if (nvidiaReady()) {
    const raw = await nemotron(`${system}\nReturn ONLY the JSON object.`, user, { maxTokens, temperature: 0.2 }).catch((e: unknown) => {
      why.push(`Nemotron: ${e instanceof Error ? e.message : e}`);
      return "";
    });
    try {
      if (raw) return JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as Partial<T>;
    } catch {
      why.push("Nemotron: malformed JSON");
    }
  }
  if (geminiReady()) {
    const out = await geminiJSON<T>(`${system}\n\n${user}`, []).catch((e: unknown) => {
      why.push(e instanceof Error ? e.message : String(e));
      return null;
    });
    if (out) return out;
  }
  const out = await groqJSON<T>(system, user, 0.2, { maxTokens, reasoningEffort: "low", timeoutMs: 120_000 });
  if (out) return out;
  throw new Error(`no model answered — will retry (${[...why, "Groq: no quota or no answer"].join("; ").slice(0, 260)})`);
}

function pickSection(id: string | null | undefined, proposed: { name?: string; description?: string } | null | undefined, fallback?: string): string | undefined {
  const sections = readSections();
  const hit = sections.find((s) => s.id === id);
  if (hit) return hit.id;
  if (proposed?.name) {
    const made = addSection(proposed.name, proposed.description ?? "", "core");
    if (made) {
      log("new section", made.name);
      return made.id;
    }
  }
  return fallback ?? sections[0]?.id;
}

type Overview = { title?: string; summary?: string; tags?: string[]; section?: string | null; new_section?: { name?: string; description?: string } | null; context?: string };

// What the whole document is — from its outline and opening — so every window is read in context.
async function overview(it: LibraryItem, content: string): Promise<Overview> {
  const sections = readSections();
  const out = await askJSON<Overview>(
    `You look at a long document Lind sent to his personal memory, before it is split into parts. ${LIND}
Return JSON {"title": string, "summary": string, "tags": string[], "section": string | null, "new_section": {"name": string, "description": string} | null, "context": string}.
- title: ≤10 words naming what the document is (its source and subject, e.g. "Muse AI memory export about Lind, Oct 2026").
- summary: 2-4 sentences: what it contains and how it is organised.
- tags: 2-5 lowercase keywords.
- context: one sentence a reader of any single part needs to know where it came from (who wrote it, about whom, when).
- ${sectionRules(sections)}`,
    `File: ${textName(it) || "pasted text"} (${content.length.toLocaleString("en")} characters)\n\nOutline:\n${outline(content)}\n\nOpening:\n${content.slice(0, 3000)}`,
    1500,
  );
  return out;
}

type Parts = { parts?: unknown };

async function readWindow(blocks: ReturnType<typeof toBlocks>, win: [number, number], context: string, previous: string): Promise<Segment[]> {
  const sections = readSections();
  const out = await askJSON<Parts>(
    `You split one window of a long document Lind sent to his personal memory into parts — one part per topic — and file each part. ${LIND}
The document: ${context}
The window is a run of numbered blocks [b<n>], in order; each says where it sits in the document ("in: heading › subheading").
- Group CONSECUTIVE blocks about the same thing into one part. Start a new part where the subject changes: a different person, group, goal, project, day, tool, place or topic. Each person, each group, each goal and each day's log gets its own part; an index or list of them is its own part too.
- Aim for parts of about 800 to 6,000 characters; a long part on one subject may be split where it naturally divides. A lone heading, an empty template or a one-line stub is never its own part — it joins the part it introduces or belongs to. Many tiny log entries on one day and one subject belong together; a day with several subjects becomes several parts.
- Every block belongs to exactly one part, in order, with no gaps.
Return JSON {"parts": [{"from": "b<n>", "to": "b<n>", "title": string, "summary": string, "tags": string[], "section": string | null, "new_section": {"name": string, "description": string} | null, "continues_previous": boolean}]}.
- title: ≤10 words, specific (names, dates, numbers), in the text's language.
- summary: 2-3 sentences with the facts the part holds, so it can be found by searching later. No "this section describes".
- tags: 2-5 lowercase keywords (people, projects, tools, places).
- continues_previous: true only on the first part, and only when it carries on the topic of the last part of the window before${previous ? ` ("${previous}")` : " (there is none — use false)"}.
- ${sectionRules(sections)}`,
    windowText(blocks, win),
    6000,
  );
  return coverSegments(out.parts, win);
}

const auto = (it: LibraryItem) => !it.title || it.title === it.media?.name || it.title === it.kind || (it.kind === "text" && it.text.startsWith(it.title));

// One step of a dump: the overview first, then one window. Returns when that step is saved.
export async function splitStep(id: string) {
  const it = readItem(id);
  if (!it?.split || it.split.state !== "splitting") return;
  it.status = "processing";
  saveItem(it);
  const stamp = it.updatedAt;
  try {
    const content = dumpContent(it);
    const blocks = toBlocks(content);
    const wins = toWindows(blocks);
    if (!wins.length) throw new Error("the dump is empty");
    let parent = it;
    if (it.split.next === 0 && !it.split.context) {
      const o = await overview(it, content);
      parent = readItem(id) ?? it;
      if (!parent.split) return;
      if (auto(parent) && parent.updatedAt === stamp && o.title?.trim()) parent.title = o.title.trim().slice(0, 120);
      parent.summary = (o.summary ?? "").trim().slice(0, 600);
      parent.tags = Array.isArray(o.tags) ? o.tags.filter((t): t is string => typeof t === "string").map((t) => t.toLowerCase().trim().slice(0, 30)).slice(0, 6) : [];
      if (!parent.section) parent.section = pickSection(o.section, o.new_section);
      parent.split = { ...parent.split, context: (o.context || o.summary || parent.title).trim().slice(0, 400) };
      parent.status = "queued";
      saveItem(parent);
      return;
    }
    const i = it.split.next;
    const prevPart = it.split.parts.length ? readItem(it.split.parts[it.split.parts.length - 1]) : null;
    const segs = await readWindow(blocks, wins[i], it.split.context ?? it.title, prevPart?.title ?? "");
    parent = readItem(id) as LibraryItem;
    if (!parent?.split) return; // deleted or reset meanwhile
    // One window, one topic: not a dump after all — filed whole, like any note.
    if (wins.length === 1 && segs.length === 1) {
      const s = segs[0];
      Object.assign(parent, {
        text: content.slice(0, 40_000),
        title: auto(parent) && s.title ? s.title : parent.title,
        summary: s.summary || parent.summary,
        tags: s.tags.length ? s.tags : parent.tags,
        section: pickSection(s.section, s.newSection, parent.section),
        split: { ...parent.split, state: "done", next: 1, parts: [] },
        status: "ready",
        error: undefined,
      });
      mirrorItem(parent);
      saveItem(parent);
      log("ready", id, "one topic — not split");
      return;
    }
    const parts = [...parent.split.parts];
    for (const [k, s] of segs.entries()) {
      const text = segmentText(blocks, s);
      const where = blocks[s.from].path.join(" › ");
      const last = parts.length ? readItem(parts[parts.length - 1]) : null;
      if (k === 0 && s.continues && last && last.text.length + text.length <= PART_MAX) {
        last.text = `${last.text}\n\n${text}`;
        last.tags = [...new Set([...last.tags, ...s.tags])].slice(0, 6);
        mirrorItem(last);
        saveItem(last);
        continue;
      }
      const child = createItem({
        kind: "text",
        status: "ready",
        createdAt: parent.createdAt,
        parent: id,
        title: s.title || blocks[s.from].path[blocks[s.from].path.length - 1] || `${parent.title} — part ${parts.length + 1}`,
        summary: s.summary,
        tags: s.tags,
        text,
        note: `Part of “${parent.title}”${where ? ` — ${where}` : ""}`,
        section: pickSection(s.section, s.newSection, parent.section),
        attempts: undefined,
      });
      mirrorItem(child);
      saveItem(child);
      parts.push(child.id);
    }
    parent.split = { ...parent.split, next: i + 1, parts, fails: 0 };
    parent.error = undefined;
    if (parent.split.next < wins.length) parent.status = "queued";
    else finish(parent);
    saveItem(parent);
    log(parent.status === "ready" ? "ready" : "split", id, `window ${i + 1}/${wins.length}, ${parts.length} parts`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const fresh = readItem(id);
    if (!fresh?.split) return;
    const fails = (fresh.split.fails ?? 0) + 1;
    fresh.split = { ...fresh.split, fails };
    fresh.error = msg.slice(0, 300);
    // Rate limits pass: back off up to an hour, and give up only after a long run of failures.
    if (fails >= 12) fresh.status = "failed";
    else {
      fresh.status = "queued";
      fresh.nextAt = new Date(Date.now() + 60_000 * Math.min(60, 2 ** fails)).toISOString();
    }
    saveItem(fresh);
    log("split failed", id, msg);
  }
}

// The dump becomes the table of contents of its parts.
function finish(parent: LibraryItem) {
  const sections = readSections();
  const kids = listItems().filter((c) => c.parent === parent.id);
  const order = new Map(parent.split!.parts.map((p, i) => [p, i]));
  kids.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  const lines = kids.map((c) => `- ${c.title} (${sections.find((s) => s.id === c.section)?.name ?? "Unsorted"})`);
  parent.text = [parent.summary, `Split into ${kids.length} parts:`, ...lines].filter(Boolean).join("\n").slice(0, 40_000);
  parent.split = { ...parent.split!, state: "done" };
  parent.status = "ready";
  parent.nextAt = undefined;
  mirrorItem(parent);
}
