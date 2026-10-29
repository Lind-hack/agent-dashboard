"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { looksAlbanian, speakable, type Speaker } from "@/lib/voices";

// One audio engine for the whole app (one AudioContext — iOS only lets a page play sound after a tap,
// so the first tap anywhere unlocks it for everything after).
//   speak()  — splits text into sentences, asks /api/tts for each (two ahead), plays them back to back.
//   listen() — records until you stop talking (voice-activity detection), for hands-free turns.
//   level()  — loudness of whatever is playing or being heard, 0–1, for the Core to react to.
//
// Playback runs through an <audio> element instead of the AudioContext graph: iOS mutes Web Audio
// while the ringer switch is on, but a media element keeps talking. If the server voices fail or are
// still loading, the device's own speech synthesis says the same lines, so the Core always has a voice.
// Albanian uses the server Piper voice and falls back to an installed Albanian device voice.

type State = { speaking: Speaker | null; speakingKey: string | null; error: string; blocked: boolean };

export type SpeechLang = "en" | "sq";
export type SpeakOptions = { lang?: SpeechLang; fallbackText?: string; preferDevice?: boolean; audio?: Blob; onStart?: () => void };

let ctx: AudioContext | null = null;
let inAnalyser: AnalyserNode | null = null;
let outEl: HTMLAudioElement | null = null;
let outPulse = 0;
let pulseTimer: ReturnType<typeof setInterval> | null = null;
let current: { stop: () => void } | null = null;
let state: State = { speaking: null, speakingKey: null, error: "", blocked: false };
const subs = new Set<() => void>();
const set = (s: Partial<State>) => {
  state = { ...state, ...s };
  subs.forEach((f) => f());
};

// A silent WAV: playing it on the tap that starts the conversation unlocks the media element for
// every later answer (the same gesture that unlocks the AudioContext above).
export const SILENT = "data:audio/wav;base64,UklGRsQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YaAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

function audio(): AudioContext {
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new AC();
  }
  return ctx;
}

// iOS can leave the context "interrupted" (a call, the app in the background): any non-running state
// gets a resume attempt.
async function resumeAudio() {
  const c = audio();
  if (c.state !== "running") await c.resume().catch(() => {});
}

function element(): HTMLAudioElement {
  if (!outEl) {
    outEl = document.createElement("audio");
    outEl.setAttribute("playsinline", "");
    outEl.preload = "auto";
    outEl.style.display = "none";
    document.body.appendChild(outEl);
  }
  return outEl;
}

export function unlockAudio() {
  const c = audio();
  void resumeAudio();
  const b = c.createBuffer(1, 1, 22050);
  const s = c.createBufferSource();
  s.buffer = b;
  s.connect(c.destination);
  s.start();
  const el = element();
  if (el.paused) {
    el.src = SILENT;
    el.play().catch(() => {});
  }
}

// Called synchronously from the Hear reply button, with no fetch/await before play().
export function resumePlayback() {
  const el = element();
  void el.play().then(() => set({ blocked: false, error: "" })).catch(() => {
    set({ blocked: true, error: "Audio is still blocked. Check this site's sound permission and tap Hear reply." });
  });
}

function rms(a: AnalyserNode | null): number {
  if (!a) return 0;
  const buf = new Float32Array(a.fftSize);
  a.getFloatTimeDomainData(buf);
  let sum = 0;
  for (const v of buf) sum += v * v;
  return Math.sqrt(sum / buf.length);
}

// A light, look-alive level for the Core while a media element is talking (a Web Audio tap on it
// would put it back under the ringer switch).
function startPulse() {
  stopPulse();
  const t0 = performance.now();
  pulseTimer = setInterval(() => {
    const t = (performance.now() - t0) / 1000;
    outPulse = 0.2 + Math.abs(Math.sin(t * 6.5)) * 0.18 + Math.random() * 0.05;
  }, 60);
}

function stopPulse() {
  if (pulseTimer) clearInterval(pulseTimer);
  pulseTimer = null;
  outPulse = 0;
}

export const level = () => Math.min(1, Math.max(rms(inAnalyser) * 4, outPulse));

