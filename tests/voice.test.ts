import assert from 'node:assert/strict';
import { test } from 'node:test';
import { speak, stopSpeaking } from '../components/voice-engine';

class Context {
  static instance: Context;
  state = 'running';
  destination = {};
  constructor() { Context.instance = this; }
  createAnalyser() { return { connect() {}, fftSize: 0 }; }
  resume() { return this.state === 'running' ? Promise.resolve() : new Promise<void>(() => {}); }
  decodeAudioData() { return Promise.resolve({ duration: 0.001 }); }
  createBufferSource() {
    return { buffer: null, connect() {}, onended: () => {}, start() { queueMicrotask(() => this.onended()); }, stop() { this.onended(); } };
  }
}
class Utterance {
  text: string;
  onend?: () => void;
  constructor(text: string) { this.text = text; }
}
let spoken = '';
let endAutomatically = true;
let speechStarted: (() => void) | undefined;
const browser = { AudioContext: Context, speechSynthesis: {
  cancel() {},
  speak(u: Utterance) {
    spoken = u.text;
    speechStarted?.();
    if (endAutomatically) queueMicrotask(() => u.onend?.());
  },
} };
Object.assign(globalThis, { window: browser, SpeechSynthesisUtterance: Utterance });

// Server speech can fail (quota, model download). The answer must still be narrated.
test('narration falls back to browser speech when server speech fails', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: 'model unavailable' }), { status: 503 });
  try {
    await speak('Your plan is ready.', 'core');
    assert.equal(spoken, 'Your plan is ready.');
  } finally { globalThis.fetch = originalFetch; }
});

test('current sentence is requested before prefetched narration', async () => {
  const originalFetch = globalThis.fetch;
  const requested: string[] = [];
  globalThis.fetch = async (_, init) => {
    requested.push(JSON.parse(String(init?.body)).text);
    return new Response(new Uint8Array([1]));
  };
  try {
    await speak('First sentence. Second sentence. Third sentence.', 'claude');
    assert.deepEqual(requested, ['First sentence.', 'Second sentence.', 'Third sentence.']);
  } finally { globalThis.fetch = originalFetch; }
});

test('stopping browser fallback settles even without a browser end event', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('{}', { status: 503 });
  endAutomatically = false;
  try {
    const started = new Promise<void>((resolve) => { speechStarted = resolve; });
    const done = speak('An answer that can be interrupted.', 'core');
    await started;
    stopSpeaking();
    await done;
  } finally {
    endAutomatically = true;
    speechStarted = undefined;
    globalThis.fetch = originalFetch;
  }
});

test('an interrupted audio context cannot hang narration forever', async () => {
  Context.instance.state = 'suspended';
  try {
    await speak('Still responding.', 'core');
    assert.equal(spoken, 'Still responding.');
  } finally { Context.instance.state = 'running'; }
});

test('a browser speech startup error does not leave narration timers behind', async () => {
  const originalFetch = globalThis.fetch;
  const originalSpeak = browser.speechSynthesis.speak;
  globalThis.fetch = async () => new Response('{}', { status: 503 });
  browser.speechSynthesis.speak = () => { throw new Error('Audio device unavailable'); };
  try {
    await speak('Try to speak.', 'core');
  } finally {
    browser.speechSynthesis.speak = originalSpeak;
    globalThis.fetch = originalFetch;
  }
});
