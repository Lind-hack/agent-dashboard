import { NextResponse } from "next/server";
import { listRooms } from "@/lib/rooms";
import { listJobs } from "@/lib/store";

export const dynamic = "force-dynamic";

// What the command palette can jump to: recent chats and roast rooms (titles only).
export async function GET() {
  const chats = listJobs()
    .slice(0, 60)
    .map((j) => ({ id: j.id, title: j.title, agent: j.agent, status: j.status, href: `/jobs/${j.id}` }));
  const rooms = listRooms()
    .slice(0, 20)
    .map((r) => ({ id: r.id, title: r.task.split("\n")[0].slice(0, 140), agents: r.agents, status: r.status, href: `/room/${r.id}` }));
  return NextResponse.json({ chats, rooms });
}
