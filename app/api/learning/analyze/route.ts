import { NextResponse } from "next/server";
import { listItems, readItem, saveItem } from "@/lib/library";
import { emptyDigest, isStudyMaterial, learningOverview } from "@/lib/learning";

export const dynamic = "force-dynamic";

// POST { id } queues one item for the runner's Learning pass; POST {} queues every study item that
// has never been analysed. Re-analysing an item replaces its digest.
export async function POST(request: Request) {
  const b = (await request.json().catch(() => null)) as { id?: string } | null;
  const items = listItems();
  const targets = b?.id ? items.filter((i) => i.id === b.id) : items.filter((i) => isStudyMaterial(i) && !i.learning);
  let queued = 0;
  for (const it of targets) {
    const fresh = readItem(it.id);
    if (!fresh || !isStudyMaterial(fresh)) continue;
    // Re-analysing keeps the old digest visible until the new one lands.
    fresh.learning = { ...(fresh.learning?.state === "ready" ? fresh.learning : emptyDigest()), state: "queued", error: undefined, nextAt: undefined, attempts: 0 };
    saveItem(fresh);
    queued++;
  }
  if (b?.id && !targets.length) return NextResponse.json({ error: "That item can't be studied yet." }, { status: 400 });
  return NextResponse.json({ ok: true, queued, ...learningOverview(listItems()) });
}
