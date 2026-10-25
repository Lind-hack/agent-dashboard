import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { readJSON } from "@/lib/handoff";
import { readJob } from "@/lib/store";

export const dynamic = "force-dynamic";

// What a handed-off chat carries: the dossier and the list of sources in its .handoff/ folder.
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const job = readJob(id);
  if (!job?.imported) return NextResponse.json({ error: "not a hand-off" }, { status: 404 });
  const dir = job.imported.contextDir;
  const sources = dir ? readJSON<Record<string, unknown>>(path.join(dir, "sources.json")) : null;
  let dossier = "";
  try {
    if (dir) dossier = fs.readFileSync(path.join(dir, "DOSSIER.md"), "utf8");
  } catch {
    /* not written (yet) */
  }
  return NextResponse.json({ imported: job.imported, branch: job.branch, repo: job.repo, sources, dossier });
}
