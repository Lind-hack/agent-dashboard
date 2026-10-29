import assert from "node:assert/strict";
import { test } from "node:test";
import { confirmsVoiceAction } from "../lib/voice-confirm";
import { albanianPhonemes, phonemeIds } from "../lib/piper";
import { looksAlbanian, voiceLang } from "../lib/voices";
import { level, SILENT, speak, stopSpeaking } from "../components/voice-engine";

const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

test("Piper pads every known phoneme and preserves model token IDs", () => {
  assert.deepEqual(phonemeIds("a?b", { "^": [1], _: [0], $: [2], a: [4], b: [5, 6] }), [1, 4, 0, 5, 6, 0, 2]);
  assert.throws(() => phonemeIds("?", {}), /No speakable/);
});

test("language labels and ordinary English are routed correctly", () => {
  for (const value of ["sq", "sq-AL", "Albanian", "sqi"]) assert.equal(voiceLang(value), "sq");
  assert.equal(voiceLang("English"), "en");
  assert.equal(looksAlbanian("There is a traffic jam."), false);
  assert.equal(looksAlbanian("Po, nuk e di."), true);
});

test("Albanian uses server speech; interrupted requests cannot stop a new answer", async () => {
  const requests: { lang: string; signal: AbortSignal }[] = [];
  const media = { setAttribute() {}, style: {}, paused: true, preload: "", src: "", onended: null as null | (() => void), onerror: null as null | (() => void), pause() {}, play() { return Promise.resolve(); } };
  Object.assign(globalThis, {
    window: { AudioContext: class { state = "running"; } },
    document: { createElement: () => media, body: { appendChild() {} } },
    fetch: async (_url: string, options: RequestInit) => {
      requests.push({ ...JSON.parse(String(options.body)), signal: options.signal });
      return new Response(new Blob(["audio"]));
    },
  });
  const old = speak("Përshëndetje.", "core", "old", { lang: "sq" });
  await tick();
  const next = speak("Mirëmëngjes.", "core", "next", { lang: "sq" });
  await old;
  await new Promise((resolve) => setTimeout(resolve, 90));
  assert.equal(requests.length, 2);
  assert.equal(requests[0].lang, "sq");
  assert.equal(requests[0].signal.aborted, true);
  assert.ok(level() > 0, "the replacement answer must keep its speaking animation");
  media.onended?.();
  await next;
  assert.equal(level(), 0);
  stopSpeaking();
});

test("device speech failure stops the answer instead of advancing silently", async () => {
  let attempts = 0;
  Object.assign(globalThis, {
    SpeechSynthesisUtterance: class { onerror?: () => void; },
    window: {
      AudioContext: class { state = "running"; },
      speechSynthesis: {
        cancel() {}, resume() {}, getVoices: () => [{ lang: "en-US" }],
        speak(u: { onerror: () => void }) { attempts++; queueMicrotask(() => u.onerror()); },
      },
    },
    fetch: async () => new Response(JSON.stringify({ error: "offline" }), { status: 503 }),
  });
  assert.equal(await speak("First sentence. Second sentence.", "core", "failure", { lang: "en" }), false);
  assert.equal(attempts, 1, "failed speech must not count as a played sentence");
  assert.equal(level(), 0);
  stopSpeaking();
});

test("spoken actions require a complete affirmative in either language", () => {
  for (const text of ["yes", "Yes, please!", "Po!", "bëje", "në rregull", "vazhdo"]) assert.equal(confirmsVoiceAction(text), true);
  for (const text of ["yes but don't run it", "okay cancel", "po jo", "no", ""]) assert.equal(confirmsVoiceAction(text), false);
});

test("audio unlock contains real PCM samples, not an empty WAV", () => {
  const wav = Buffer.from(SILENT.split(",")[1], "base64");
  assert.equal(wav.toString("ascii", 0, 4), "RIFF");
  assert.ok(wav.readUInt32LE(40) > 0);
  assert.equal(wav.length, 44 + wav.readUInt32LE(40));
});

