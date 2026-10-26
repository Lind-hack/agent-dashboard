import fs from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { NextResponse } from "next/server";
import { DATA_DIR } from "@/lib/config";
import { pushInbox } from "@/lib/store";

export const dynamic = "force-dynamic";

// The PC collector (Bearer HANDOFF_TOKEN) posts its skill folders + a manifest of plugins, hooks and MCP
// servers as gzipped JSON. Stored as-is; the runner validates and installs it (it's the only writer of
// the agents' skill folders).
export async function POST(request: Request) {
  const raw = Buffer.from(await request.arrayBuffer());
  if (raw.length > 9 * 1024 * 1024) return NextResponse.json({ error: "too large — split the upload" }, { status: 413 });
  let body: { kind?: string } | null = null;
  try {
    body = JSON.parse(gunzipSync(raw, { maxOutputLength: 64 * 1024 * 1024 }).toString("utf8"));
  } catch {
    return NextResponse.json({ error: "body must be gzipped JSON" }, { status: 400 });
  }
  if (body?.kind !== "skills" && body?.kind !== "manifest") return NextResponse.json({ error: "kind must be skills or manifest" }, { status: 400 });
  const dir = path.join(DATA_DIR, "skills-inbox");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${Date.now()}-${body.kind}.json.gz`);
  fs.writeFileSync(`${file}.tmp`, raw);
  fs.renameSync(`${file}.tmp`, file);
  pushInbox({ kind: "sync" });
  return NextResponse.json({ ok: true });
}
