import { NextResponse } from "next/server";
import { listItems } from "@/lib/library";
import { gradeCard, learningOverview, type ReviewGrade } from "@/lib/learning";
import { guarded } from "@/lib/guard";

export const dynamic = "force-dynamic";

const GRADES: ReviewGrade[] = ["again", "hard", "good", "easy"];

// POST { key, grade } — Lind's self-grade after blurting an answer. Returns the record
// and the refreshed queue so the dashboard can move on without a reload.
async function POST_(request: Request) {
  const b = (await request.json().catch(() => null)) as { key?: string; grade?: string } | null;
  if (!b?.key || !GRADES.includes(b.grade as ReviewGrade)) {
    return NextResponse.json({ error: "bad review" }, { status: 400 });
  }
  const items = listItems();
  const record = gradeCard(items, b.key, b.grade as ReviewGrade);
  if (!record) return NextResponse.json({ error: "That card isn't in memory any more." }, { status: 404 });
  return NextResponse.json({ record, ...learningOverview(items) });
}

export const POST = guarded(POST_);
