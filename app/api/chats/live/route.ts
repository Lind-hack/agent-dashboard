import { NextResponse } from "next/server";
import { liveChats } from "@/lib/chat-live";

export const dynamic = "force-dynamic";

// The chats board: what every working or waiting chat is doing right now (polled every few seconds).
export async function GET() {
  return NextResponse.json({ chats: liveChats() });
}
