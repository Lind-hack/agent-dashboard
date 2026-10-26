import { NextResponse } from "next/server";
import { AGENT_LABELS, AGENT_META, VPS_AGENTS, type AgentKey } from "@/lib/agents";
import { listRepos } from "@/lib/github";
import { readRoom } from "@/lib/rooms";
import { pushInbox } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const room = readRoom((await ctx.params).id);
  return room ? NextResponse.json({ room }) : NextResponse.json({ error: "not found" }, { status: 404 });
}

// { action: "cancel" } stops a room; { action: "run", agent } hands the verdict to one agent as a normal chat
// (on its own branch, like any chat) — the only way a debate turns into changes, and it needs Lind's tap.
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const room = readRoom((await ctx.params).id);
  if (!room) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = (await request.json().catch(() => null)) as { action?: string; agent?: string } | null;

  if (body?.action === "cancel") {
    pushInbox({ kind: "room-cancel", roomId: room.id });
    return NextResponse.json({ ok: true });
  }

  if (body?.action === "run") {
    const agent = VPS_AGENTS.find((a) => a === body.agent) as AgentKey | undefined;
    if (!agent) return NextResponse.json({ error: "Pick an agent" }, { status: 400 });
    if (!room.verdict || room.verdict.outcome === "no-verdict") return NextResponse.json({ error: "This room has no verdict to run" }, { status: 409 });
    const repo = AGENT_META[agent].repo ? (room.repo ?? (await listRepos())[0]?.name ?? "") : "";
    const id = `C-${Date.now().toString(36).toUpperCase()}`;
    const prompt = `${room.task}

## Verdict from the Roast room (${room.id}, ${room.verdict.outcome}, judged by ${room.verdict.model})
${room.verdict.recommendation}
${room.verdict.next_step ? `\nNext step: ${room.verdict.next_step}` : ""}
${room.verdict.dissent.length ? `\nDissent to keep in mind:\n${room.verdict.dissent.map((d) => `- ${d}`).join("\n")}` : ""}

Carry out the recommendation. It's a recommendation from a debate, not proof: verify its claims in the code before relying on them.`;
    pushInbox({ kind: "create", chat: { id, agent, repo, title: `Room verdict → ${AGENT_LABELS[agent]}: ${room.task.split("\n")[0].slice(0, 60)}`, prompt, source: "dashboard" } });
    return NextResponse.json({ href: `/jobs/${id}` });
  }

  return NextResponse.json({ error: "bad request" }, { status: 400 });
}
