import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { invalidateMemory, notesDir } from "@/lib/memory";

// Posted by handoff/sync-notes.mjs on the PC (Bearer HANDOFF_TOKEN, checked in proxy.ts):
// { files: [{ name, text }] } replaces the whole notes folder, so deleted notes disappear too.
export async function POST(request: Request) {
  const files = (await request.json().catch(() => null))?.files as { name?: string; text?: string }[] | undefined;
  if (!Array.isArray(files)) return NextResponse.json({ error: "files[] is required" }, { status: 400 });
  const clean = files
    .filter((f) => typeof f?.name === "string" && typeof f?.text === "string")
    .map((f) => ({ name: path.basename(f.name!).replace(/[^\w.-]/g, "_"), text: f.text!.slice(0, 200_000) }))
    .filter((f) => f.name.endsWith(".md"))
    .slice(0, 500);
  const dir = notesDir();
  const tmp = `${dir}.tmp`;
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  for (const f of clean) fs.writeFileSync(path.join(tmp, f.name), f.text);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.renameSync(tmp, dir);
  invalidateMemory();
  return NextResponse.json({ ok: true, count: clean.length });
}
