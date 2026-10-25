import { NextResponse } from "next/server";
import { readBrainStatus } from "@/lib/brain";

export const dynamic = "force-dynamic";

// GET: the brain's per-source status (the PC collector reads it with --status; the Memory page shows it).
export async function GET() {
  return NextResponse.json(readBrainStatus());
}
