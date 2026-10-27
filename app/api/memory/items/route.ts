import { NextResponse } from "next/server";
import { invalidateMemory } from "@/lib/memory";
import { addMemory, listMemories, type MemoryInput } from "@/lib/memories";

export const dynamic = "force-dynamic";

// Memories Lind writes himself (lib/memories.ts). Cookie-authenticated like every page route.
export async function GET() {
  return NextResponse.json({ items: listMemories() });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as MemoryInput | null;
  try {
    const item = addMemory(body ?? {});
    invalidateMemory();
    return NextResponse.json({ item });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
