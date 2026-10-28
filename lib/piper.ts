import fs from "node:fs/promises";
import path from "node:path";
import type { ESpeakNGWorker } from "@echogarden/espeak-ng-emscripten";
import { DATA_DIR } from "./config";

// Albanian text → speech, entirely on this VPS. The voice is Piper's sq_AL-edon-medium model
// (CC0, trained by Edon Sekiraqa on rhasspy/piper-voices); eSpeak-NG turns text into the IPA the
// model expects. Kokoro and Orpheus are English-only. eSpeak-NG is GPL-3.0, so keep this module server-side and do not ship it in a
// browser bundle.

const MODEL_DIR = path.join(DATA_DIR, "models", "piper");
const MODEL_FILE = "sq_AL-edon-medium.onnx";
const CONFIG_FILE = "sq_AL-edon-medium.onnx.json";
const MODEL_URL = `https://huggingface.co/edonseki/folsh.ai/resolve/main/edon/${MODEL_FILE}`;
const CONFIG_URL = `https://huggingface.co/edonseki/folsh.ai/resolve/main/edon/${CONFIG_FILE}`;
const MODEL_MIN_BYTES = 1_000_000;
const CONFIG_MIN_BYTES = 100;
const BOS = 1;
const PAD = 0;
const EOS = 2;

type PiperConfig = {
  audio: { sample_rate: number };
  inference: { noise_scale: number; length_scale: number; noise_w: number };
  phoneme_id_map: Record<string, number[]>;
};

type Ort = typeof import("onnxruntime-node");
type Piper = {
  session: import("onnxruntime-node").InferenceSession;
  config: PiperConfig;
  worker: ESpeakNGWorker;
  ort: Ort;
};

let loaded: Piper | null = null;
let loading: Promise<Piper> | null = null;
let lastError = "";

async function ensureFile(url: string, file: string, minBytes: number): Promise<string> {
  const full = path.join(MODEL_DIR, file);
  const stat = await fs.stat(full).catch(() => null);
  if (stat && stat.size >= minBytes) return full;

  await fs.mkdir(MODEL_DIR, { recursive: true });
  const tmp = `${full}.${process.pid}.${Date.now()}.tmp`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(180_000) });
    if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
    const body = Buffer.from(await res.arrayBuffer());
    if (body.length < minBytes) throw new Error(`download was only ${body.length} bytes`);
    await fs.writeFile(tmp, body);
    await fs.rename(tmp, full);
    return full;
  } catch (e) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw e;
  }
}

// Load the model, config and eSpeak once per server process. A failed load is retried on the next
// request (the downloaded files stay, so a transient failure doesn't re-download 60 MB).
function load(): Promise<Piper> {
  if (loaded) return Promise.resolve(loaded);
  if (loading) return loading;
  loading = (async () => {
    const [modelPath, configPath, createESpeak] = await Promise.all([
      ensureFile(MODEL_URL, MODEL_FILE, MODEL_MIN_BYTES),
      ensureFile(CONFIG_URL, CONFIG_FILE, CONFIG_MIN_BYTES),
      import("@echogarden/espeak-ng-emscripten").then((m) => m.default),
    ]);
    const [configText, ort, espeak] = await Promise.all([fs.readFile(configPath, "utf8"), import("onnxruntime-node"), createESpeak()]);
    const config = JSON.parse(configText) as PiperConfig;
    if (!config.audio?.sample_rate || !config.inference || !config.phoneme_id_map) throw new Error("Albanian voice config is incomplete");
    const worker = new espeak.eSpeakNGWorker();
    worker.set_voice("sq");
    const session = await ort.InferenceSession.create(modelPath, { intraOpNumThreads: 2, interOpNumThreads: 1 });
    const p: Piper = { session, config, worker, ort };
    loaded = p;
    return p;
  })().catch((e) => {
    loading = null;
    lastError = e instanceof Error ? e.message : String(e);
    throw e;
  });
  return loading;
}

export function warmPiper() {
  void load().catch(() => {});
}

export function piperStatus() {
  return loaded ? "ready" : loading ? "loading" : lastError ? `off: ${lastError}` : "loads on first use";
}

// One Piper piece at a time, with limited ONNX threads so speech leaves CPU for the agents. A queued piece whose listener has gone is skipped.
let waiting = 0;
const MAX_WAITING = 4;
let queue: Promise<unknown> = Promise.resolve();

export async function piperWav(text: string, signal?: AbortSignal): Promise<Buffer> {
  const t = text.trim();
  if (!t) throw new Error("Nothing to say");
  if (waiting >= MAX_WAITING) throw new Error("Albanian voice is busy — try again in a moment");
  waiting++;
  const run = queue.then(async () => {
    const p = await load();
    if (signal?.aborted) throw new Error("cancelled");
    return synth(p, t);
  });
  queue = run.catch(() => {});
  try { return await run; } finally { waiting--; }
}

// Match Piper's reference Python runtime: each known phoneme is followed by padding.
export function phonemeIds(phonemes: string, map: Record<string, number[]>): number[] {
  const ids = [...(map["^"] ?? [BOS])];
  let count = 0;
  for (const char of phonemes) {
    const id = map[char];
    if (id) { ids.push(...id, ...(map["_"] ?? [PAD])); count++; }
  }
  if (!count) throw new Error("No speakable Albanian text");
  ids.push(...(map["$"] ?? [EOS]));
  return ids;
}

// Piper's phonemizer keeps clause punctuation and decomposes Unicode phonemes (NFD).
// eSpeak's IPA trace drops punctuation, so restore it from each original clause instead
// of flattening all sentences into one breath. Never rewrite Albanian words as English.
export function albanianPhonemes(text: string, worker: Pick<ESpeakNGWorker, "synthesize_ipa">): string {
  return (text.normalize("NFC").match(/[^.!?,;:]+[.!?,;:]*|[.!?,;:]+/gu) ?? []).map((clause) => {
    const punctuation = clause.match(/[.!?,;:]+$/u)?.[0] ?? "";
    const words = clause.slice(0, clause.length - punctuation.length).trim();
    if (!words) return punctuation;
    const ipa = worker.synthesize_ipa(words);
    if (ipa.code !== 0) throw new Error(`eSpeak could not read that text (${ipa.code})`);
    return ipa.ipa.replace(/\([^)]+\)/g, "").replace(/_/g, "").replace(/\s+/g, " ").trim().normalize("NFD") + punctuation;
  }).join(" ");
}

async function synth(p: Piper, text: string): Promise<Buffer> {
  const phonemes = albanianPhonemes(text, p.worker);
  const ids = phonemeIds(phonemes, p.config.phoneme_id_map);

  const { noise_scale, length_scale, noise_w } = p.config.inference;
  const out = await p.session.run({
    input: new p.ort.Tensor("int64", BigInt64Array.from(ids.map((n) => BigInt(n))), [1, ids.length]),
    input_lengths: new p.ort.Tensor("int64", BigInt64Array.from([BigInt(ids.length)]), [1]),
    scales: new p.ort.Tensor("float32", Float32Array.from([noise_scale, length_scale, noise_w]), [3]),
  });
  const audio = out.output.data;
  if (!(audio instanceof Float32Array) || !audio.length) throw new Error("Albanian voice returned no audio");
  return wav(audio, p.config.audio.sample_rate);
}

function wav(samples: Float32Array, sampleRate: number): Buffer {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    data.writeInt16LE(Math.round(s * 32767), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}
