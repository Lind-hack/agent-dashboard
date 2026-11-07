import { NextResponse } from "next/server";
import { searchSources } from "@/lib/learning";
import { listItems } from "@/lib/library";
import { guarded } from "@/lib/guard";

export const dynamic = "force-dynamic";

// GET ?q= searches everything saved, inside transcripts and documents too.
async function GET_(request: Request) {
  return NextResponse.json({ hits: searchSources(listItems(), new URL(request.url).searchParams.get("q") ?? "") });
}

export const GET = guarded(GET_);
