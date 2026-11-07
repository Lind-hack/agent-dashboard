import { NextResponse } from "next/server";
import { listItems } from "@/lib/library";
import { learningOverview } from "@/lib/learning";
import { guarded } from "@/lib/guard";

export const dynamic = "force-dynamic";

// The Learning dashboard: every Library item (without heavy transcripts), the review queue and the
// counters. Polled while the runner is analysing something.
async function GET_() {
  return NextResponse.json(learningOverview(listItems()));
}

export const GET = guarded(GET_);
