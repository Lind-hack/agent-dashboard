import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { createItem, extFor, kindForMime, MAX_UPLOAD, mediaDir, newId, readItem, uploadsDir } from "@/lib/library";
import { invalidateMemory } from "@/lib/memory";

export const dynamic = "force-dynamic";

// Files for Memory arrive in ≤8 MB chunks (the proxy in front buffers request bodies to ~10 MB):
// raw body + headers x-upload (client id), x-index, x-count, x-name, x-type, x-voice, x-note.
// Chunks must come in order; a wrong index answers 409 with the one expected, so the client resumes.
const CHUNK_MAX = 9 * 1024 * 1024;

type Meta = { next: number; bytes: number; at: number };

// One request per upload at a time (the web app is one process); a second one waits its turn.
const locks = new Map<string, Promise<unknown>>();
function serial<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  locks.set(key, next);
  void next.finally(() => locks.get(key) === next && locks.delete(key)).catch(() => {});
  return next;
}

function sweepStale() {
  const dir = uploadsDir();
  try {
    for (const n of fs.readdirSync(dir)) {
      const p = path.join(dir, n);
      if (Date.now() - fs.statSync(p).mtimeMs > 24 * 3600_000) fs.rmSync(p, { force: true });
    }
  } catch {
    /* no uploads yet */
  }
}

export async function POST(request: Request) {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > CHUNK_MAX) return NextResponse.json({ error: "chunk too large" }, { status: 413 });
  return serial(request.headers.get("x-upload") ?? "", () => handle(request));
}

async function handle(request: Request) {
  const h = request.headers;
  const upload = h.get("x-upload") ?? "";
  const index = Number(h.get("x-index"));
  const count = Number(h.get("x-count"));
  const type = (h.get("x-type") || "application/octet-stream").toLowerCase().slice(0, 100);
  const name = decodeURIComponent(h.get("x-name") ?? "").replace(/[/\\\0]/g, "_").slice(0, 160);
  if (!/^[a-z0-9-]{8,40}$/i.test(upload) || !Number.isInteger(index) || !Number.isInteger(count) || count < 1 || index < 0 || index >= count || count > Math.ceil(MAX_UPLOAD / (8 * 1024 * 1024)) + 1) {
    return NextResponse.json({ error: "bad upload headers" }, { status: 400 });
  }
  if (type.includes("html") || type.includes("svg") || type.includes("javascript")) return NextResponse.json({ error: "That file type can't be kept here." }, { status: 415 });

  const dir = uploadsDir();
  fs.mkdirSync(dir, { recursive: true });
  const part = path.join(dir, `${upload}.part`);
  const metaFile = path.join(dir, `${upload}.json`);
  const receipt = path.join(dir, `${upload}.done`);
  // The last chunk already landed (its answer was lost): answer with the same item, don't make another.
  if (fs.existsSync(receipt)) {
    const item = readItem(fs.readFileSync(receipt, "utf8").trim());
    if (item) return NextResponse.json({ ok: true, item });
  }
  if (index === 0) {
    sweepStale();
    fs.rmSync(part, { force: true });
    fs.writeFileSync(metaFile, JSON.stringify({ next: 0, bytes: 0, at: Date.now() } satisfies Meta));
  }
  let meta: Meta;
  try {
    meta = JSON.parse(fs.readFileSync(metaFile, "utf8"));
  } catch {
    return NextResponse.json({ error: "upload expired — start again", expected: 0 }, { status: 409 });
  }
  if (index !== meta.next) return NextResponse.json({ error: "out of order", expected: meta.next }, { status: 409 });

  const buf = Buffer.from(await request.arrayBuffer());
  if (buf.length > CHUNK_MAX) return NextResponse.json({ error: "chunk too large" }, { status: 413 });
  const onDisk = index === 0 ? 0 : fs.statSync(part, { throwIfNoEntry: false })?.size ?? 0;
  if (onDisk !== meta.bytes) return NextResponse.json({ error: "upload out of step — start again", expected: 0 }, { status: 409 });
  if (meta.bytes + buf.length > MAX_UPLOAD) {
    fs.rmSync(part, { force: true });
    fs.rmSync(metaFile, { force: true });
    return NextResponse.json({ error: "Files up to 200 MB." }, { status: 413 });
  }
  fs.appendFileSync(part, buf);
  meta = { next: index + 1, bytes: meta.bytes + buf.length, at: Date.now() };
  fs.writeFileSync(metaFile, JSON.stringify(meta));
  if (index + 1 < count) return NextResponse.json({ ok: true, next: meta.next });

  // Last chunk: the file becomes a Library item and the runner takes it from here.
  const voice = h.get("x-voice") === "1";
  const note = decodeURIComponent(h.get("x-note") ?? "").trim().slice(0, 4000);
  const id = newId();
  const file = `${id}.${extFor(type, name)}`;
  fs.mkdirSync(mediaDir(), { recursive: true });
  fs.renameSync(part, path.join(mediaDir(), file));
  fs.rmSync(metaFile, { force: true });
  fs.writeFileSync(receipt, id);
  const kind = kindForMime(type, voice);
  const it = createItem({
    id,
    kind,
    title: voice ? "Voice note" : name || kind,
    note: note || undefined,
    media: { file, mime: type, bytes: meta.bytes, name: name || undefined },
  });
  invalidateMemory();
  return NextResponse.json({ ok: true, item: it });
}
