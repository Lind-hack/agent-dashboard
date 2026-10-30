import { NextResponse } from "next/server";
import { setSourceToggle } from "@/lib/library";
import { invalidateMemory, SOURCE_KINDS, type SourceKind } from "@/lib/memory";

export const dynamic = "force-dynamic";

// POST { kind, on } switches a source in or out of search; POST { refresh: true } rebuilds the index.
export async function POST(request: Request) {
  const b = (await request.json().catch(() => null)) as { kind?: string; on?: boolean; refresh?: boolean } | null;
  if (b?.refresh) {
    invalidateMemory();
    return NextResponse.json({ ok: true });
  }
  if (!SOURCE_KINDS.includes(b?.kind as SourceKind) || typeof b?.on !== "boolean") return NextResponse.json({ error: "bad request" }, { status: 400 });
  setSourceToggle(b.kind as string, b.on);
  invalidateMemory();
  return NextResponse.json({ ok: true });
}
