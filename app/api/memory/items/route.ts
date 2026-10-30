import { NextResponse } from "next/server";
import { createItem, listItems, readSections } from "@/lib/library";
import { invalidateMemory } from "@/lib/memory";

export const dynamic = "force-dynamic";

// The Library: GET everything (newest first) + sections; POST { text } or { url } to capture.
export async function GET() {
  return NextResponse.json({ items: listItems(), sections: readSections() });
}

export async function POST(request: Request) {
  const b = (await request.json().catch(() => null)) as { text?: string; url?: string } | null;
  const text = (b?.text ?? "").toString().trim().slice(0, 20_000);
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
  const it = createItem({ kind: "text", text, title: text.split("\n")[0].slice(0, 90) });
  invalidateMemory();
  return NextResponse.json({ item: it });
}
