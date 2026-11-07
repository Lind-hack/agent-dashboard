import { NextResponse } from "next/server";
import { guarded } from "@/lib/guard";
import { isOwner } from "@/lib/tenant";
import { manifest, markSynced } from "@/lib/vault-sync";

export const dynamic = "force-dynamic";

// The Obsidian plugin's view of the server copy: every note with its hash. Called at the start of each sync.
async function GET_() {
  if (isOwner()) return NextResponse.json({ error: "The owner's vault syncs with Syncthing" }, { status: 400 });
  markSynced();
  return NextResponse.json({ files: manifest() }, { headers: { "Cache-Control": "no-store" } });
}

export const GET = guarded(GET_);
