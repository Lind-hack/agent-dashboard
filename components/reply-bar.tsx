"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { audioFilename, useRecorder } from "./use-recorder";

// Bottom-of-chat composer: type, or tap the mic and the transcript lands in the box to check before sending.
export function ReplyBar({
  placeholder,
  disabled,
  onSend,
}: {
  placeholder: string;
  disabled?: boolean;
  onSend: (text: string) => Promise<string | void>; // resolves to a notice to show; throws on failure
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const mic = useRecorder(async (audio) => {
    setBusy(true);
    setNotice("Transcribing…");
    const form = new FormData();
    form.set("audio", audio, audioFilename(audio));
    const res = await fetch("/api/transcribe", { method: "POST", body: form }).catch(() => null);
    const body = await res?.json().catch(() => null);
    setBusy(false);
    if (!res?.ok) return setNotice(body?.error ?? "Couldn't transcribe");
    setNotice("");
    setText((t) => [t, body?.text].filter(Boolean).join(" "));
  });

  async function send() {
    if (!text.trim()) return;
    setBusy(true);
    setNotice("");
    try {
      const result = await onSend(text.trim());
      setText("");
      setNotice(result ?? "");
    } catch (e) {
      setNotice(`Didn't go through: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-x-0 bottom-0 border-t border-line bg-bg/95 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-end gap-2 px-4 py-3">
        <button
          onClick={mic.toggle}
          disabled={disabled || (busy && !mic.recording)}
          aria-label={mic.recording ? "Stop recording" : "Record"}
          className={cn(
            "h-10 shrink-0 rounded-lg border px-3 text-sm disabled:opacity-40",
            mic.recording ? "animate-pulse border-bad text-bad" : "border-line text-muted",
          )}
        >
          {mic.recording ? `■ ${mic.seconds}s` : "🎙"}
        </button>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
          placeholder={placeholder}
          disabled={disabled}
          className="min-w-0 flex-1 resize-none rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none focus:border-accent"
        />
        <button
          onClick={send}
          disabled={disabled || busy || mic.recording || !text.trim()}
          className="h-10 rounded-lg bg-accent px-4 text-sm font-medium text-bg disabled:opacity-40"
        >
          Send
        </button>
      </div>
      {(notice || mic.error) && <p className="mx-auto max-w-5xl px-4 pb-2 text-xs text-muted">{mic.error || notice}</p>}
    </div>
  );
}
