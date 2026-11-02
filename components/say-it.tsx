"use client";

import { CalendarPlus, Check, Copy, Flag, LoaderCircle, Mic, Repeat, RotateCcw, Square, Target, TimerReset, ListTodo, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { SayDraft, SayItem, SayResult } from "@/lib/say";
import { cn } from "@/lib/utils";
import { audioFilename, useRecorder } from "./use-recorder";

// "Say it" (v5.2): one mic for Today and Goals. Talk (or type) — "gym at 6 for an hour, finish the
// 383 pitch today, new goal: save 2k by March" — and it lands as time blocks, tasks, events and goals,
// each listed with its own Undo.
// v5.4: nothing is saved until he's seen it. What it heard comes back as cards — keep, rename, set the
// priority, or drop — with repeats of open tasks and vague ones unticked; "Add" saves the kept ones.

const ICON = { task: ListTodo, block: TimerReset, event: CalendarPlus, goal: Target, habit: Repeat } as const;
const PRIORITY = [
  { label: "None", tone: "text-faint" },
  { label: "Low", tone: "text-codex" },
  { label: "Medium", tone: "text-warn" },
  { label: "High", tone: "text-bad" },
] as const;
type Card = SayDraft & { keep: boolean };

// One line of detail under a card's title: when and how big.
function detail(it: SayItem, today: string): string {
  const day = (d: string) => (d === today ? "today" : d);
  if (it.kind === "task") return [day(it.day), it.estimateMin ? `${it.estimateMin} min` : "", it.due ? `due ${it.due.replace("T", " ")}` : ""].filter(Boolean).join(" · ");
  if (it.kind === "block") return `${day(it.day)}${it.start ? ` at ${it.start}` : " · next free time"} · ${it.length} min`;
  if (it.kind === "event") return `${day(it.date)}${it.start ? ` ${it.start}${it.end ? `–${it.end}` : ""}` : " · all day"}`;
  if (it.kind === "goal") return [it.horizon, it.due ? `by ${it.due}` : "", it.next ? `next: ${it.next}` : ""].filter(Boolean).join(" · ");
  return `${it.target}${it.unit ? ` ${it.unit}` : ""} · ${it.days.length ? `${it.days.length} days a week` : "every day"}`;
}

export function SayIt({ placeholder = "Gym at 6 for an hour, finish the 383 pitch today, new goal…" }: { placeholder?: string }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<"" | "hearing" | "sorting">("");
  const [heard, setHeard] = useState("");
  const [results, setResults] = useState<(SayResult & { undone?: boolean })[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const today = new Date().toLocaleDateString("en-CA");
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
      setResults([]);
      setCards(((out.drafts ?? []) as SayDraft[]).map((d) => ({ ...d, keep: !d.dupOf && !d.vague })));
      if (out.error) setErr(out.error);
      setText("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  // Save the kept cards.
  async function add() {
    const items = cards.filter((c) => c.keep && c.item.title.trim()).map((c) => c.item);
    if (!items.length) return setCards([]);
    setBusy("sorting");
    setErr("");
    try {
      const res = await fetch("/api/say", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items }) });
      const out = await res.json().catch(() => null);
      if (!res.ok) throw new Error(out?.error ?? `error ${res.status}`);
      setResults(out.results ?? []);
      setCards([]);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }
  const edit = (i: number, patch: Partial<Card> & { title?: string; priority?: 0 | 1 | 2 | 3 }) =>
    setCards((cs) =>
      cs.map((c, k) => {
        if (k !== i) return c;
        const { title, priority, ...rest } = patch;
        const item = { ...c.item, ...(title !== undefined ? { title } : {}), ...(priority !== undefined && c.item.kind === "task" ? { priority } : {}) } as SayItem;
        return { ...c, ...rest, item };
      }),
    );

  const mic = useRecorder(async (audio) => {
    setBusy("hearing");
    setErr("");
    try {
      const form = new FormData();
      form.append("audio", audio, audioFilename(audio));
      form.append("mode", "say");
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
      {cards.length > 0 && (
        <div className="border-t border-line px-3 py-3 sm:px-4">
          <p className="mb-2 line-clamp-2 px-1 text-[12px] text-faint">“{heard}”</p>
          <ul className="flex flex-col gap-2">
            {cards.map((c, i) => {
              const Icon = ICON[c.item.kind];
              const pr = c.item.kind === "task" ? (c.item.priority ?? 0) : null;
              return (
                <li key={i} className={cn("rounded-[12px] border p-2.5 transition-colors", c.keep ? "border-line-hi bg-white/[0.03]" : "border-line opacity-60")}>
                  <div className="flex items-center gap-2">
                    <button onClick={() => edit(i, { keep: !c.keep })} aria-pressed={c.keep} aria-label={c.keep ? "Don't add this" : "Add this"} className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-full border", c.keep ? "border-ok bg-ok/20 text-ok" : "border-line-hi text-transparent")}>
                      <Check className="h-3.5 w-3.5" strokeWidth={3} />
                    </button>
                    <Icon className="h-4 w-4 shrink-0 text-muted" aria-hidden />
                    <input value={c.item.title} onChange={(e) => edit(i, { title: e.target.value })} aria-label="Title" className="bare-field min-w-0 flex-1 bg-transparent text-[15px] focus:outline-none" />
                    {pr !== null && (
                      <button onClick={() => edit(i, { priority: ((pr + 1) % 4) as 0 | 1 | 2 | 3 })} aria-label={`Priority: ${PRIORITY[pr].label} — tap to change`} className={cn("flex h-7 shrink-0 items-center gap-1 rounded-[8px] border border-line px-2 text-[11.5px]", PRIORITY[pr].tone)}>
                        <Flag className="h-3 w-3" fill={pr ? "currentColor" : "none"} /> {PRIORITY[pr].label}
                      </button>
                    )}
                    <button onClick={() => setCards((cs) => cs.filter((_, k) => k !== i))} aria-label="Remove" className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-faint hover:text-text">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <p className="mt-1 pl-[60px] text-[12px] text-faint">{detail(c.item, today)}</p>
                  {c.dupOf && (
                    <p className="mt-1 flex items-center gap-1.5 pl-[60px] text-[12px] text-warn">
                      <Copy className="h-3 w-3 shrink-0" /> Already on your list: “{c.dupOf.title}”
                    </p>
                  )}
                  {c.vague && !c.dupOf && <p className="mt-1 pl-[60px] text-[12px] text-warn">Too vague to act on — rename it or drop it.</p>}
                </li>
              );
            })}
          </ul>
          <div className="mt-3 flex gap-2">
            <button onClick={() => void add()} disabled={!!busy || !cards.some((c) => c.keep)} className="press flex h-11 flex-1 items-center justify-center gap-2 rounded-[12px] bg-text text-[14px] font-semibold text-bg disabled:opacity-50">
              {busy === "sorting" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Add {cards.filter((c) => c.keep).length}
            </button>
            <button onClick={() => setCards([])} className="press h-11 rounded-[12px] border border-line px-4 text-[14px] text-muted">
              Cancel
            </button>
          </div>
        </div>
      )}
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
