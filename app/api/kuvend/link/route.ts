import { NextResponse } from "next/server";
import { guarded } from "@/lib/guard";
import { linkStatus, newLinkCode, revokeLinkCodes } from "@/lib/kuvend-link";
import { currentTenant } from "@/lib/tenant";

export const dynamic = "force-dynamic";

// Settings: make a link code for Kuvend (shown once), see whether any exist, or revoke them all.
async function GET_() {
  return NextResponse.json(linkStatus());
}
async function POST_() {
  return NextResponse.json({ code: newLinkCode(currentTenant()), ...linkStatus() });
}
async function DELETE_() {
  revokeLinkCodes();
  return NextResponse.json(linkStatus());
}

export const GET = guarded(GET_);
export const POST = guarded(POST_);
export const DELETE = guarded(DELETE_);
