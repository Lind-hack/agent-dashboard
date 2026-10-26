import { NextResponse } from "next/server";
import { VPS_AGENTS, type AgentKey } from "@/lib/agents";
import { listRepos } from "@/lib/github";
import { transcribe } from "@/lib/groq";
import { listRooms } from "@/lib/rooms";
import { pushInbox } from "@/lib/store";

export const dynamic = "force-dynamic";

// Start a Roast room: a task (typed and/or a voice note), 2–4 agents, an optional repo for the evidence.
// The runner owns the room file; this only queues the request (PLAN-v2 R14).
export async function POST(request: Request) {
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
    const agents = [...new Set(String(form.get("agents") ?? "").split(","))].filter((a): a is AgentKey => VPS_AGENTS.includes(a as AgentKey));
    if (agents.length < 2 || agents.length > 4) return NextResponse.json({ error: "Pick 2 to 4 agents" }, { status: 400 });
    const repoRaw = String(form.get("repo") ?? "");
    const repo = repoRaw ? (await listRepos()).map((r) => r.name).find((r) => r === repoRaw) : undefined;
    if (repoRaw && !repo) return NextResponse.json({ error: "That repo isn't on the dashboard's token" }, { status: 400 });
    const id = `R-${Date.now().toString(36).toUpperCase()}`;
    pushInbox({ kind: "room-create", room: { id, task, repo, agents } });
    return NextResponse.json({ id, href: `/room/${id}`, transcript: task });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    rooms: listRooms()
      .slice(0, 30)
      .map((r) => ({ id: r.id, task: r.task.split("\n")[0].slice(0, 140), agents: r.agents, status: r.status, outcome: r.verdict?.outcome, createdAt: r.createdAt })),
  });
}
