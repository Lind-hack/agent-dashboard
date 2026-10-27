import { NextResponse } from "next/server";
import { calendarConnected, replacePlan, type PlanBlock } from "@/lib/calendar";
import { blockId, savePlan } from "@/lib/plan-store";
import { writePlanNote } from "@/lib/planner";

// { day, blocks, summary, note } → time blocks on Google Calendar (replacing today's earlier plan)
// and the plan note in the vault.
export async function POST(request: Request) {
  const b = (await request.json().catch(() => null)) as { day?: string; tz?: string; blocks?: PlanBlock[]; summary?: string; note?: string } | null;
  const hhmm = /^\d{2}:\d{2}$/;
  const blocks = (b?.blocks ?? []).filter((x) => hhmm.test(x?.start ?? "") && hhmm.test(x?.end ?? "") && x?.title?.trim()).slice(0, 30);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b?.day ?? "") || !blocks.length) return NextResponse.json({ error: "Nothing to apply." }, { status: 400 });
  const day = b!.day!;
  const withIds: PlanBlock[] = blocks.map((x) => ({ ...x, blockId: x.blockId || blockId(day, x.start, x.title) }));
  try {
    // The JSON store is authoritative; the calendar events and vault note are mirrors of it. A plan
    // is useful even without Google Calendar — Today can still tick and move blocks.
    savePlan(day, withIds, { tz: b?.tz, summary: b?.summary ?? "", note: b?.note ?? "" });
    const vault = writePlanNote(day, withIds, b?.summary ?? "", b?.note ?? "");
    if (!calendarConnected()) return NextResponse.json({ ok: true, vault, calendar: false });
    try {
      await replacePlan(day, withIds);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const hint = /insufficient|scope|permission/i.test(msg) ? " Re-run google-auth on your PC to allow adding events." : "";
      return NextResponse.json({ ok: false, error: msg + hint, stored: true, vault }, { status: 500 });
    }
    return NextResponse.json({ ok: true, vault, calendar: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
