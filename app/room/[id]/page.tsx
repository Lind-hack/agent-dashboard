import { notFound } from "next/navigation";
import { RoomView } from "@/components/room-view";
import { listRepos } from "@/lib/github";
import { readRoom, ROOM_ID_RE } from "@/lib/rooms";

export const dynamic = "force-dynamic";

export default async function RoomPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const room = readRoom(id);
  if (!room) {
    // A room asked for a moment ago may not be written by the runner yet.
    if (ROOM_ID_RE.test(id)) {
      const now = new Date().toISOString();
      const repos = (await listRepos().catch(() => [])).map((r) => r.name);
      return <RoomView repos={repos} initial={{ id, task: "Starting the room…", agents: [], models: {}, judgeModel: "", status: "queued", rounds: [], budget: { calls: 0, used: 0 }, createdAt: now, updatedAt: now }} />;
    }
    notFound();
  }
  const repos = room.repo ? [] : (await listRepos().catch(() => [])).map((r) => r.name);
  return <RoomView initial={room} repos={repos} />;
}
