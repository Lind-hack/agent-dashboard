import { NextResponse } from "next/server";
import { markMailDone, movePile, refreshMail, sortMail } from "@/lib/gmail";
import { invalidateInboxCount } from "@/lib/inbox";
import { draftReply } from "@/lib/mail-actions";
import { invalidateMemory } from "@/lib/memory";

export const dynamic = "force-dynamic";

// POST { action: "sort" } fetches the inbox and sorts every message into a pile;
// { action: "refresh" } only fetches; { action: "done", ids } hides; { action: "move", id, pile }.
export async function POST(request: Request) {
  const b = (await request.json().catch(() => null)) as { action?: string; ids?: string[]; id?: string; pile?: string; all?: boolean; note?: string } | null;
  try {
    if (b?.action === "sort" || b?.action === "refresh") {
      const { messages, error } = await refreshMail();
      if (error) return NextResponse.json({ error }, { status: 502 });
      invalidateMemory();
      invalidateInboxCount();
      if (b.action === "refresh") return NextResponse.json({ ok: true, total: messages.length });
      // One tap sorts up to 48 (about a minute on the free tier); the runner keeps going every few minutes.
      return NextResponse.json({ ok: true, total: messages.length, ...(await sortMail(!!b.all, 48)) });
    }
    if (b?.action === "done" && Array.isArray(b.ids)) {
      markMailDone(b.ids.filter((x) => typeof x === "string").slice(0, 200));
      invalidateInboxCount();
      return NextResponse.json({ ok: true });
    }
    // A reply drafted into that account's Gmail Drafts (never sent).
    if (b?.action === "draft" && typeof b.id === "string") {
      const r = await draftReply(b.id, typeof b.note === "string" ? b.note.slice(0, 1000) : "");
      return r.ok ? NextResponse.json(r) : NextResponse.json({ error: r.error }, { status: 409 });
    }
    if (b?.action === "move" && typeof b.id === "string" && typeof b.pile === "string") {
      return movePile(b.id, b.pile) ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "no such pile" }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
  return NextResponse.json({ error: "bad request" }, { status: 400 });
}
