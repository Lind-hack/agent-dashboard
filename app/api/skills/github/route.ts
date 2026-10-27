import { NextResponse } from "next/server";
import { parseGithubUrl } from "@/lib/skills";
import { pushInbox } from "@/lib/store";

export const dynamic = "force-dynamic";

// POST { url }: Settings → "Add a skill from GitHub". The runner fetches, validates and installs it.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { url?: unknown } | null;
  const url = typeof body?.url === "string" ? body.url.trim() : "";
  if (url.length > 500 || !parseGithubUrl(url)) return NextResponse.json({ error: "Paste a github.com repo or folder link" }, { status: 400 });
  pushInbox({ kind: "skill-install", url });
  return NextResponse.json({ ok: true });
}
