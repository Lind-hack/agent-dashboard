import { NextResponse } from "next/server";
import { speak, ttsStatus, warmAlbanian, warmKokoro } from "@/lib/tts";
import { isSpeaker } from "@/lib/voices";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST { text, who, lang }: one short piece (a sentence) as WAV, in that agent's voice. The client
// splits replies into sentences and plays each while the next renders. `lang` is "sq" for Albanian,
// "en" to force English, or omitted/"auto" to detect it from the text.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { text?: unknown; who?: unknown; lang?: unknown } | null;
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text || text.length > 400) return NextResponse.json({ error: "Send 1–400 characters" }, { status: 400 });
  const who = isSpeaker(body?.who) ? body.who : "core";
  const lang = body?.lang === "sq" || body?.lang === "en" ? body.lang : "auto";
  try {
    const { wav, engine } = await speak(text, who, request.signal, lang);
    return new Response(new Uint8Array(wav), { headers: { "Content-Type": "audio/wav", "Cache-Control": "private, max-age=3600", "X-Voice-Engine": engine } });
  } catch (e) {
    return NextResponse.json({ error: `Voice unavailable: ${e instanceof Error ? e.message : e}` }, { status: 503 });
  }
}

// GET: which engines are up — and starts loading the one the caller is about to use, so the first
// reply isn't slow. `?lang=sq` warms the Albanian voice; anything else warms Kokoro.
export async function GET(request: Request) {
  if (new URL(request.url).searchParams.get("lang") === "sq") warmAlbanian();
  else warmKokoro();
  return NextResponse.json(ttsStatus());
}
