import { NextResponse } from "next/server";
import { invalidateMemory } from "@/lib/memory";
import { deleteMemory, updateMemory, type MemoryInput } from "@/lib/memories";

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const body = (await request.json().catch(() => null)) as MemoryInput | null;
  try {
    const item = updateMemory((await ctx.params).id, body ?? {});
    if (!item) return NextResponse.json({ error: "not found" }, { status: 404 });
    invalidateMemory();
    return NextResponse.json({ item });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}

export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!deleteMemory((await ctx.params).id)) return NextResponse.json({ error: "not found" }, { status: 404 });
  invalidateMemory();
  return NextResponse.json({ ok: true });
}
