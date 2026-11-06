import { NextResponse } from "next/server";
import { searchSources } from "@/lib/learning";
import { listItems } from "@/lib/library";

export const dynamic = "force-dynamic";

// GET ?q= searches everything saved, inside transcripts and documents too.
export async function GET(request: Request) {
  return NextResponse.json({ hits: searchSources(listItems(), new URL(request.url).searchParams.get("q") ?? "") });
}
