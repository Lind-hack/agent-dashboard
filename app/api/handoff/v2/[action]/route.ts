import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { listRepos } from "@/lib/github";
import { abortUpload, finishUpload, handoffDir, jobIdFor, putChunk, startUpload, validateMeta, type HandoffMeta } from "@/lib/handoff";
import { pushInbox, readJob } from "@/lib/store";

export const dynamic = "force-dynamic";

// Hand-off v2 upload protocol, called by handoff/handoff.mjs on the PC (Bearer HANDOFF_TOKEN, see
// lib/bearer-routes.ts): start → chunk (transcript + context parts, ≤ 8 MB each) → finish.
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

  // Take-back. `return` freezes the chat (idempotent — the PC polls it until the export is ready);
  // `complete` hands ownership to the PC once it has installed that exact export.
  if (action === "return" || action === "complete") {
    const b = (await request.json().catch(() => null)) as { sessionId?: string; generation?: string; exportDigest?: string } | null;
    const job = handoffJob(b?.sessionId, b?.generation);
    if (!job) return NextResponse.json({ error: "No such hand-off on the VPS." }, { status: 404 });
    if (action === "return") {
      if (job.owner === "pc") return NextResponse.json({ error: "This chat is already back on the PC." }, { status: 409 });
      if (job.status === "closed") return NextResponse.json({ error: "This chat was archived on the VPS — hand it off again instead." }, { status: 409 });
      if (job.status === "preparing") return NextResponse.json({ error: "Still preparing — try again in a minute." }, { status: 409 });
      if (job.owner === "vps") pushInbox({ kind: "return", jobId: job.id });
    } else {
      if (!b?.exportDigest || job.imported?.export?.digest !== b.exportDigest) return NextResponse.json({ error: "export digest doesn't match" }, { status: 409 });
      pushInbox({ kind: "complete", jobId: job.id, digest: b.exportDigest });
    }
    return NextResponse.json({ jobId: job.id, owner: job.owner, status: job.status, running: job.status === "running", export: job.imported?.export ?? null });
  }

  if (action === "abort") {
    const b = (await request.json().catch(() => null)) as { uploadId?: string } | null;
    abortUpload(b?.uploadId ?? "");
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 404 });
}

function handoffJob(sid?: string, gen?: string) {
  if (!sid || !gen || !handoffDir(sid, gen)) return null;
  const job = readJob(jobIdFor(gen));
  return job?.imported?.sessionId === sid ? job : null;
}

// GET export?session=&generation=&part=manifest|transcript — only once the runner has written it.
export async function GET(request: Request, ctx: { params: Promise<{ action: string }> }) {
  const { action } = await ctx.params;
  if (action !== "export") return NextResponse.json({ error: "unknown action" }, { status: 404 });
  const q = new URL(request.url).searchParams;
  const sid = q.get("session") ?? "";
  const gen = q.get("generation") ?? "";
  const job = handoffJob(sid, gen);
  if (!job || job.owner !== "returning" || job.imported?.export?.status !== "ready") return NextResponse.json({ error: "export not ready" }, { status: 409 });
  const file = path.join(handoffDir(sid, gen)!, "export", q.get("part") === "transcript" ? "transcript.jsonl" : "manifest.json");
  if (!fs.existsSync(file)) return NextResponse.json({ error: "not in this export" }, { status: 404 });
  const stream = Readable.toWeb(fs.createReadStream(file)) as ReadableStream;
  return new Response(stream, { headers: { "Content-Type": "application/octet-stream", "Content-Length": String(fs.statSync(file).size) } });
}
