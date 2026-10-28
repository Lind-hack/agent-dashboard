import { NextResponse } from "next/server";
import { transcribeDetailed } from "@/lib/groq";
import { warmAlbanian } from "@/lib/tts";
import { voiceLang } from "@/lib/voices";
import { voiceAnswer, type VoiceTurn } from "@/lib/voice-brain";

export const dynamic = "force-dynamic";

// One spoken exchange with the Core: audio (or text) in → what you said + what the Core answers
// (+ an action for the client to confirm). The client then speaks the answer via /api/tts.
export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const audio = form.get("audio");
    let text = String(form.get("text") ?? "").trim();
    let hint: "en" | "sq" | undefined;
    if (audio instanceof Blob && audio.size) {
      const heard = await transcribeDetailed(audio, audio instanceof File && audio.name ? audio.name : "note.webm");
      text = heard.text;
      hint = voiceLang(heard.language);
    }
    // Confirming a proposed action: just what was said; the client decides yes/no.
    if (form.get("confirm") === "1") return NextResponse.json({ heard: text });
    if (!text) return NextResponse.json({ heard: "", say: "I didn't hear anything — tap and try again." });
    let history: VoiceTurn[] = [];
    try {
      const h = JSON.parse(String(form.get("history") ?? "[]"));
      if (Array.isArray(h)) history = h.filter((t) => (t?.role === "you" || t?.role === "core") && typeof t?.text === "string").map((t) => ({ role: t.role, text: String(t.text).slice(0, 800) }));
    } catch {}
    const answer = await voiceAnswer(text.slice(0, 2000), history, hint);
    if (answer.lang === "sq") warmAlbanian();
    return NextResponse.json({ heard: text, ...answer });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