function stopDevice() {
  try {
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
  } catch {}
}

export function stopSpeaking() {
  current?.stop();
  current = null;
  stopDevice();
  try {
    outEl?.pause();
  } catch {}
  stopPulse();
  set({ speaking: null, speakingKey: null, blocked: false });
}

// Voices arrive asynchronously on Chrome; wait once for the list instead of racing it.
let voicesPromise: Promise<SpeechSynthesisVoice[]> | null = null;
function deviceVoices(): Promise<SpeechSynthesisVoice[]> {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return Promise.resolve([]);
  const synth = window.speechSynthesis;
  if (synth.getVoices().length) return Promise.resolve(synth.getVoices());
  voicesPromise ??= new Promise((resolve) => {
    const done = () => {
      synth.removeEventListener("voiceschanged", done);
      resolve(synth.getVoices());
    };
    synth.addEventListener("voiceschanged", done);
    setTimeout(done, 600);
  });
  return voicesPromise;
}

export function primeVoices() {
  void deviceVoices();
}

function pickVoice(vs: SpeechSynthesisVoice[], lang: SpeechLang): SpeechSynthesisVoice | null {
  const re = lang === "sq" ? /^sq([-_]|$)/i : /^en([-_]|$)/i;
  return vs.find((v) => re.test(v.lang)) ?? null;
}

export async function hasDeviceVoice(lang: SpeechLang): Promise<boolean> {
  return !!pickVoice(await deviceVoices(), lang);
}

// Speaks with the device voice. Returns false when the language has no voice here (unless forced),
// so a failed attempt is reported instead of silently counted as playback.
async function speakDevice(parts: string[], lang: SpeechLang, signal: AbortSignal, force: boolean, onStart?: () => void): Promise<boolean> {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return false;
  const vs = await deviceVoices();
  const voice = pickVoice(vs, lang);
  if (!voice && !force) return false;
  if (signal.aborted) return true;
  const synth = window.speechSynthesis;
  for (const part of parts) {
    if (signal.aborted) return true;
    const ok = await new Promise<boolean>((resolve) => {
      const u = new SpeechSynthesisUtterance(part);
      if (voice) u.voice = voice;
      u.lang = voice?.lang ?? (lang === "sq" ? "sq-AL" : "en-US");
      u.rate = 1;
      let done = false;
      let guard: ReturnType<typeof setTimeout> | undefined;
      let startGuard: ReturnType<typeof setTimeout> | undefined;
      const finish = (ok: boolean) => {
        if (done) return;
        done = true;
        if (guard) clearTimeout(guard);
        if (startGuard) clearTimeout(startGuard);
        signal.removeEventListener("abort", onAbort);
        resolve(ok);
      };
      const onAbort = () => {
        stopDevice();
        finish(false);
      };
      guard = setTimeout(() => { stopDevice(); finish(false); }, Math.max(2500, part.length * 120));
      signal.addEventListener("abort", onAbort, { once: true });
      startGuard = setTimeout(() => { stopDevice(); finish(false); }, 1500);
      u.onstart = () => { if (done || signal.aborted) return; if (startGuard) clearTimeout(startGuard); onStart?.(); };
      u.onend = () => finish(true);
      u.onerror = () => finish(false);
      try {
        synth.resume();
        synth.speak(u);
      } catch {
        finish(false);
      }
    });
    if (!ok) return false;
  }
  return true;
}

function joinSignals(a: AbortSignal, b: AbortSignal): AbortSignal {
  const c = new AbortController();
  const abort = () => {
    a.removeEventListener("abort", abort);
    b.removeEventListener("abort", abort);
    c.abort(b.aborted ? b.reason : a.reason);
  };
  if (a.aborted || b.aborted) return abort(), c.signal;
  a.addEventListener("abort", abort, { once: true });
  b.addEventListener("abort", abort, { once: true });
  return c.signal;
}

async function fetchPiece(text: string, who: Speaker, lang: SpeechLang, signal: AbortSignal): Promise<Blob> {
  // A cold Kokoro load can take a while; don't let one sentence stall the rest of the answer.
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(new DOMException("timeout", "TimeoutError")), 20_000);
  try {
    const res = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, who, lang }),
      signal: joinSignals(signal, timeout.signal),
    });
    if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? `voice HTTP ${res.status}`);
    return await res.blob();
  } finally {
    clearTimeout(timer);
  }
}

