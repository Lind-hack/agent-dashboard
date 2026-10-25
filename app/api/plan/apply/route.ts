import { NextResponse } from "next/server";
import { replacePlan, type PlanBlock } from "@/lib/calendar";
import { writePlanNote } from "@/lib/planner";

// { day, blocks, summary, note } → time blocks on Google Calendar (replacing today's earlier plan)
// and the plan note in the vault.
export async function POST(request: Request) {
  const b = (await request.json().catch(() => null)) as { day?: string; blocks?: PlanBlock[]; summary?: string; note?: string } | null;
  const hhmm = /^\d{2}:\d{2}$/;
  const blocks = (b?.blocks ?? []).filter((x) => hhmm.test(x?.start ?? "") && hhmm.test(x?.end ?? "") && x?.title?.trim()).slice(0, 30);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b?.day ?? "") || !blocks.length) return NextResponse.json({ error: "Nothing to apply." }, { status: 400 });
  try {
    await replacePlan(b!.day!, blocks);
    const vault = writePlanNote(b!.day!, blocks, b?.summary ?? "", b?.note ?? "");
    return NextResponse.json({ ok: true, vault });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const hint = /insufficient|scope|permission/i.test(msg) ? " Re-run google-auth on your PC to allow adding events." : "";
    return NextResponse.json({ error: msg + hint }, { status: 500 });
  }
}
