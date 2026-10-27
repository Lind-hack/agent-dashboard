"use client";

import { ArrowUp, LoaderCircle, Mic, Square } from "lucide-react";
import { useRef, useState } from "react";
import type { AgentKey } from "@/lib/agents";
import { cn } from "@/lib/utils";
import { SkillChips, SkillMenu, useSkillPicker, type SkillInfo } from "./skill-picker";
import { audioFilename, useRecorder } from "./use-recorder";

// Chat composer pinned above the phone tab bar (beside the sidebar on desktop). The mic transcribes
// into the box so Lind can check the words before sending. With an `agent`, "/" opens that agent's
// skills; picked skills ride along as chips and the server turns them into the real invocation.
export function ReplyBar({
  placeholder,
  disabled,
  onSend,
  agent,
}: {
  placeholder: string;
  disabled?: boolean;
  onSend: (text: string, skills: string[]) => Promise<string | void>; // resolves to a notice to show; throws on failure
  agent?: AgentKey;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);
  const picker = useSkillPicker(agent, box);

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
    if (disabled || busy || mic.recording || (!text.trim() && !picker.chips.length)) return;
    setBusy(true);
    setNotice("");
    try {
      const result = await onSend(text.trim(), picker.chips);
      setText("");
      picker.setChips([]);
      setNotice(result ?? "");
    } catch (e) {
      setNotice(`Didn't go through: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
    }
  }

  function apply(s: SkillInfo) {
    const caret = box.current?.selectionStart ?? text.length;
    const next = picker.pick(s, text, caret);
    setText(next.text);
  }

  return (
    <div className="chat-reply fixed inset-x-0 bottom-[calc(64px+env(safe-area-inset-bottom))] z-20 px-3 pb-2 lg:bottom-0 lg:left-[248px] lg:px-8 lg:pb-5">
      <div className="relative mx-auto max-w-3xl">
        <SkillMenu picker={picker} onPick={apply} id="reply-skills" />
        {(notice || mic.error) && (
          <p className="mb-1.5 px-3 text-xs text-muted" aria-live="polite">
            {mic.error || notice}
          </p>
        )}
        <div className="reply-panel panel rounded-[26px] bg-bg-raised/[0.97] p-1.5 shadow-[0_-12px_32px_-12px_rgb(0_0_0/0.9)] transition-[border-color,box-shadow] duration-200">
          <SkillChips picker={picker} />
          <div className="flex items-end gap-1.5">
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
              ref={box}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                picker.onText(e.target.value, e.target.selectionStart ?? e.target.value.length);
              }}
              onKeyDown={(e) => {
                if (picker.onKey(e, apply)) return;
                if (!e.nativeEvent.isComposing && e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void send();
                }
              }}
              onBlur={() => picker.onText("", 0)}
              rows={1}
              placeholder={mic.recording ? `Listening · ${mic.seconds}s` : agent ? `${placeholder.replace(/…$/, "")} — / for skills` : placeholder}
              disabled={disabled}
              role={agent ? "combobox" : undefined}
              aria-autocomplete={agent ? "list" : undefined}
              aria-expanded={agent ? picker.open : undefined}
              aria-controls={agent && picker.open ? "reply-skills" : undefined}
              aria-activedescendant={agent && picker.open && picker.matches.length ? `reply-skills-${picker.active}` : undefined}
              aria-label="Message"
              name="message"
              autoComplete="off"
              className="max-h-40 min-h-11 min-w-0 flex-1 resize-none bg-transparent py-2.5 text-[15px] outline-none [field-sizing:content] placeholder:text-faint"
            />
            <button
              onClick={send}
              disabled={disabled || busy || mic.recording || (!text.trim() && !picker.chips.length)}
              aria-label="Send"
              className="chat-send grid h-11 w-11 shrink-0 place-items-center rounded-full bg-text text-bg transition-opacity disabled:opacity-20"
            >
              {busy && !mic.recording ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-5 w-5" aria-hidden />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
