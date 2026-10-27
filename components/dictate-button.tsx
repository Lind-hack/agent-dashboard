"use client";

import { LoaderCircle, Mic, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { audioFilename, useRecorder } from "./use-recorder";

// Transcribe into an editable field. Saving stays with the containing goal/plan form.
export function DictateButton({ label, onText, disabled, onBusy }: {
  label: string;
  onText: (text: string) => void;
  disabled?: boolean;
  onBusy?: (busy: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  const mic = useRecorder(async (audio) => {
    setBusy(true);
    setError("");
    const ac = new AbortController();
    request.current = ac;
    try {
      const form = new FormData();
      form.set("audio", audio, audioFilename(audio));
      const res = await fetch("/api/transcribe", { method: "POST", body: form, signal: AbortSignal.any([ac.signal, AbortSignal.timeout(65_000)]) });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "Couldn't transcribe — try again.");
      if (typeof body.text !== "string" || !body.text.trim()) throw new Error("No speech heard — try again.");
      if (!ac.signal.aborted) onText(body.text.trim());
    } catch (e) {
      if (!ac.signal.aborted) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (!ac.signal.aborted) setBusy(false);
    }
  });
  const active = mic.recording || mic.opening || busy;
  useEffect(() => { onBusy?.(active); }, [active, onBusy]);

  return (
    <div className="flex flex-col items-start gap-1">
      <button type="button" onClick={mic.toggle} disabled={mic.opening || busy || disabled}
        className="flex min-h-10 items-center gap-2 rounded-[12px] border border-line px-3 text-sm text-muted hover:text-text disabled:opacity-40"
        aria-label={mic.recording ? `Finish ${label.toLowerCase()}` : label} aria-pressed={mic.recording}>
        {busy || mic.opening ? <LoaderCircle className="h-4 w-4 animate-spin" /> : mic.recording ? <Square className="h-4 w-4 text-bad" /> : <Mic className="h-4 w-4" />}
        {busy ? "Transcribing…" : mic.opening ? "Opening mic…" : mic.recording ? `Finish · ${mic.seconds}s` : label}
      </button>
      {(error || mic.error) && <p role="alert" className="text-xs text-bad">{error || mic.error}</p>}
    </div>
  );
}
