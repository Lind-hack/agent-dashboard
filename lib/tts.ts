import path from "node:path";
import { DATA_DIR } from "./config";
import { VOICES, type Speaker } from "./voices";

// Text → speech for one short piece (a sentence), as WAV. Two free engines, best first:
//   1. Groq Orpheus (canopylabs/orpheus-v1-english) — fast and expressive. Needs the model's terms
//      accepted once in the Groq console and has a free-tier cap; when it says no, it's skipped for a
//      while and Kokoro takes over. https://console.groq.com/docs/text-to-speech
//   2. Kokoro-82M on this VPS via kokoro-js (Apache-2.0) — unlimited, ~real-time on the VPS CPU, so
//      the client asks for one sentence at a time and plays while the next one renders.

export type Engine = "orpheus" | "kokoro";

let orpheusOffUntil = 0;
let orpheusWhy = "";

async function orpheus(text: string, voice: string, mood: string): Promise<Buffer | null> {
  const key = process.env.GROQ_API_KEY;
  if (!key || Date.now() < orpheusOffUntil || text.length > 200) return null;
  const input = `[${mood}] ${text}`.slice(0, 200);
  const res = await fetch("https://api.groq.com/openai/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "canopylabs/orpheus-v1-english", voice, input, response_format: "wav" }),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  if (res?.ok) return Buffer.from(await res.arrayBuffer());
  const body = (await res?.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
  // Terms not accepted / unknown model: look again in an hour. Quota or a hiccup: in five minutes.
  const code = body?.error?.code ?? "";
  orpheusWhy = body?.error?.message ?? (res ? `HTTP ${res.status}` : "unreachable");
  orpheusOffUntil = Date.now() + (/terms|model_not_found|permission/.test(code) || res?.status === 404 ? 3_600_000 : 300_000);
  return null;
}

// Kokoro: loaded once per server process (~300 MB, a minute on first download, ~1 s after), and run
// one piece at a time so a long reply can't starve the agents of CPU.
type Kokoro = { generate: (t: string, o: { voice: string; speed?: number }) => Promise<{ toWav: () => ArrayBuffer }> };
let kokoro: Promise<Kokoro> | null = null;
let kokoroReady = false;
let queue: Promise<unknown> = Promise.resolve();

function loadKokoro(): Promise<Kokoro> {
  kokoro ??= (async () => {
    const { env } = await import("@huggingface/transformers");
    env.cacheDir = path.join(DATA_DIR, "models");
    const { KokoroTTS } = await import("kokoro-js");
    const tts = (await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", { dtype: "fp32", device: "cpu" })) as unknown as Kokoro;
    kokoroReady = true;
    return tts;
  })().catch((e) => {
    kokoro = null; // try again next time
    throw e;
  });
  return kokoro;
}

// At most a few pieces wait their turn; a piece whose listener has gone (stopped, cut in) is skipped.
let waiting = 0;
const MAX_WAITING = 6;
async function kokoroWav(text: string, voice: string, signal?: AbortSignal): Promise<Buffer> {
  if (waiting >= MAX_WAITING) throw new Error("voice is busy — try again in a moment");
  const tts = await loadKokoro();
  waiting++;
  const run = queue.then(() => {
    waiting--;
    if (signal?.aborted) throw new Error("cancelled");
    return tts.generate(text, { voice });
  });
  queue = run.catch(() => {});
  return Buffer.from((await run).toWav());
}

// Recently spoken pieces, so replaying an answer is instant.
const cache = new Map<string, { wav: Buffer; engine: Engine }>();

export async function speak(text: string, who: Speaker, signal?: AbortSignal): Promise<{ wav: Buffer; engine: Engine }> {
  const v = VOICES[who];
  const key = `${who}\u0000${text}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const o = await orpheus(text, v.orpheus, v.mood).catch(() => null);
  const out: { wav: Buffer; engine: Engine } = o ? { wav: o, engine: "orpheus" } : { wav: await kokoroWav(text, v.kokoro, signal), engine: "kokoro" };
  cache.set(key, out);
  if (cache.size > 80) cache.delete(cache.keys().next().value as string);
  return out;
}

export function ttsStatus() {
  return { orpheus: Date.now() < orpheusOffUntil ? `off: ${orpheusWhy}` : process.env.GROQ_API_KEY ? "on" : "no GROQ_API_KEY", kokoro: kokoroReady ? "ready" : kokoro ? "loading" : "loads on first use" };
}

// Warm Kokoro in the background (~300 MB from the local cache) as soon as the voice UI opens. Orpheus
// is tried first when it works, but if it is unavailable this is what keeps the Core from going
// silent for the first sentence — the load happens while Lind is still talking.
export function warmKokoro() {
  void loadKokoro().catch(() => {});
}
