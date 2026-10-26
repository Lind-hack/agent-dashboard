import { NextResponse } from "next/server";
import { inboxCount, inboxItems, invalidateInboxCount, markSeen } from "@/lib/inbox";
import { listRooms } from "@/lib/rooms";
import { listJobs } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  // The shell polls this: the badge count, and which agents are working (the Core lights up for them).
  if (new URL(request.url).searchParams.get("count")) {
    const debating = listRooms()
      .filter((r) => r.status === "debating")
      .flatMap((r) => r.agents.filter((a) => r.rounds.at(-1)?.answers[a]?.status === "running"));
    const working = [...new Set([...listJobs().filter((j) => j.status === "running").map((j) => j.agent), ...debating])];
    return NextResponse.json({ count: await inboxCount(), working });
  }
  return NextResponse.json({ items: await inboxItems() });
}

// { seen: [keys] } — sent with sendBeacon when an item is opened or marked done.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { seen?: unknown } | null;
  const keys = Array.isArray(body?.seen) ? body.seen.filter((k): k is string => typeof k === "string").slice(0, 500) : [];
  if (keys.length) {
    markSeen(keys);
    invalidateInboxCount();
  }
  return NextResponse.json({ ok: true });
}
