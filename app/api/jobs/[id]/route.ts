import { NextResponse } from "next/server";
import { attachmentPrompt } from "@/lib/attachments";
import { validSkills } from "@/lib/skills";
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
  const body = (await request.json().catch(() => null)) as { action?: string; prompt?: string; skills?: unknown; attachments?: unknown } | null;
  if (body?.action === "cancel" || body?.action === "archive" || body?.action === "return" || body?.action === "keep") {
    pushInbox({ kind: body.action, jobId: id });
    return NextResponse.json({ ok: true });
  }
  if (body?.action === "reply") {
    // Skills picked with "/" travel as their own field; only ones this agent really has survive.
    const agent = job.agent === "codex" || job.agent === "opencode" || job.agent === "hermes" ? job.agent : "claude";
    const skills = validSkills(agent, body.skills);
    let prompt: string;
    try {
      if (body.prompt !== undefined && typeof body.prompt !== "string") throw new Error("Invalid message.");
      prompt = (body.prompt ?? "").trim() + attachmentPrompt(body.attachments);
    } catch (err) { return NextResponse.json({ error: err instanceof Error ? err.message : "Invalid attachments." }, { status: 400 }); }
    if (!prompt && !skills.length) return NextResponse.json({ error: "Type a message or pick a skill" }, { status: 400 });
    pushInbox({ kind: "reply", jobId: id, prompt, ...(skills.length ? { skills } : {}) });
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "bad request" }, { status: 400 });
}
