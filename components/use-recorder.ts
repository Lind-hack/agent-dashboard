"use client";

import { useEffect, useRef, useState } from "react";

// iOS Safari records mp4/aac, Chrome/Android webm/opus — Whisper takes both.
function pickMime(): string {
  for (const m of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m)) return m;
  }
  return "";
}

export const audioFilename = (blob: Blob) => (blob.type.includes("mp4") ? "note.mp4" : "note.webm");

// Tap to start, tap again to stop. Each session owns its tracks and timers, including when
// permission arrives after unmount/cancel. Longer dictation allows pauses instead of VAD cutoffs.
export function useRecorder(onDone: (audio: Blob) => void) {
  const [recording, setRecording] = useState(false);
  const [opening, setOpening] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState("");
  const session = useRef<{ cancel: () => void; stop: () => void } | null>(null);
  const callback = useRef(onDone);
  callback.current = onDone;

  useEffect(() => () => session.current?.cancel(), []);

  async function toggle() {
    if (session.current) {
      session.current.stop();
      return;
    }
    let cancelled = false;
    const me = { cancel: () => { cancelled = true; }, stop: () => { cancelled = true; } };
    session.current = me;
    setOpening(true);
    setError("");
    let stream: MediaStream | undefined;
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
        throw new Error("Recording is unavailable — use a supported browser over HTTPS, or type instead.");
      }
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      if (cancelled || session.current !== me) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      const mime = pickMime();
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks: Blob[] = [];
      let timer: ReturnType<typeof setInterval> | undefined;
      let deadline: ReturnType<typeof setTimeout> | undefined;
      const cleanup = () => {
        clearInterval(timer);
        clearTimeout(deadline);
        stream?.getTracks().forEach((t) => t.stop());
        if (session.current === me) session.current = null;
      };
      me.stop = () => { if (rec.state !== "inactive") rec.stop(); };
      me.cancel = () => {
        cancelled = true;
        me.stop();
        cleanup();
      };
      rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      rec.onstop = () => {
        cleanup();
        if (cancelled) return;
        setRecording(false);
        const audio = new Blob(chunks, { type: rec.mimeType || mime || "audio/webm" });
        if (audio.size) callback.current(audio);
        else setError("No audio recorded — please try again.");
      };
      rec.onerror = () => {
        me.cancel();
        setRecording(false);
        setError("Recording failed — please try again or type instead.");
      };
      rec.start(250);
      setSeconds(0);
      timer = setInterval(() => setSeconds((s) => s + 1), 1000);
      deadline = setTimeout(me.stop, 180_000);
      setRecording(true);
    } catch (e) {
      if (session.current === me) session.current = null;
      stream?.getTracks().forEach((t) => t.stop());
      if (!cancelled) setError(e instanceof Error && e.name !== "NotAllowedError" ? e.message : "Microphone blocked — allow it for this site, or type instead.");
    } finally {
      if (!cancelled) setOpening(false);
      if (cancelled || !stream) {
        if (session.current === me) session.current = null;
      }
    }
  }

  return { recording, opening, seconds, error, toggle };
}
