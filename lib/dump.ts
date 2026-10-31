// Memory dumps (v5.2): a long paste or text file sent to Memory — a whole profile export, a pile of
// notes — is read in full and split into one Library item per topic, each filed into its own
// section. This file is the deterministic half: cutting the text into blocks at its headings (and
// paragraphs when a section is long), packing blocks into windows the model reads one at a time, and
// repairing the model's answer so the segments cover every block exactly once.

export const BLOCK_MAX = 6000; // one block: a heading's text, or a slice of it at paragraph breaks
export const WINDOW_MAX = 12_000; // what the model reads in one call
export const PART_MAX = 10_000; // a part that continues into the next window is merged up to this
export const TEXT_FILE = /\.(txt|md|markdown|csv|json|log|ya?ml)$/i;

export type Block = { n: number; path: string[]; text: string };
export type Segment = { from: number; to: number; title: string; summary: string; tags: string[]; section: string | null; newSection: { name: string; description: string } | null; continues: boolean };

const headings = (s: string) => s.match(/^#{1,6}\s+\S/gm)?.length ?? 0;

// Long, or medium with several headings: worth splitting. Shorter notes are filed as one item.
export const isDump = (text: string) => text.length > 8000 || (text.length > 3000 && headings(text) >= 3);

export function toBlocks(content: string, max = BLOCK_MAX): Block[] {
  const stack: { level: number; title: string }[] = [];
  const raw: { path: string[]; lines: string[] }[] = [];
  let cur: { path: string[]; lines: string[] } = { path: [], lines: [] };
  let fence = false;
  for (const line of content.replace(/\r\n?/g, "\n").split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    const h = fence ? null : line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (!h) {
      cur.lines.push(line);
      continue;
    }
    if (cur.lines.join("").trim()) raw.push(cur);
    while (stack.length && stack[stack.length - 1].level >= h[1].length) stack.pop();
    stack.push({ level: h[1].length, title: h[2].slice(0, 80) });
    cur = { path: stack.map((s) => s.title), lines: [line] };
  }
  if (cur.lines.join("").trim()) raw.push(cur);
  const out: Block[] = [];
  for (const r of raw) for (const text of pieces(r.lines.join("\n").trim(), max)) out.push({ n: out.length, path: r.path, text });
  return out;
}

// A long section in pieces at blank lines; a paragraph longer than `max` at line breaks, else hard.
function pieces(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  const out: string[] = [];
  let buf = "";
  for (const para of text.split(/\n{2,}/)) {
    let p = para;
    while (p.length > max) {
      if (buf) out.push(buf);
      buf = "";
      const nl = p.lastIndexOf("\n", max);
      const cut = nl > max / 2 ? nl : max;
      out.push(p.slice(0, cut));
      p = p.slice(cut).replace(/^\n/, "");
    }
    if (buf && buf.length + p.length + 2 > max) {
      out.push(buf);
      buf = "";
    }
    buf = buf ? `${buf}\n\n${p}` : p;
  }
  if (buf) out.push(buf);
  return out;
}

// Consecutive blocks packed up to `max` characters: [first block, last block + 1) per window.
export function toWindows(blocks: Block[], max = WINDOW_MAX): [number, number][] {
  const out: [number, number][] = [];
  let start = 0;
  let size = 0;
  for (const b of blocks) {
    if (b.n > start && size + b.text.length > max) {
      out.push([start, b.n]);
      start = b.n;
      size = 0;
    }
    size += b.text.length + 2;
  }
  if (blocks.length) out.push([start, blocks.length]);
  return out;
}

// The window as the model sees it: each block numbered, with where it sits in the document.
export const windowText = (blocks: Block[], [a, b]: [number, number]) =>
  blocks
    .slice(a, b)
    .map((x) => `[b${x.n}]${x.path.length ? ` (in: ${x.path.join(" › ")})` : ""}\n${x.text}`)
    .join("\n\n");

// The document's outline (every heading, indented), for the overview call.
export function outline(content: string, max = 8000): string {
  const lines = content.match(/^#{1,6}\s+.+$/gm) ?? [];
  let out = "";
  for (const l of lines) {
    const level = l.match(/^#+/)![0].length;
    const next = `${"  ".repeat(level - 1)}- ${l.replace(/^#+\s+/, "").slice(0, 90)}\n`;
    if (out.length + next.length > max) return `${out}  … (${lines.length} headings in all)\n`;
    out += next;
  }
  return out;
}

const blockNo = (v: unknown) => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v.trim().replace(/^\[?b/i, "").replace(/\]$/, "")) : NaN;
  return Number.isInteger(n) ? n : NaN;
};
const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

// The model's segments, repaired: inside the window, in order, no gaps, no overlaps — so every block
// lands in exactly one part. Nothing usable → one segment for the whole window.
export function coverSegments(raw: unknown, [a, b]: [number, number]): Segment[] {
  const list = Array.isArray(raw) ? raw : [];
  const segs = list
    .map((s: Record<string, unknown>) => {
      const ns = s?.new_section as Record<string, unknown> | null | undefined;
      return {
        from: blockNo(s?.from),
        to: blockNo(s?.to),
        title: str(s?.title, 120),
        summary: str(s?.summary, 600),
        tags: Array.isArray(s?.tags) ? (s.tags as unknown[]).filter((t): t is string => typeof t === "string").map((t) => t.toLowerCase().trim().slice(0, 30)).filter(Boolean).slice(0, 6) : [],
        section: str(s?.section, 60) || null,
        newSection: ns && str(ns.name, 40) ? { name: str(ns.name, 40), description: str(ns.description, 160) } : null,
        continues: s?.continues_previous === true,
      };
    })
    .filter((s) => !Number.isNaN(s.from))
    .map((s) => ({ ...s, from: Math.min(Math.max(s.from, a), b - 1), to: Number.isNaN(s.to) ? s.from : Math.min(Math.max(s.to, a), b - 1) }))
    .sort((x, y) => x.from - y.from);
  const out: Segment[] = [];
  for (const s of segs) {
    const prev = out[out.length - 1];
    const from = prev ? prev.to + 1 : a;
    if (s.to < from) continue; // swallowed by the one before
    out.push({ ...s, from, to: Math.max(s.to, from), continues: out.length === 0 && s.continues });
  }
  if (!out.length) return [{ from: a, to: b - 1, title: "", summary: "", tags: [], section: null, newSection: null, continues: false }];
  out[out.length - 1].to = b - 1;
  return out;
}

// A part's text: its blocks, verbatim.
export const segmentText = (blocks: Block[], s: Pick<Segment, "from" | "to">) =>
  blocks
    .slice(s.from, s.to + 1)
    .map((x) => x.text)
    .join("\n\n");
