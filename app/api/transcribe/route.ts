import { NextResponse } from "next/server";
import { transcribe } from "@/lib/groq";

// Voice replies inside a chat: audio in, text out (the reply box shows it before sending).
export async function POST(request: Request) {
  try {
    const audio = (await request.formData()).get("audio");
    if (!(audio instanceof Blob) || !audio.size) return NextResponse.json({ error: "No audio" }, { status: 400 });
    const name = audio instanceof File && audio.name ? audio.name : "note.webm";
    return NextResponse.json({ text: await transcribe(audio, name) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
