import { NextResponse } from "next/server";
import { promptWithSkills } from "@/lib/skills";
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
  const job = readJob(id);
  if (!job) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = (await request.json().catch(() => null)) as { action?: string; prompt?: string; skills?: unknown } | null;
  if (body?.action === "cancel" || body?.action === "archive" || body?.action === "return" || body?.action === "keep") {
    pushInbox({ kind: body.action, jobId: id });
    return NextResponse.json({ ok: true });
  }
  if (body?.action === "reply" && body.prompt?.trim()) {
    // Skills picked with "/" become this agent's own invocation (unknown names are dropped).
    const skills = Array.isArray(body.skills) ? body.skills.filter((x): x is string => typeof x === "string").slice(0, 6) : [];
    const agent = job.agent === "codex" || job.agent === "opencode" || job.agent === "hermes" ? job.agent : "claude";
    pushInbox({ kind: "reply", jobId: id, prompt: promptWithSkills(agent, skills, body.prompt.trim()) });
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "bad request" }, { status: 400 });
}
