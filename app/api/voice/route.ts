import { NextResponse } from "next/server";
import { transcribeDetailed } from "@/lib/groq";
import { fastCoreSpeech, speak, warmAlbanian, warmKokoro } from "@/lib/tts";
import { voiceLang } from "@/lib/voices";
import { magpieReady } from "@/lib/magpie";
import { voiceAnswer, warmVoiceContext, type VoiceTurn } from "@/lib/voice-brain";

export const dynamic = "force-dynamic";

// Authenticated prewarm: keep model loading and remote context off the post-speech path.
export async function GET() {
  void warmVoiceContext().catch(() => {});
  warmAlbanian();
  if (!magpieReady()) warmKokoro();
  return NextResponse.json({ warming: true }, { headers: { "Cache-Control": "no-store" } });
}

// One spoken exchange with the Core: audio (or text) in → what you said + what the Core answers
// (+ an action for the client to confirm). The client then speaks the answer via /api/tts.
export async function POST(request: Request) {
  try {
    const start = performance.now();
    let sttMs = 0;
    const form = await request.formData();
    const audio = form.get("audio");
    let text = String(form.get("text") ?? "").trim();
    let hint: "en" | "sq" | undefined;
    if (audio instanceof Blob && audio.size) {
      const sttStart = performance.now();
      const heard = await transcribeDetailed(audio, audio instanceof File && audio.name ? audio.name : "note.webm");
      text = heard.text;
      hint = voiceLang(heard.language);
      sttMs = performance.now() - sttStart;
    }
    // Confirming a proposed action: just what was said; the client decides yes/no.
    if (form.get("confirm") === "1") return NextResponse.json({ heard: text });
    if (!text) return NextResponse.json({ heard: "", say: "I didn't hear anything — tap and try again." });
    let history: VoiceTurn[] = [];
    try {
      const h = JSON.parse(String(form.get("history") ?? "[]"));
      if (Array.isArray(h)) history = h.filter((t) => (t?.role === "you" || t?.role === "core") && typeof t?.text === "string").map((t) => ({ role: t.role, text: String(t.text).slice(0, 800) }));
    } catch {}
    const nativeVoices = String(form.get("nativeVoices") ?? "").split(",");
    if (form.get("prepareAudio") === "1") {
      if (hint === "sq" || /shqip|albanian|[ëç]/i.test(text)) { if (!nativeVoices.includes("sq")) warmAlbanian(); }
      else if (!nativeVoices.includes("en") && !magpieReady()) warmKokoro();
    }
    const brainStart = performance.now();
    const answer = await voiceAnswer(text.slice(0, 2000), history, hint);
    const brainMs = performance.now() - brainStart;
    const ttsStart = performance.now();
    if (answer.lang === "sq" && !nativeVoices.includes("sq")) warmAlbanian();
    // Prepare one continuous utterance while still in the turn request, so a client without
    // a native voice does not need another round trip for every sentence.
    let preparedAudio: { base64: string; engine: string } | undefined;
    if (form.get("prepareAudio") === "1") {
      const prompt = answer.action ? (answer.lang === "sq" ? " Ta nis?" : " Shall I go ahead?") : "";
      try {
        const spoken = answer.say + prompt;
        const rendered = await fastCoreSpeech(spoken, answer.lang, request.signal)
          ?? (!nativeVoices.includes(answer.lang) ? await speak(spoken, "core", request.signal, answer.lang, true) : null);
        if (rendered) preparedAudio = { base64: rendered.wav.toString("base64"), engine: rendered.engine };
      } catch { /* The client keeps its normal retry/device fallback if preparation failed. */ }
    }
    return NextResponse.json({ heard: text, ...answer, ...(preparedAudio ? { audio: preparedAudio } : {}) }, { headers: {
      "Server-Timing": `stt;dur=${sttMs.toFixed(1)}, brain;dur=${brainMs.toFixed(1)}, speech;dur=${(performance.now() - ttsStart).toFixed(1)}, total;dur=${(performance.now() - start).toFixed(1)}`,
      "Cache-Control": "no-store",
    } });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
