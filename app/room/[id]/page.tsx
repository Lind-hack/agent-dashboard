import { notFound } from "next/navigation";
import { RoomView } from "@/components/room-view";
import { readRoom } from "@/lib/rooms";

export const dynamic = "force-dynamic";

export default async function RoomPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const room = readRoom(id);
  if (!room) {
    // A room asked for a moment ago may not be written by the runner yet.
    if (/^R-[A-Z0-9]{6,12}$/.test(id)) {
      const now = new Date().toISOString();
      return <RoomView initial={{ id, task: "Starting the room…", agents: [], models: {}, judgeModel: "", status: "queued", rounds: [], budget: { calls: 0, used: 0 }, createdAt: now, updatedAt: now }} />;
    }
    notFound();
  }
  return <RoomView initial={room} />;
}