test("Albanian phonemes retain punctuation, word boundaries and Unicode decomposition", () => {
  const words: string[] = [];
  const phones = albanianPhonemes("Përshëndetje Lind. Si je sot?", { synthesize_ipa(text) {
    words.push(text); return { code: 0, ipa: text === "Përshëndetje Lind" ? "(sq)p_ər ɫ_ˈi_n_d\n" : "s_i j_ˈe s_ˈɔ_t\n" };
  } });
  assert.deepEqual(words, ["Përshëndetje Lind", "Si je sot"]);
  assert.equal(phones, "pər ɫˈind. si jˈe sˈɔt?");
  assert.throws(() => albanianPhonemes("Test.", { synthesize_ipa: () => ({ code: 1, ipa: "" }) }), /eSpeak/);
});

test("browser autoplay denial keeps the answer loaded until a direct playback tap", async () => {
  let plays = 0;
  const media = { setAttribute() {}, style: {}, paused: true, src: "", onended: null as null | (() => void), onerror: null, pause() {}, play() {
    plays++;
    return plays === 1 ? Promise.reject(new DOMException("gesture required", "NotAllowedError")) : Promise.resolve();
  } };
  // The engine uses one element per page; isolate this test in a freshly imported module.
  Object.assign(globalThis, {
    window: { AudioContext: class { state = "running"; } },
    document: { createElement: () => media, body: { appendChild() {} } },
    fetch: async () => new Response(new Blob(["audio"])),
  });
  const engine = await import("../components/voice-engine.ts?autoplay" as string);
  let settled = false;
  const done = engine.speak("Përshëndetje.", "core", "blocked", { lang: "sq" }).then((ok: boolean) => { settled = true; return ok; });
  await tick();
  const source = media.src;
  assert.ok(source.startsWith("blob:"));
  assert.equal(settled, false);
  engine.resumePlayback();
  assert.equal(plays, 2, "play() must execute synchronously inside the click handler");
  assert.equal(media.src, source, "resume must not replace or refetch the blocked audio");
  media.onended?.();
  assert.equal(await done, true);
  engine.stopSpeaking();
});

test("a native Core reply is one utterance and makes no synthesis HTTP requests", async () => {
  let utterances = 0, requests = 0, started = false;
  const text = "The first sentence is ready. The next sentence follows without another network request.";
  Object.assign(globalThis, {
    SpeechSynthesisUtterance: class { constructor(public text: string) {} },
    window: { AudioContext: class { state = "running"; }, speechSynthesis: {
      cancel() {}, resume() {}, getVoices: () => [{ lang: "en-US" }],
      speak(u: { text: string; onstart: () => void; onend: () => void }) {
        utterances++; assert.equal(u.text, text); u.onstart(); queueMicrotask(() => u.onend());
      },
    } },
    fetch: async () => { requests++; throw new Error("native speech must not request TTS"); },
  });
  const engine = await import("../components/voice-engine.ts?native-continuous" as string);
  assert.equal(await engine.speak(text, "core", "fast", { lang: "en", preferDevice: true, onStart: () => { started = true; } }), true);
  assert.equal(utterances, 1); assert.equal(requests, 0); assert.equal(started, true);
});

test("prepared speech plays once with no per-sentence fetch or audio source change", async () => {
  let requests = 0, plays = 0, started = false;
  const media = { setAttribute() {}, style: {}, src: "", onplaying: null as null | (() => void), onended: null as null | (() => void), pause() {}, play() { plays++; return Promise.resolve(); } };
  Object.assign(globalThis, {
    window: { AudioContext: class { state = "running"; } },
    document: { createElement: () => media, body: { appendChild() {} } },
    fetch: async () => { requests++; throw new Error("audio already prepared"); },
  });
  const engine = await import("../components/voice-engine.ts?prepared-continuous" as string);
  const done = engine.speak("Sentence one. Sentence two. Sentence three.", "core", "prepared", { lang: "sq", audio: new Blob(["wave"]), onStart: () => { started = true; } });
  await tick();
  assert.equal(started, false); media.onplaying?.(); assert.equal(started, true);
  media.onended?.(); assert.equal(await done, true);
  assert.equal(plays, 1); assert.equal(requests, 0);
});
