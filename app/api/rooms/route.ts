import { NextResponse } from "next/server";
import { VPS_AGENTS, type AgentKey } from "@/lib/agents";
import { listRepos } from "@/lib/github";
import { transcribe } from "@/lib/groq";
import { startRoom } from "@/lib/room-start";
import { listRooms } from "@/lib/rooms";
import { guarded } from "@/lib/guard";
import { isOwner } from "@/lib/tenant";

export const dynamic = "force-dynamic";

// Start a Roast room: a task (typed and/or a voice note), 2–4 agents, an optional repo for the evidence.
// The runner owns the room file; this only queues the request (PLAN-v2 R14).
async function POST_(request: Request) {
  try {
    const form = await request.formData();
    let task = String(form.get("text") ?? "").trim();
    const audio = form.get("audio");
    if (audio instanceof Blob && audio.size > 0) {
      const name = audio instanceof File && audio.name ? audio.name : "note.webm";
      task = [task, await transcribe(audio, name)].filter(Boolean).join("\n\n");
    }
    if (!task) return NextResponse.json({ error: "Say or type what they should debate" }, { status: 400 });
    if (task.length > 8000) return NextResponse.json({ error: "Keep the task under 8,000 characters" }, { status: 400 });
    const list = (k: string) => [...new Set(String(form.get(k) ?? "").split(","))].filter(Boolean);
    let repo: string | undefined;
    if (isOwner()) {
      const repoRaw = String(form.get("repo") ?? "");
      repo = repoRaw ? (await listRepos()).map((r) => r.name).find((r) => r === repoRaw) : undefined;
      if (repoRaw && !repo) return NextResponse.json({ error: "That repo isn't on the dashboard's token" }, { status: 400 });
    }
    const r = startRoom({
      task,
      repo,
      agents: list("agents").filter((a): a is AgentKey => VPS_AGENTS.includes(a as AgentKey)),
      providers: list("providers"),
      seats: list("seats"),
      context: String(form.get("context") ?? ""),
    });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json({ id: r.id, href: `/room/${r.id}`, transcript: task });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

async function GET_() {
  return NextResponse.json({
    rooms: listRooms()
      .slice(0, 30)
      .map((r) => ({ id: r.id, task: r.task.split("\n")[0].slice(0, 140), agents: r.agents, providers: r.providers ?? [], seats: r.seats ?? [], status: r.status, outcome: r.verdict?.outcome, decision: r.verdict?.decision, createdAt: r.createdAt })),
  });
}

export const POST = guarded(POST_);
export const GET = guarded(GET_);
