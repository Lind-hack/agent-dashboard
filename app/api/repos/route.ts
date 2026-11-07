import { NextResponse } from "next/server";
import { listRepos } from "@/lib/github";
import { guarded } from "@/lib/guard";

export const dynamic = "force-dynamic";

async function GET_() {
  try {
    return NextResponse.json({ repos: await listRepos() });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err), repos: [] }, { status: 500 });
  }
}

export const GET = guarded(GET_, { owner: true });
