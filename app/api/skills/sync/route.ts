import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { NextResponse } from "next/server";
import { DATA_DIR } from "@/lib/config";
import { pushInbox } from "@/lib/store";

export const dynamic = "force-dynamic";

const CAP = 9 * 1024 * 1024;

// Reads the body with a running byte limit, cancelling as soon as it's exceeded.
async function readCapped(request: Request): Promise<Buffer | null> {
  const reader = request.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > CAP) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

// The PC collector (Bearer HANDOFF_TOKEN) posts its skill folders + a manifest of plugins, hooks and MCP
// servers as gzipped JSON. Stored as-is under a unique name; the runner validates and installs it (it's
// the only writer of the agents' skill folders).
export async function POST(request: Request) {
  const raw = await readCapped(request);
  if (!raw) return NextResponse.json({ error: "too large — split the upload" }, { status: 413 });
  let body: { kind?: string } | null = null;
  try {
    body = JSON.parse(gunzipSync(raw, { maxOutputLength: 96 * 1024 * 1024 }).toString("utf8"));
  } catch {
    return NextResponse.json({ error: "body must be gzipped JSON" }, { status: 400 });
  }
  if (body?.kind !== "skills" && body?.kind !== "manifest") return NextResponse.json({ error: "kind must be skills or manifest" }, { status: 400 });
  const dir = path.join(DATA_DIR, "skills-inbox");
  fs.mkdirSync(dir, { recursive: true });
  // Time first (the runner applies uploads in order), then a random part so nothing collides.
  const name = `${Date.now()}-${crypto.randomUUID()}-${body.kind}.json.gz`;
  const tmp = path.join(dir, `.${name}.tmp`);
  fs.writeFileSync(tmp, raw, { flag: "wx" });
  fs.renameSync(tmp, path.join(dir, name));
  pushInbox({ kind: "sync" });
  return NextResponse.json({ ok: true });
}
