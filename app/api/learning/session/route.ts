import { NextResponse } from "next/server";
import { listItems } from "@/lib/library";
import { generateSession, inStudy, type LearningMode } from "@/lib/learning";

export const dynamic = "force-dynamic";

const MODES: LearningMode[] = ["goal", "code-review", "interview-me"];

// POST { mode, itemIds?, goal? } — build a goal plan, a code review or a mock interview from the
// analysed items Lind picks. Runs on request only.
export async function POST(request: Request) {
  const b = (await request.json().catch(() => null)) as { mode?: string; itemIds?: string[]; goal?: string } | null;
  if (!MODES.includes(b?.mode as LearningMode)) return NextResponse.json({ error: "unknown learning mode" }, { status: 400 });
  const ids = new Set((Array.isArray(b?.itemIds) ? b.itemIds : []).filter((x): x is string => typeof x === "string"));
  const all = listItems();
  const picked = ids.size ? all.filter((i) => ids.has(i.id)) : all.filter(inStudy);
  try {
    const session = await generateSession(b!.mode as LearningMode, picked, (b?.goal ?? "").toString().trim().slice(0, 300));
    return NextResponse.json({ session });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
