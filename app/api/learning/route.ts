import { NextResponse } from "next/server";
import { listItems } from "@/lib/library";
import { learningOverview } from "@/lib/learning";

export const dynamic = "force-dynamic";

// The Learning dashboard: every Library item (without heavy transcripts), the review queue and the
// counters. Polled while the runner is analysing something.
export async function GET() {
  return NextResponse.json(learningOverview(listItems()));
}
