import { NextResponse } from "next/server";
import { finishConnect } from "@/lib/ticktick";
import { guarded } from "@/lib/guard";

// TickTick sends Lind back here after he approves. Behind the login cookie like everything else.
async function GET_(request: Request) {
  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host");
  const back = new URL("/calendar", host ? `https://${host}` : url.origin);
  try {
    await finishConnect(url.searchParams.get("code") ?? "", url.searchParams.get("state") ?? "");
    back.searchParams.set("ticktick", "connected");
  } catch (err) {
    back.searchParams.set("ticktick_error", err instanceof Error ? err.message : String(err));
  }
  return NextResponse.redirect(back);
}

export const GET = guarded(GET_, { owner: true });
