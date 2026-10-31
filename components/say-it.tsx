"use client";

import { CalendarPlus, Check, LoaderCircle, Mic, Repeat, RotateCcw, Square, Target, TimerReset, ListTodo } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { SayResult } from "@/lib/say";
import { cn } from "@/lib/utils";
import { audioFilename, useRecorder } from "./use-recorder";

// "Say it" (v5.2): one mic for Today and Goals. Talk (or type) — "gym at 6 for an hour, finish the
// 383 pitch today, new goal: save 2k by March" — and it lands as time blocks, tasks, events and goals,
// each listed with its own Undo.

const ICON = { task: ListTodo, block: TimerReset, event: CalendarPlus, goal: Target, habit: Repeat } as const;

export function SayIt({ placeholder = "Gym at 6 for an hour, finish the 383 pitch today, new goal…" }: { placeholder?: string }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<"" | "hearing" | "sorting">("");
  const [heard, setHeard] = useState("");
  const [results, setResults] = useState<(SayResult & { undone?: boolean })[]>([]);
  const [err, setErr] = useState("");

  async function send(said: string) {
    if (!said.trim()) return;
    setBusy("sorting");
    setErr("");
    try {
      const res = await fetch("/api/say", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: said }) });
      const out = await res.json().catch(() => null);
      if (!res.ok) throw new Error(out?.error ?? `error ${res.status}`);
      setHeard(out.heard ?? said);
      setResults(out.results ?? []);
      if (out.error) setErr(out.error);
      setText("");
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  const mic = useRecorder(async (audio) => {
    setBusy("hearing");
    setErr("");
    try {
      const form = new FormData();
      form.append("audio", audio, audioFilename(audio));
      const r = await fetch("/api/transcribe", { method: "POST", body: form });
      const out = await r.json().catch(() => null);
      if (!r.ok) throw new Error(out?.error ?? "Couldn't hear that — try again or type it.");
      const said = String(out?.text ?? "").trim();
      if (!said) throw new Error("Didn't catch anything — try again.");
      await send(said);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy("");
    }
  });

  async function undo(i: number) {
    const r = results[i];
    if (!r.undo) return;
    const res = await fetch("/api/say", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ undo: r.undo }) });
    const out = await res.json().catch(() => null);
    if (!res.ok && !out?.ok) return setErr(out?.error ?? "Couldn't undo that.");
    setResults((xs) => xs.map((x, k) => (k === i ? { ...x, undone: true, error: out?.error } : x)));
    router.refresh();
  }

  return (
    <section aria-label="Say it" className="panel overflow-hidden">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(text);
        }}
        className="flex items-center gap-2 p-2"
      >
        <button
          type="button"
          onClick={() => void mic.toggle()}
          disabled={!!busy && !mic.recording}
          aria-label={mic.recording ? "Stop and add" : "Say it"}
          className={cn(
            "press grid h-12 w-12 shrink-0 place-items-center rounded-[14px] transition-colors",
            mic.recording ? "bg-bad text-white" : "bg-hud/15 text-hud hover:bg-hud/25",
          )}
        >
          {busy && !mic.recording ? <LoaderCircle className="h-5 w-5 animate-spin" /> : mic.recording ? <Square className="h-4 w-4" fill="currentColor" /> : <Mic className="h-5 w-5" />}
        </button>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={mic.recording ? `Listening… ${mic.seconds}s — tap ■ when done` : busy === "hearing" ? "Hearing you…" : busy === "sorting" ? "Sorting it into your day…" : placeholder}
          aria-label="Say or type tasks, blocks, events or goals"
          className="bare-field h-12 min-w-0 flex-1 bg-transparent px-1 text-[15px] placeholder:text-faint focus:outline-none"
        />
        {text.trim() && (
          <button type="submit" disabled={!!busy} className="press h-10 shrink-0 rounded-[11px] bg-text px-3.5 text-sm font-medium text-bg">
            Add
          </button>
        )}
      </form>
      {(mic.error || err) && <p className="border-t border-line px-4 py-2 text-[12.5px] text-bad">{mic.error || err}</p>}
      {results.length > 0 && (
        <div className="border-t border-line px-4 py-3">
          <p className="mb-2 line-clamp-2 text-[12px] text-faint">“{heard}”</p>
          <ul className="flex flex-col gap-1.5">
            {results.map((r, i) => {
              const Icon = ICON[r.kind];
              const failed = !!r.error && !r.undo;
              return (
                <li key={i} className={cn("flex items-center gap-2.5 text-[13.5px]", r.undone && "opacity-45")}>
                  {failed ? <span className="h-4 w-4 shrink-0 text-center text-bad">!</span> : <Check className="h-4 w-4 shrink-0 text-ok" />}
                  <Icon className="h-3.5 w-3.5 shrink-0 text-muted" />
                  <span className={cn("min-w-0 flex-1 truncate", r.undone && "line-through")}>{r.label}</span>
                  {r.error && <span className="truncate text-[11.5px] text-warn">{r.error}</span>}
                  {r.undo && !r.undone && (
                    <button onClick={() => void undo(i)} className="press flex h-7 shrink-0 items-center gap-1 rounded-[8px] border border-line px-2 text-[12px] text-muted hover:text-text">
                      <RotateCcw className="h-3 w-3" /> Undo
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
