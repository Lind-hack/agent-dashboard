import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { createItem, listItems, mediaDir, newId, readSections, slimItem } from "@/lib/library";
import { invalidateMemory } from "@/lib/memory";

export const dynamic = "force-dynamic";

// The Library: GET everything (newest first, long texts cut short) + sections; POST { text } or
// { url } to capture. A long paste (a memory dump) is kept whole as a .md file, which the runner
// reads in full and splits into parts.
const LONG_PASTE = 20_000;
const MAX_PASTE = 5_000_000;

export async function GET() {
  return NextResponse.json({ items: listItems().map(slimItem), sections: readSections() });
}

export async function POST(request: Request) {
  const b = (await request.json().catch(() => null)) as { text?: string; url?: string } | null;
  const text = (b?.text ?? "").toString().trim().slice(0, MAX_PASTE);
  const url = (b?.url ?? "").toString().trim();
  // A bare link becomes a link item; the runner reads its title and description.
  const link = url || (/^https?:\/\/\S+$/.test(text) ? text : "");
  if (link) {
    let host = "";
    try {
      const u = new URL(link);
      if (!/^https?:$/.test(u.protocol)) throw new Error("bad protocol");
      host = u.hostname;
    } catch {
      return NextResponse.json({ error: "That link doesn't look right." }, { status: 400 });
    }
    const it = createItem({ kind: "link", url: link, title: host, note: url && text ? text : undefined });
    invalidateMemory();
    return NextResponse.json({ item: it });
  }
  if (!text) return NextResponse.json({ error: "Type, say or drop something first." }, { status: 400 });
  if (text.length > LONG_PASTE) {
    const id = newId();
    fs.mkdirSync(mediaDir(), { recursive: true });
    fs.writeFileSync(path.join(mediaDir(), `${id}.md`), text);
    const title = text.split("\n")[0].replace(/^#+\s*/, "").slice(0, 90);
    const it = createItem({ id, kind: "file", title: "Pasted note.md", media: { file: `${id}.md`, mime: "text/markdown", bytes: Buffer.byteLength(text), name: "Pasted note.md" }, summary: title });
    invalidateMemory();
    return NextResponse.json({ item: slimItem(it) });
  }
  const it = createItem({ kind: "text", text, title: text.split("\n")[0].slice(0, 90) });
  invalidateMemory();
  return NextResponse.json({ item: it });
}
