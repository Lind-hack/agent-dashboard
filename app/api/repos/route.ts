import { NextResponse } from "next/server";
import { listRepos } from "@/lib/github";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ repos: await listRepos() });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err), repos: [] }, { status: 500 });
  }
}
