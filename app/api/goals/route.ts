import { NextResponse } from "next/server";
import { readGoals, writeGoals, type Goal } from "@/lib/goals";
import { guarded } from "@/lib/guard";

// The goals live in data/goals.md (mirrored to 100 - Me/Goals.md in the vault); this route is the editor.
async function GET_() {
  return NextResponse.json({ goals: readGoals(), file: "100 - Me/Goals.md" });
}

async function POST_(request: Request) {
  const goals = (await request.json().catch(() => null))?.goals as Partial<Goal>[] | undefined;
  if (!Array.isArray(goals)) return NextResponse.json({ error: "goals[] is required" }, { status: 400 });
  const clean = goals
    .filter((g) => typeof g?.title === "string" && g.title.trim())
    .slice(0, 60)
    .map((g) => ({
      id: "",
      horizon: g.horizon === "now" || g.horizon === "long" ? g.horizon : "short",
      title: g.title!.trim().slice(0, 200),
      next: typeof g.next === "string" ? g.next.slice(0, 200) : "",
      why: typeof g.why === "string" ? g.why.slice(0, 200) : "",
      due: typeof g.due === "string" && /^\d{4}-\d{2}-\d{2}$/.test(g.due) ? g.due : undefined,
      weeklyMin: typeof g.weeklyMin === "number" && g.weeklyMin > 0 ? Math.round(g.weeklyMin) : undefined,
      done: !!g.done,
    })) satisfies Goal[];
  const r = writeGoals(clean);
  if (!r.ok) return NextResponse.json({ ok: false, error: `Couldn't save the goals: ${r.error}` }, { status: 500 });
  return NextResponse.json({ ok: true, vault: r.vault, goals: readGoals() });
}

export const GET = guarded(GET_);
export const POST = guarded(POST_);
