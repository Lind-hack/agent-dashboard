import { NextResponse } from "next/server";
import { VPS_AGENTS, type AgentKey } from "@/lib/agents";
import { listRepos } from "@/lib/github";
import { transcribe } from "@/lib/groq";
import { seatByKey } from "@/lib/council";
import { listRooms, newRoomId } from "@/lib/rooms";
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
    const seats = [...new Set(String(form.get("seats") ?? "").split(","))].filter((k) => !!seatByKey(k)).slice(0, 6);
    if (agents.length > 4) return NextResponse.json({ error: "At most 4 agents" }, { status: 400 });
    if (agents.length + seats.length < 2 || agents.length + seats.length > 7) return NextResponse.json({ error: "Seat 2 to 7 at the table (agents and council seats)" }, { status: 400 });
    const repoRaw = String(form.get("repo") ?? "");
    const repo = repoRaw ? (await listRepos()).map((r) => r.name).find((r) => r === repoRaw) : undefined;
    if (repoRaw && !repo) return NextResponse.json({ error: "That repo isn't on the dashboard's token" }, { status: 400 });
    const id = newRoomId();
    pushInbox({ kind: "room-create", room: { id, task, repo, agents, seats } });
    return NextResponse.json({ id, href: `/room/${id}`, transcript: task });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    rooms: listRooms()
      .slice(0, 30)
      .map((r) => ({ id: r.id, task: r.task.split("\n")[0].slice(0, 140), agents: r.agents, seats: r.seats ?? [], status: r.status, outcome: r.verdict?.outcome, decision: r.verdict?.decision, createdAt: r.createdAt })),
  });
}
