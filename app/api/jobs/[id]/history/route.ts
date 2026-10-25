import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { handoffDir } from "@/lib/handoff";
import { readJob } from "@/lib/store";
import { parseTranscript, type Item } from "@/lib/transcript";

export const dynamic = "force-dynamic";

// The conversation that happened on the PC before the hand-off, newest page first.
// ?before=<index> pages backwards; items are numbered oldest = 0.
const cache = new Map<string, { mtime: number; items: Item[] }>();

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const job = readJob(id);
  const dir = job?.imported ? handoffDir(job.imported.sessionId, job.imported.generation) : null;
  if (!job || !dir) return NextResponse.json({ error: "not a hand-off" }, { status: 404 });
  const file = path.join(dir, "transcript.jsonl");
  let items: Item[];
  try {
    const mtime = fs.statSync(file).mtimeMs;
    const hit = cache.get(file);
    if (hit?.mtime === mtime) items = hit.items;
    else {
      // Tool calls collapse into the agent turn they belong to; the phone shows the conversation.
      items = parseTranscript(fs.readFileSync(file, "utf8"), job.agent === "codex" ? "codex" : "claude");
      cache.set(file, { mtime, items });
    }
  } catch {
    return NextResponse.json({ items: [], total: 0 });
  }
  const url = new URL(request.url);
  const limit = Math.min(Number(url.searchParams.get("limit")) || 40, 100);
  const before = Math.min(Number(url.searchParams.get("before") ?? items.length) || items.length, items.length);
  const start = Math.max(0, before - limit);
  return NextResponse.json({
    total: items.length,
    start,
    items: items.slice(start, before).map((it, i) => ({ ...it, n: start + i, text: it.text.length > 6000 ? `${it.text.slice(0, 6000)}…` : it.text })),
  });
}
