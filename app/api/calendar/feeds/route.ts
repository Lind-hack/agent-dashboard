import { NextResponse } from "next/server";
import { calendarConnected } from "@/lib/calendar";
import { guarded } from "@/lib/guard";
import { googleOAuthReady } from "@/lib/google-oauth";
import { addFeed, listFeeds, removeFeed } from "@/lib/ics";
import { isOwner } from "@/lib/tenant";

export const dynamic = "force-dynamic";

// The account's calendars. GET → { google, googleReady, feeds } (the links are secret: only the host is shown).
// POST { url, name? } adds a private calendar link after reading it once. DELETE { id } removes one.
const view = () => ({
  owner: isOwner(),
  google: calendarConnected(),
  googleReady: googleOAuthReady(),
  feeds: listFeeds().map((f) => ({ id: f.id, name: f.name, host: new URL(f.url).hostname, error: f.error ?? null, okAt: f.okAt ?? null })),
});

async function GET_() {
  return NextResponse.json(view());
}

async function POST_(req: Request) {
  const b = (await req.json().catch(() => null)) as { url?: string; name?: string } | null;
  if (listFeeds().length >= 10) return NextResponse.json({ error: "Ten calendar links is the limit" }, { status: 400 });
  try {
    await addFeed(String(b?.url ?? ""), b?.name);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Couldn't read that calendar" }, { status: 400 });
  }
  return NextResponse.json(view());
}

async function DELETE_(req: Request) {
  const b = (await req.json().catch(() => null)) as { id?: string } | null;
  removeFeed(String(b?.id ?? ""));
  return NextResponse.json(view());
}

export const GET = guarded(GET_);
export const POST = guarded(POST_);
export const DELETE = guarded(DELETE_);
