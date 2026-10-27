"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { sentences, speakable, type Speaker } from "@/lib/voices";

// One audio engine for the whole app (one AudioContext — iOS only lets a page play sound after a tap,
// so the first tap anywhere unlocks it for everything after).
//   speak()  — splits text into sentences, asks /api/tts for each (two ahead), plays them back to back.
//   listen() — records until you stop talking (voice-activity detection), for hands-free turns.
//   level()  — loudness of whatever is playing or being heard, 0–1, for the Core to react to.

type State = { speaking: Speaker | null; speakingKey: string | null; error: string };

let ctx: AudioContext | null = null;
let outAnalyser: AnalyserNode | null = null;
let inAnalyser: AnalyserNode | null = null;
let current: { stop: () => void } | null = null;
let state: State = { speaking: null, speakingKey: null, error: "" };
const subs = new Set<() => void>();
const set = (s: Partial<State>) => {
  state = { ...state, ...s };
  subs.forEach((f) => f());
};

function audio(): AudioContext {
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new AC();
    outAnalyser = ctx.createAnalyser();
    outAnalyser.fftSize = 512;
    outAnalyser.connect(ctx.destination);
  }
  return ctx;
}

// Call from a tap: makes sound possible on iOS for the rest of the visit.
// Safari can leave the context "interrupted" (a call, the app in the background) — any non-running
// state gets a resume attempt.
async function resumeAudio() {
  const c = audio();
  if (c.state !== "running") await c.resume().catch(() => {});
}

export function unlockAudio() {
  const c = audio();
  void resumeAudio();
  const b = c.createBuffer(1, 1, 22050);
  const s = c.createBufferSource();
  s.buffer = b;
  s.connect(c.destination);
  s.start();
}

function rms(a: AnalyserNode | null): number {
  if (!a) return 0;
  const buf = new Float32Array(a.fftSize);
  a.getFloatTimeDomainData(buf);
  let sum = 0;
  for (const v of buf) sum += v * v;
  return Math.sqrt(sum / buf.length);
}

export const level = () => Math.min(1, Math.max(rms(outAnalyser), rms(inAnalyser)) * 4);

export function stopSpeaking() {
  current?.stop();
  current = null;
  set({ speaking: null, speakingKey: null });
}

async function fetchPiece(text: string, who: Speaker, signal: AbortSignal): Promise<AudioBuffer> {
  const res = await fetch("/api/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, who }), signal });
  if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? `voice HTTP ${res.status}`);
  return audio().decodeAudioData(await res.arrayBuffer());
}

// Speaks `text` (markdown is fine — code and links are skipped) in `who`'s voice. Resolves when done
// or stopped. `key` identifies what's being read, so a "play" button can show it's the one playing.
export function speak(text: string, who: Speaker, key = ""): Promise<void> {
  stopSpeaking();
  const parts = sentences(speakable(text));
  if (!parts.length) return Promise.resolve();
  const c = audio();
  void resumeAudio();
  const ac = new AbortController();
  let source: AudioBufferSourceNode | null = null;
  let stopped = false;
  let finish: () => void = () => {};
  const done = new Promise<void>((r) => (finish = r));
  const me = {
    stop: () => {
      stopped = true;
      ac.abort();
      try {
        source?.stop();
      } catch {}
      finish();
    },
  };
  current = me;
  set({ speaking: who, speakingKey: key, error: "" });
  const pending: (Promise<AudioBuffer> | undefined)[] = [];
  const get = (i: number) => {
    if (i < parts.length && !pending[i]) {
      const p = fetchPiece(parts[i], who, ac.signal);
      p.catch(() => {}); // a piece fetched ahead may fail after we've stopped; it's handled when (if) it's played
      pending[i] = p;
    }
    return pending[i];
  };
  (async () => {
    try {
      for (let i = 0; i < parts.length && !stopped; i++) {
        get(i + 1);
        get(i + 2); // render ahead so the next sentence is ready when this one ends
        const buf = await get(i)!;
        if (stopped) break;
        source = c.createBufferSource();
        source.buffer = buf;
        source.connect(outAnalyser!);
        // If the context is stuck (Safari interrupted it), don't hang forever on a source that never plays.
        await new Promise<void>((r) => {
          const guard = setTimeout(r, (buf.duration + 5) * 1000);
          source!.onended = () => {
            clearTimeout(guard);
            r();
          };
          source!.start();
        });
      }
    } catch (e) {
      if (!stopped) set({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      if (current === me) {
        current = null;
        set({ speaking: null, speakingKey: null });
      }
      finish();
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

// Hands-free recording: starts listening, notices when you start talking, and stops after ~1.2 s of
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
      rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
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
      let floor = 0.01;
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
        if (elapsed < 350) floor = Math.max(floor, v); // room noise in the first moment
        const threshold = Math.max(0.02, floor * 2.2);
        if (v > threshold) {
          heard ||= elapsed > 150;
          quietSince = 0;
        } else if (heard) quietSince ||= now;
        if ((heard && quietSince && now - quietSince > 1200) || (!heard && elapsed > 8000)) return end(true);
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
