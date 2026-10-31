import { NextResponse } from "next/server";
import { board } from "@/lib/day-board";
import { archiveHabit, logHabit, saveHabit, type Habit } from "@/lib/habits";

export const dynamic = "force-dynamic";

// Habits and the day board (v5.3).
// GET ?day= → the board for that day (habits, tasks, goals, the week strip).
// POST { habit } → new or edited habit. PATCH { id, day, delta? | value? } → log a step.
// DELETE ?id= → archive it (its history stays).
export async function GET(request: Request) {
  return NextResponse.json(board(new URL(request.url).searchParams.get("day") ?? undefined));
}

export async function POST(request: Request) {
  const h = ((await request.json().catch(() => null)) as { habit?: Partial<Habit> } | null)?.habit;
  if (!h) return NextResponse.json({ error: "No habit." }, { status: 400 });
  const { createdAt: _drop, archived: _a, ...rest } = h;
  const saved = saveHabit(rest);
  return saved ? NextResponse.json({ habit: saved }) : NextResponse.json({ error: "Give it a name." }, { status: 400 });
}

export async function PATCH(request: Request) {
  const b = (await request.json().catch(() => null)) as { id?: string; day?: string; delta?: number; value?: number } | null;
  const r = logHabit(String(b?.id ?? ""), String(b?.day ?? ""), { delta: typeof b?.delta === "number" ? b.delta : undefined, value: typeof b?.value === "number" ? b.value : undefined });
  return r ? NextResponse.json({ entry: r }) : NextResponse.json({ error: "No such habit." }, { status: 404 });
}

export async function DELETE(request: Request) {
  return archiveHabit(new URL(request.url).searchParams.get("id") ?? "") ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "No such habit." }, { status: 404 });
}
