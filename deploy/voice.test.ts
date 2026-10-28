import assert from "node:assert/strict";
import { test } from "node:test";
import { confirmsVoiceAction } from "../lib/voice-confirm";
import { phonemeIds } from "../lib/piper";
import { looksAlbanian, voiceLang } from "../lib/voices";
import { level, speak, stopSpeaking } from "../components/voice-engine";

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
