import { gunzipSync } from "node:zlib";
import { NextResponse } from "next/server";
import { queueBrainItem, validBrainItem, type BrainItem } from "@/lib/brain";

export const dynamic = "force-dynamic";

// The PC brain collector (handoff/brain-collect.mjs, Bearer HANDOFF_TOKEN) posts one gzipped JSON
// BrainItem per chat or graph report — already condensed and redacted. The runner processes the queue.
export async function POST(request: Request) {
  let item: Partial<BrainItem> | null = null;
  try {
    const raw = Buffer.from(await request.arrayBuffer());
    if (raw.length > 9 * 1024 * 1024) return NextResponse.json({ error: "too large" }, { status: 413 });
    item = JSON.parse(gunzipSync(raw, { maxOutputLength: 8 * 1024 * 1024 }).toString("utf8"));
  } catch {
    return NextResponse.json({ error: "body must be gzipped JSON" }, { status: 400 });
  }
  const bad = validBrainItem(item);
  if (bad) return NextResponse.json({ error: bad }, { status: 400 });
  queueBrainItem({
    kind: item!.kind!,
    id: item!.id!,
    agent: String(item!.agent ?? "").slice(0, 40),
    title: String(item!.title ?? "").slice(0, 200),
    project: String(item!.project ?? "").slice(0, 80),
    firstAt: String(item!.firstAt ?? ""),
    lastAt: String(item!.lastAt ?? ""),
    text: item!.text!,
    source: String(item!.source ?? "").slice(0, 300),
  });
  return NextResponse.json({ ok: true });
}
