import { NextResponse } from "next/server";
import { coachNow } from "@/lib/coach";
import { confirmRound, currentSession, drillTerm, finishSession, gradeRound, overrideTerm, readRun, startCustom, startSunday, type Mark } from "@/lib/learning-sunday";
import { guarded } from "@/lib/guard";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// The blurting sessions (v6). GET → this week's. POST { action }:
// start · custom { itemIds } · blurt { id, round, text } · override { id, round, key, status } ·
// confirm { id, round } · drill { id, round, key, got } · finish { id }. All answer with the session.
async function GET_() {
  return NextResponse.json({ session: currentSession(coachNow().day) });
}

async function POST_(request: Request) {
  const b = (await request.json().catch(() => null)) as { action?: string; id?: string; round?: string; text?: string; key?: string; status?: string; got?: boolean; itemIds?: unknown } | null;
  const id = String(b?.id ?? "");
  const round = String(b?.round ?? "");
  try {
    switch (b?.action) {
      case "start":
        return NextResponse.json({ session: startSunday(coachNow().day) });
      case "custom":
        return NextResponse.json({ session: startCustom(Array.isArray(b.itemIds) ? b.itemIds.map(String) : []) });
      case "blurt":
        await gradeRound(id, round, String(b.text ?? ""));
        break;
      case "override":
        if (!["recalled", "partial", "missed"].includes(String(b.status))) return NextResponse.json({ error: "Unknown mark." }, { status: 400 });
        overrideTerm(id, round, String(b.key), b.status as Mark);
        break;
      case "confirm":
        confirmRound(id, round);
        break;
      case "drill":
        drillTerm(id, round, String(b.key), !!b.got);
        break;
      case "finish":
        finishSession(id);
        break;
      default:
        return NextResponse.json({ error: "Unknown action." }, { status: 400 });
    }
    return NextResponse.json({ session: readRun(id) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "That didn't work.", session: readRun(id) }, { status: 502 });
  }
}

export const GET = guarded(GET_);
export const POST = guarded(POST_);
