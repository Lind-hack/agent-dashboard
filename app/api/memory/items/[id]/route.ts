import { NextResponse } from "next/server";
import { deleteItem, readItem, readSections, saveItem } from "@/lib/library";
import { invalidateMemory } from "@/lib/memory";

export const dynamic = "force-dynamic";

// PATCH { title?, section?, retry? } — rename, move to another section, or run the automation again.
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const it = readItem(id);
  if (!it) return NextResponse.json({ error: "not found" }, { status: 404 });
  const b = (await request.json().catch(() => null)) as { title?: string; section?: string; retry?: boolean } | null;
  if (typeof b?.title === "string" && b.title.trim()) it.title = b.title.trim().slice(0, 120);
  if (typeof b?.section === "string") {
    if (!readSections().some((s) => s.id === b.section)) return NextResponse.json({ error: "No such section." }, { status: 400 });
    it.section = b.section;
  }
  if (b?.retry) {
    it.status = "queued";
    it.error = undefined;
    it.attempts = 0;
  }
  saveItem(it);
  invalidateMemory();
  return NextResponse.json({ item: it });
}

export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!deleteItem(id)) return NextResponse.json({ error: "not found" }, { status: 404 });
  invalidateMemory();
  return NextResponse.json({ ok: true });
}
