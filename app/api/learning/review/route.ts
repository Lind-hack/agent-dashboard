import { NextResponse } from "next/server";
import { listItems } from "@/lib/library";
import { gradeConcept, learningOverview, type ReviewGrade } from "@/lib/learning";

export const dynamic = "force-dynamic";

const GRADES: ReviewGrade[] = ["again", "hard", "good", "easy"];

// POST { itemId, concept, grade } — Lind's self-grade after blurting an answer. Returns the record
// and the refreshed queue so the dashboard can move on without a reload.
export async function POST(request: Request) {
  const b = (await request.json().catch(() => null)) as { itemId?: string; concept?: number; grade?: string } | null;
  const concept = Number(b?.concept);
  if (!b?.itemId || !Number.isInteger(concept) || concept < 0 || !GRADES.includes(b.grade as ReviewGrade)) {
    return NextResponse.json({ error: "bad review" }, { status: 400 });
  }
  const items = listItems();
  const record = gradeConcept(items, b.itemId, concept, b.grade as ReviewGrade);
  if (!record) return NextResponse.json({ error: "That concept isn't in memory any more." }, { status: 404 });
  return NextResponse.json({ record, ...learningOverview(items) });
}
