import { NextResponse } from "next/server";
import { VPS_AGENTS, type AgentKey } from "@/lib/agents";
import { listRepos } from "@/lib/github";
import { transcribe } from "@/lib/groq";
import { seatByKey } from "@/lib/council";
import { PROVIDERS, providerOrder, type Provider } from "@/lib/llm";
import { listRooms, newRoom, newRoomId, readRoom, ROOMS_PER_DAY, writeRoom } from "@/lib/rooms";
import { pushInbox } from "@/lib/store";
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
    if (!isOwner()) return startForUser(form, task);
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

// Other accounts: the debaters are the AI keys they brought (plus council seats), and the room is written
// here; the runner picks it up on its next scan. No repo, but notes can be pasted as the evidence.
function startForUser(form: FormData, task: string) {
  const have = providerOrder();
  if (!have.length) return NextResponse.json({ error: "Add an AI key in Settings first" }, { status: 400 });
  const providers = [...new Set(String(form.get("providers") ?? "").split(","))].filter((p): p is Provider => PROVIDERS.includes(p as Provider) && have.includes(p as Provider));
  const seats = [...new Set(String(form.get("seats") ?? "").split(","))].filter((k) => !!seatByKey(k)).slice(0, 6);
  const n = providers.length + seats.length;
  if (n < 2 || n > 7) return NextResponse.json({ error: "Seat 2 to 7 at the table (your AIs and council seats)" }, { status: 400 });
  const day = new Date().toISOString().slice(0, 10);
  const today = listRooms().filter((r) => r.createdAt.startsWith(day)).length;
  if (today >= ROOMS_PER_DAY) return NextResponse.json({ error: `That's ${ROOMS_PER_DAY} debates today. Start this one tomorrow.` }, { status: 429 });
  const context = String(form.get("context") ?? "").slice(0, 30_000);
  const id = newRoomId();
  if (!readRoom(id)) writeRoom(newRoom({ id, task, agents: [], providers, seats, context }));
  return NextResponse.json({ id, href: `/room/${id}`, transcript: task });
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
