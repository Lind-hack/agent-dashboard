import { NextResponse } from "next/server";
import { transcribe } from "@/lib/groq";
import { voiceAnswer, type VoiceTurn } from "@/lib/voice-brain";

export const dynamic = "force-dynamic";

// One spoken exchange with the Core: audio (or text) in → what you said + what the Core answers
// (+ an action for the client to confirm). The client then speaks the answer via /api/tts.
export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const audio = form.get("audio");
    let text = String(form.get("text") ?? "").trim();
    if (audio instanceof Blob && audio.size) text = await transcribe(audio, audio instanceof File && audio.name ? audio.name : "note.webm");
    // Confirming a proposed action: just what was said; the client decides yes/no.
    if (form.get("confirm") === "1") return NextResponse.json({ heard: text });
    if (!text) return NextResponse.json({ heard: "", say: "I didn't hear anything — tap and try again." });
    let history: VoiceTurn[] = [];
    try {
      const h = JSON.parse(String(form.get("history") ?? "[]"));
      if (Array.isArray(h)) history = h.filter((t) => (t?.role === "you" || t?.role === "core") && typeof t?.text === "string").map((t) => ({ role: t.role, text: String(t.text).slice(0, 800) }));
    } catch {}
    return NextResponse.json({ heard: text, ...(await voiceAnswer(text.slice(0, 2000), history)) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
