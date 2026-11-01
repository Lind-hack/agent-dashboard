import { NextResponse } from "next/server";
import { memoryGraph, memoryPreview } from "@/lib/memory";

export const dynamic = "force-dynamic";

// Every record as a light node for the Visual cortex; ?id= gives one record's text for the hover card.
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (id) {
    const p = await memoryPreview(id);
    return p ? NextResponse.json(p) : NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json(await memoryGraph());
}
