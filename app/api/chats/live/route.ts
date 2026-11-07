import { NextResponse } from "next/server";
import { liveChats } from "@/lib/chat-live";
import { guarded } from "@/lib/guard";

export const dynamic = "force-dynamic";

// The chats board: what every working or waiting chat is doing right now (polled every few seconds).
async function GET_() {
  return NextResponse.json({ chats: liveChats() });
}

export const GET = guarded(GET_, { owner: true });
