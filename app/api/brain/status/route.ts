import { NextResponse } from "next/server";
import { readBrainStatus } from "@/lib/brain";
import { guarded } from "@/lib/guard";

export const dynamic = "force-dynamic";

// GET: the brain's per-source status (the PC collector reads it with --status; the Memory page shows it).
async function GET_() {
  return NextResponse.json(readBrainStatus());
}

export const GET = guarded(GET_, { owner: true });
