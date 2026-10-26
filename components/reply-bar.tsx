"use client";

import { LoaderCircle, Mic, SendHorizontal, Square } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { audioFilename, useRecorder } from "./use-recorder";

// Chat composer pinned above the phone tab bar (beside the sidebar on desktop). The mic transcribes
// into the box so Lind can check the words before sending.
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
    if (!res?.ok) return setNotice(body?.error ?? "Couldn't transcribe — try again or type it.");
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
    <div className="fixed inset-x-0 bottom-[calc(64px+env(safe-area-inset-bottom))] z-20 px-3 pb-2 lg:bottom-0 lg:left-[248px] lg:px-8 lg:pb-5">
      <div className="mx-auto max-w-3xl">
        {(notice || mic.error) && <p className="mb-1.5 px-3 text-xs text-muted" aria-live="polite">{mic.error || notice}</p>}
        <div className="panel flex items-end gap-1.5 rounded-[26px] bg-bg-raised/[0.97] p-1.5 shadow-[0_-12px_32px_-12px_rgb(0_0_0/0.9)]">
          <button
            onClick={mic.toggle}
            disabled={disabled || (busy && !mic.recording)}
            aria-label={mic.recording ? "Stop recording" : "Dictate"}
            className={cn(
              "grid h-11 w-11 shrink-0 place-items-center rounded-full transition-colors disabled:opacity-40",
              mic.recording ? "bg-bad/20 text-bad" : "text-muted hover:bg-white/5 hover:text-text",
            )}
          >
            {mic.recording ? <Square className="h-4 w-4 fill-current" /> : <Mic className="h-5 w-5" strokeWidth={1.75} />}
          </button>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void send();
            }}
            rows={1}
            placeholder={mic.recording ? `Listening · ${mic.seconds}s` : placeholder}
            disabled={disabled}
            className="max-h-40 min-h-11 min-w-0 flex-1 resize-none bg-transparent py-2.5 text-[15px] outline-none [field-sizing:content] placeholder:text-faint"
          />
          <button
            onClick={send}
            disabled={disabled || busy || mic.recording || !text.trim()}
            aria-label="Send"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-text text-bg transition-opacity disabled:opacity-20"
          >
            {busy && !mic.recording ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <SendHorizontal className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}
