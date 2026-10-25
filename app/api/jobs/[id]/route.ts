import { NextResponse } from "next/server";
import { pushInbox, readJob, readLog } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const job = readJob(id);
  if (!job) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ job, log: readLog(id) });
}

// { action: "reply", prompt } continues the Claude session; { action: "cancel" } stops it.
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!readJob(id)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = (await request.json().catch(() => null)) as { action?: string; prompt?: string } | null;
  if (body?.action === "cancel" || body?.action === "archive" || body?.action === "return" || body?.action === "keep") {
    pushInbox({ kind: body.action, jobId: id });
    return NextResponse.json({ ok: true });
  }
  if (body?.action === "reply" && body.prompt?.trim()) {
    pushInbox({ kind: "reply", jobId: id, prompt: body.prompt.trim() });
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "bad request" }, { status: 400 });
}