function playBlob(blob: Blob, signal: AbortSignal, onStart?: () => void): Promise<void> {
  const el = element();
  const url = URL.createObjectURL(blob);
  return new Promise((resolve, reject) => {
    let done = false;
    const onAbort = () => {
      try {
        el.pause();
      } catch {}
      finish(new DOMException("aborted", "AbortError"));
    };
    const finish = (err?: Error) => {
      if (done) return;
      done = true;
      clearTimeout(guard);
      signal.removeEventListener("abort", onAbort);
      el.onplaying = null;
      el.onended = null;
      el.onerror = null;
      URL.revokeObjectURL(url);
      err ? reject(err) : resolve();
    };
    const guard = setTimeout(() => finish(new Error("playback stalled")), 120_000);
    if (signal.aborted) return finish(new DOMException("aborted", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
    el.onplaying = () => onStart?.();
    el.onended = () => finish();
    el.onerror = () => finish(new Error("audio playback failed"));
    el.src = url;
    el.play().catch((e) => {
      if (done) return;
      if (e?.name === "NotAllowedError") {
        // Keep this exact audio source loaded. The Hear reply button calls play() directly
        // from a trusted tap, then onended continues the remaining sentences.
        set({ blocked: true, error: "Your browser paused audio. Tap Hear reply." });
      } else finish(e instanceof Error ? e : new Error("audio playback failed"));
    });
  });
}

// Speaks `text` (markdown is fine — code and links are skipped) in `who`'s voice. Resolves when done
// or stopped. `key` identifies what's being read, so a "play" button can show it's the one playing.
export function speak(text: string, who: Speaker, key = "", opts: SpeakOptions = {}): Promise<boolean> {
  stopSpeaking();
  const prose = speakable(text);
  const parts = prose ? [prose] : [];
  if (!parts.length) return Promise.resolve(true);
  void resumeAudio();
  const ac = new AbortController();
  let stopped = false;
  let finish: (ok: boolean) => void = () => {};
  const done = new Promise<boolean>((r) => (finish = r));
  const me = {
    stop: () => {
      stopped = true;
      ac.abort();
      stopDevice();
      try {
        outEl?.pause();
      } catch {}
      finish(false);
    },
  };
  current = me;
  set({ speaking: who, speakingKey: key, error: "", blocked: false });
  startPulse();

  const spokenLang = opts.lang ?? (looksAlbanian(text) ? "sq" : "en");

  async function playUtterance(): Promise<boolean> {
    let blob = opts.audio ?? await fetchPiece(prose, who, spokenLang, ac.signal).catch(() => null);
    if (!blob && !stopped) blob = await fetchPiece(prose, who, spokenLang, ac.signal).catch(() => null);
    if (stopped) return false;
    if (blob) {
      try {
        await playBlob(blob, ac.signal, opts.onStart);
        return !stopped;
      } catch {
        if (stopped) return false;
      }
    }
    const played = await speakDevice(parts, spokenLang, ac.signal, spokenLang === "en", opts.onStart);
    if (!played && !stopped) throw new Error("Speech playback failed — tap to try again.");
    return played && !stopped;
  }

  (async () => {
    let success = false;
    try {
      // The phone can start one native utterance without any synthesis/network round trip.
      const native = opts.preferDevice && await speakDevice(parts, spokenLang, ac.signal, false, opts.onStart);
      const played = native || await playUtterance();
      if (!played && !stopped) throw new Error("No voice came back — check the connection, then try again.");
      success = !stopped && !!played;
    } catch (e) {
      if (!stopped) set({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      if (current === me) {
        stopPulse();
        current = null;
        set({ speaking: null, speakingKey: null, blocked: false });
      }
      finish(success);
    }
  })();
  return done;
}

export function useVoiceState(): State {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => state,
    () => state,
  );
}

// The live loudness as React state, ~20 fps while `on` (for the Core and level bars).
export function useLevel(on: boolean): number {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (!on) {
      setV(0);
      return;
    }
    let raf = 0;
    let last = 0;
    const tick = (t: number) => {
      if (t - last > 50) {
        last = t;
        setV(level());
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [on]);
  return v;
}

function pickMime(): string {
  for (const m of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m)) return m;
  }
  return "";
}

// Hands-free recording: starts listening, notices when you start talking, and stops after ~1.4 s of
// quiet (or 45 s, or 8 s of nothing, or when the page is hidden). Resolves with the audio, or null if
// nothing was said / cancelled. One recording at a time; a cancel that lands while the mic permission
// prompt is still open stops the stream the moment it arrives.
export function useListener() {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState("");
  const session = useRef<{ end: (keep: boolean, forced?: boolean) => void; cancelled: boolean } | null>(null);

  async function listen(): Promise<Blob | null> {
    session.current?.end(false);
    // Until the mic is open, ending the session just marks it cancelled.
    const me: { end: (keep: boolean, forced?: boolean) => void; cancelled: boolean } = {
      end: () => {
        me.cancelled = true;
      },
      cancelled: false,
    };
    session.current = me;
    setError("");
    await resumeAudio();
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch {
      if (session.current === me) session.current = null;
      if (!me.cancelled) setError("Microphone blocked — allow it for this site, or type instead.");
      return null;
    }
    const release = () => stream.getTracks().forEach((t) => t.stop());
    if (me.cancelled || session.current !== me) {
      release();
      return null;
    }
    let rec: MediaRecorder;
    let src: MediaStreamAudioSourceNode;
    let an: AnalyserNode;
    const mime = pickMime();
    try {
      rec = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), audioBitsPerSecond: 128_000 });
      src = audio().createMediaStreamSource(stream);
      an = audio().createAnalyser();
      an.fftSize = 1024;
      src.connect(an);
    } catch {
      release();
      session.current = null;
      setError("Couldn't start recording on this browser — type instead.");
      return null;
    }
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    inAnalyser = an;
    setListening(true);

    return new Promise((resolve) => {
      let keep = true;
      let forced = false; // tapped to finish: send it even if the detector never heard speech
      let raf = 0;
      let settled = false;
      const t0 = performance.now();
      let floor = 0.02;
      let heard = false;
      let quietSince = 0;
      const cleanup = () => {
        cancelAnimationFrame(raf);
        clearTimeout(deadline);
        document.removeEventListener("visibilitychange", onHide);
        release();
        src.disconnect();
        if (inAnalyser === an) inAnalyser = null;
        if (session.current === me) session.current = null;
        setListening(false);
      };
      const settle = (blob: Blob | null) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(blob);
      };
      const end = (k: boolean, f = false) => {
        keep = k;
        forced = f;
        cancelAnimationFrame(raf);
        if (rec.state !== "inactive") rec.stop();
        else settle(null);
      };
      me.end = end;
      const onHide = () => document.hidden && end(true);
      document.addEventListener("visibilitychange", onHide);
      const deadline = setTimeout(() => end(true), 45_000); // holds even when animation frames pause
      rec.onstop = () => settle(keep && (heard || forced) && chunks.length ? new Blob(chunks, { type: rec.mimeType || mime || "audio/webm" }) : null);
      rec.onerror = () => settle(null);
      try {
        rec.start(250);
      } catch {
        setError("Couldn't start recording — type instead.");
        return settle(null);
      }
      const loop = (now: number) => {
        const v = rms(an);
        const elapsed = now - t0;
        if (elapsed < 350) floor = Math.min(floor, v); // do not calibrate immediate speech as room noise
        const threshold = Math.max(0.025, floor * 2.2);
        if (v > threshold) {
          heard ||= elapsed > 150;
          quietSince = 0;
        } else if (heard) quietSince ||= now;
        if ((heard && quietSince && now - quietSince > 1400) || (!heard && elapsed > 8000)) return end(true);
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    });
  }

  return {
    listening,
    error,
    listen,
    finish: () => session.current?.end(true, true), // stop now and use what was said
    cancel: () => session.current?.end(false),
  };
}
