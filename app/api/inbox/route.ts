import { NextResponse } from "next/server";
import { inboxCount, inboxItems, invalidateInboxCount, markSeen } from "@/lib/inbox";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (new URL(request.url).searchParams.get("count")) return NextResponse.json({ count: await inboxCount() });
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
