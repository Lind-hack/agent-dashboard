import { NextResponse } from "next/server";
import { transcribe, transcribeDetailed } from "@/lib/groq";
import { sayVocabulary } from "@/lib/say";
import { guarded } from "@/lib/guard";

// Voice replies inside a chat: audio in, text out (the reply box shows it before sending).
// mode=say (v5.4): "Say it" — the accurate Whisper model, primed with his goals, tasks and names.
async function POST_(request: Request) {
  try {
    const form = await request.formData();
    const audio = form.get("audio");
    if (!(audio instanceof Blob) || !audio.size) return NextResponse.json({ error: "No audio" }, { status: 400 });
    const name = audio instanceof File && audio.name ? audio.name : "note.webm";
    if (form.get("mode") === "say") return NextResponse.json({ text: (await transcribeDetailed(audio, name, { accurate: true, prompt: sayVocabulary() })).text });
    return NextResponse.json({ text: await transcribe(audio, name) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export const POST = guarded(POST_);
