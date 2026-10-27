import { NextResponse } from "next/server";
import { setBlockStatus, type BlockAction } from "@/lib/plan-store";

const ACTIONS: BlockAction[] = ["start", "done", "blocked", "planned", "move"];

// { day, id, action } → the authoritative per-day plan store. Calendar/vault are not touched.
export async function POST(request: Request) {
  const b = (await request.json().catch(() => null)) as { day?: string; id?: string; action?: string } | null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b?.day ?? "") || !b?.id || !ACTIONS.includes(b.action as BlockAction)) {
    return NextResponse.json({ error: "day, id and a valid action are required." }, { status: 400 });
  }
  const plan = setBlockStatus(b.day!, b.id!, b.action as BlockAction);
  if (!plan) return NextResponse.json({ error: "That block is no longer in today's plan." }, { status: 404 });
  return NextResponse.json({ ok: true, plan });
}
