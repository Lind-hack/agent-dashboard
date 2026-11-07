import { NextResponse } from "next/server";
import { guarded } from "@/lib/guard";
import { isOwner } from "@/lib/tenant";
import { newSyncCode, revokeSyncCode, syncStatus } from "@/lib/vault-sync";

export const dynamic = "force-dynamic";

// Obsidian sync codes, from Settings (cookie only). GET → whether a device is paired and when it last synced.
// POST → a new code for another device, shown once. DELETE → unpair every device.
async function GET_() {
  return NextResponse.json({ owner: isOwner(), ...syncStatus() });
}

async function POST_() {
  if (isOwner()) return NextResponse.json({ error: "Your vault syncs with Syncthing" }, { status: 400 });
  return NextResponse.json({ code: newSyncCode(), ...syncStatus() });
}

async function DELETE_() {
  revokeSyncCode();
  return NextResponse.json(syncStatus());
}

export const GET = guarded(GET_);
export const POST = guarded(POST_);
export const DELETE = guarded(DELETE_);
