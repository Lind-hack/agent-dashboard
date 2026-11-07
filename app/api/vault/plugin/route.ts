import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { publicOrigin } from "@/lib/google-oauth";
import { guarded } from "@/lib/guard";
import { isOwner } from "@/lib/tenant";
import { newSyncCode } from "@/lib/vault-sync";
import { zip } from "@/lib/zip";

export const dynamic = "force-dynamic";

// The Obsidian plugin as a folder to unzip into <vault>/.obsidian/plugins/, already set up for this account:
// data.json carries the dashboard's address and a fresh sync code for this device. POST, so another site
// can't make codes by linking here.
async function POST_(req: Request) {
  if (isOwner()) return NextResponse.json({ error: "Your vault syncs with Syncthing" }, { status: 400 });
  const dir = path.join(process.cwd(), "obsidian-plugin");
  const settings = { server: publicOrigin(req), code: newSyncCode(), everyMin: 5, last: {} };
  const body = zip([
    { name: "agentic-os-sync/manifest.json", data: fs.readFileSync(path.join(dir, "manifest.json")) },
    { name: "agentic-os-sync/main.js", data: fs.readFileSync(path.join(dir, "main.js")) },
    { name: "agentic-os-sync/data.json", data: Buffer.from(JSON.stringify(settings, null, 2)) },
  ]);
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": 'attachment; filename="agentic-os-sync.zip"',
      "Cache-Control": "no-store",
    },
  });
}

export const POST = guarded(POST_);
