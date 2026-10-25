import { NextResponse } from "next/server";
import { listRepos } from "@/lib/github";
import { abortUpload, finishUpload, jobIdFor, putChunk, startUpload, validateMeta, type HandoffMeta } from "@/lib/handoff";
import { pushInbox } from "@/lib/store";

export const dynamic = "force-dynamic";

// Hand-off v2 upload protocol, called by handoff/handoff.mjs on the PC (Bearer HANDOFF_TOKEN, see
// lib/bearer-routes.ts): start → chunk (transcript + context parts, ≤ 40 MB each) → finish.
export async function POST(request: Request, ctx: { params: Promise<{ action: string }> }) {
  const { action } = await ctx.params;
  const url = new URL(request.url);

  if (action === "start") {
    const meta = (await request.json().catch(() => null)) as HandoffMeta | null;
    const allowed = (await listRepos().catch(() => [])).map((r) => r.name);
    const invalid = validateMeta(meta, allowed);
    if (invalid) return NextResponse.json({ error: invalid, allowedRepos: allowed }, { status: 400 });
    const r = startUpload(meta!);
    return "error" in r ? NextResponse.json({ error: r.error }, { status: r.status }) : NextResponse.json(r);
  }

  if (action === "chunk") {
    const body = Buffer.from(await request.arrayBuffer());
    const err = putChunk(url.searchParams.get("upload") ?? "", url.searchParams.get("part") ?? "", Number(url.searchParams.get("index")), body, url.searchParams.get("sha256") ?? "");
    return err ? NextResponse.json({ error: err }, { status: 400 }) : NextResponse.json({ ok: true });
  }

  if (action === "finish") {
    const b = (await request.json().catch(() => null)) as { uploadId?: string; parts?: Record<"transcript" | "context", { chunks: number; sha256: string }> } | null;
    const r = await finishUpload(b?.uploadId ?? "", b?.parts as never);
    if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status });
    pushInbox({ kind: "sync" }); // wake the runner; it imports from the published folder
    const host = request.headers.get("x-forwarded-host");
    const origin = host ? `https://${host}` : url.origin;
    const id = jobIdFor(r.generation);
    return NextResponse.json({ jobId: id, url: `${origin}/jobs/${id}` });
  }

  if (action === "abort") {
    const b = (await request.json().catch(() => null)) as { uploadId?: string } | null;
    abortUpload(b?.uploadId ?? "");
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 404 });
}
