import { NextResponse } from "next/server";
import { validSkills } from "@/lib/skills";
import { pushInbox, readJob, readLog } from "@/lib/store";
import { guarded } from "@/lib/guard";

export const dynamic = "force-dynamic";

async function GET_(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const job = readJob(id);
  if (!job) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ job, log: readLog(id) });
}

// { action: "reply", prompt } continues the Claude session; { action: "cancel" } stops it.
async function POST_(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const job = readJob(id);
  if (!job) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = (await request.json().catch(() => null)) as { action?: string; prompt?: string; skills?: unknown } | null;
  if (body?.action === "cancel" || body?.action === "archive" || body?.action === "return" || body?.action === "keep") {
    pushInbox({ kind: body.action, jobId: id });
    return NextResponse.json({ ok: true });
  }
  if (body?.action === "reply") {
    // Skills picked with "/" travel as their own field; only ones this agent really has survive.
    const agent = job.agent === "codex" || job.agent === "opencode" || job.agent === "hermes" ? job.agent : "claude";
    const skills = validSkills(agent, body.skills);
    const prompt = (body.prompt ?? "").trim();
    if (!prompt && !skills.length) return NextResponse.json({ error: "Type a message or pick a skill" }, { status: 400 });
    pushInbox({ kind: "reply", jobId: id, prompt, ...(skills.length ? { skills } : {}) });
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "bad request" }, { status: 400 });
}

export const GET = guarded(GET_, { owner: true });
export const POST = guarded(POST_, { owner: true });
