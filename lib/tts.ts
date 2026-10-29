import path from "node:path";
import { magpieWav } from "./magpie";
import { DATA_DIR } from "./config";
import { piperStatus, piperWav, warmPiper } from "./piper-client";
import { VOICES, looksAlbanian, type Speaker, type VoiceLang } from "./voices";

// Text → speech for one short piece (a sentence), as WAV. Three free engines:
//   1. Groq Orpheus (canopylabs/orpheus-v1-english) — fast and expressive. Needs the model's terms
//      accepted once in the Groq console and has a free-tier cap; when it says no, it's skipped for a
//      while and Kokoro takes over. https://console.groq.com/docs/text-to-speech
//   2. Kokoro-82M on this VPS via kokoro-js (Apache-2.0) — unlimited, ~real-time on the VPS CPU, so
//      the client asks for one sentence at a time and plays while the next one renders.
//   3. Piper's Albanian voice on this VPS (lib/piper.ts) — used for Albanian; the other two are
//      English-only.

export type Engine = "orpheus" | "kokoro" | "piper" | "magpie";

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
  waiting++;
  const run = queue.then(async () => {
    const tts = await loadKokoro();
    if (signal?.aborted) throw new Error("cancelled");
    return tts.generate(text, { voice });
  });
  queue = run.catch(() => {});
  try { return Buffer.from((await run).toWav()); } finally { waiting--; }
}

// Recently spoken pieces, so replaying an answer is instant.
const cache = new Map<string, { wav: Buffer; engine: Engine }>();

// Prefer GPU English speech for conversation; return null promptly so native/local voices can take over.
export async function fastCoreSpeech(text: string, lang: VoiceLang, signal?: AbortSignal): Promise<{ wav: Buffer; engine: Engine } | null> {
  if (lang !== "en") return null;
  const key = `core\u0000en\u0000${text}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const wav = await magpieWav(text, signal);
  if (!wav) return null;
  const out = { wav, engine: "magpie" as const };
  cache.set(key, out);
  if (cache.size > 80) cache.delete(cache.keys().next().value as string);
  return out;
}

export async function speak(text: string, who: Speaker, signal?: AbortSignal, lang: VoiceLang | "auto" = "auto", preferLocal = false): Promise<{ wav: Buffer; engine: Engine }> {
  const v = VOICES[who];
  const albanian = lang === "sq" || (lang === "auto" && looksAlbanian(text));
  const key = `${who}\u0000${albanian ? "sq" : "en"}\u0000${text}`;
  const hit = cache.get(key);
  if (hit) return hit;

  if (albanian) {
    try {
      const out: { wav: Buffer; engine: Engine } = { wav: await piperWav(text, signal), engine: "piper" };
      cache.set(key, out);
      if (cache.size > 80) cache.delete(cache.keys().next().value as string);
      return out;
    } catch (e) {
      // An explicit Albanian request should fail (the client can fall back to the browser's voice)
      // rather than be read with English phonemes. "auto" can still try the English engines.
      if (lang === "sq") throw e;
    }
  }

  const accelerated = who === "core" ? await fastCoreSpeech(text, "en", signal) : null;
  if (accelerated) return accelerated;
  const o = preferLocal ? null : await orpheus(text, v.orpheus, v.mood).catch(() => null);
  const out: { wav: Buffer; engine: Engine } = o ? { wav: o, engine: "orpheus" } : { wav: await kokoroWav(text, v.kokoro, signal), engine: "kokoro" };
  cache.set(key, out);
  if (cache.size > 80) cache.delete(cache.keys().next().value as string);
  return out;
}

export function ttsStatus() {
  return {
    orpheus: Date.now() < orpheusOffUntil ? `off: ${orpheusWhy}` : process.env.GROQ_API_KEY ? "on" : "no GROQ_API_KEY",
    kokoro: kokoroReady ? "ready" : kokoro ? "loading" : "loads on first use",
    piper: piperStatus(),
  };
}

// Warm Kokoro in the background (first download is ~300 MB) when it's the voice in use, so the first
// spoken reply isn't slow. With Orpheus working it stays unloaded until a fallback is needed.
export function warmKokoro() {
  void loadKokoro().catch(() => {});
}

// Start downloading/loading the Albanian voice as soon as a turn is detected as Albanian, so the
// first spoken reply is not also waiting for 60 MB.
export function warmAlbanian() {
  warmPiper();
}
