"use client";

import { Check, FileText, LoaderCircle, SendHorizontal } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Seat } from "@/lib/council";
import { PROVIDER_META } from "@/lib/provider-meta";
import { cn } from "@/lib/utils";
import { SeatBadge } from "./seat-badge";

// The Roast room for accounts other than the owner: the debaters are the AI keys the user brought and
// any council seats. A judge (their first AI) scores every round and writes a decision memo.

export type UserProvider = { key: string; model: string };

const SUGGESTIONS = ["Should I learn backend or mobile first to get a job this year?", "Is it worth quitting my part-time job to build my side project full-time?", "Which of my three app ideas should I build first?"];

export function ProviderMark({ p, size = "md", active }: { p: string; size?: "sm" | "md" | "lg"; active?: boolean }) {
  const m = PROVIDER_META[p] ?? { short: "AI", color: "#9c9cf5" };
  const dim = size === "lg" ? "h-11 w-11 text-[13px]" : size === "md" ? "h-9 w-9 text-[11.5px]" : "h-7 w-7 text-[10px]";
  return (
    <span
      className={cn("grid shrink-0 place-items-center rounded-[10px] border font-mono font-semibold tracking-tight", dim, active && "animate-pulse motion-reduce:animate-none")}
      style={{ color: m.color, borderColor: `${m.color}55`, background: `${m.color}14` }}
      aria-hidden
    >
      {m.short}
    </span>
  );
}

export function UserRoomLauncher({ providers, seats, judgeModel }: { providers: UserProvider[]; seats: Seat[]; judgeModel: string }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [context, setContext] = useState("");
  const [showNotes, setShowNotes] = useState(false);
  const [picked, setPicked] = useState<string[]>(() => providers.map((p) => p.key).slice(0, 3));
  const [council, setCouncil] = useState<string[]>(() => (providers.length < 2 ? seats.slice(0, 3).map((s) => s.key) : []));
  const [allSeats, setAllSeats] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const table = picked.length + council.length;

  if (!providers.length) {
    return (
      <section className="panel p-5">
        <p className="text-[15px] font-medium">Add an AI key first</p>
        <p className="mt-1 text-sm text-muted">The debaters and the judge run on your own AI keys. A free Gemini key is enough to start: with one key, council seats debate each other.</p>
        <Link href="/settings#ai" className="press mt-4 inline-flex min-h-10 items-center rounded-[10px] bg-text px-4 text-sm font-medium text-bg">
          Open AI settings
        </Link>
      </section>
    );
  }

  const valid = text.trim().length > 0 && table >= 2 && table <= 7;

  async function start() {
    if (!valid || busy) return;
    setBusy(true);
    setError("");
    const form = new FormData();
    form.set("text", text.trim());
    form.set("providers", picked.join(","));
    form.set("seats", council.join(","));
    if (context.trim()) form.set("context", context.trim());
    const res = await fetch("/api/rooms", { method: "POST", body: form }).catch(() => null);
    const b = await res?.json().catch(() => null);
    if (!res?.ok || !b?.href) {
      setBusy(false);
      setError(b?.error ?? "Couldn't reach the dashboard.");
      return;
    }
    router.push(b.href);
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="panel brackets p-3 sm:p-4" aria-label="Who debates">
        <div className="mb-3 flex items-center justify-between px-1">
          <p className="hud-label">Your AIs at the table</p>
          <p className="hud-label tnum">{table} seated · 2–7</p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {providers.map((p) => {
            const on = picked.includes(p.key);
            const m = PROVIDER_META[p.key];
            return (
              <button
                key={p.key}
                onClick={() => setPicked((x) => (on ? x.filter((k) => k !== p.key) : table >= 7 ? x : [...x, p.key]))}
                aria-pressed={on}
                className={cn("press relative flex items-center gap-3 rounded-[14px] border p-3 text-left transition-colors", on ? "border-transparent bg-white/[0.05]" : "border-line bg-black/20 hover:bg-white/[0.03]")}
                style={on ? { boxShadow: `0 0 0 1px ${m?.color ?? "#9c9cf5"} inset` } : undefined}
              >
                <ProviderMark p={p.key} />
                <span className="min-w-0">
                  <span className="block text-[14px] font-medium">{m?.label ?? p.key}</span>
                  <span className="block truncate font-mono text-[10.5px] text-faint" title={p.model}>
                    {p.model}
                  </span>
                </span>
                {on && (
                  <span className="absolute top-2 right-2 grid h-5 w-5 place-items-center rounded-md bg-text text-bg">
                    <Check className="h-3.5 w-3.5" strokeWidth={3} />
                  </span>
                )}
              </button>
            );
          })}
        </div>
        {providers.length < 2 && (
          <p className="mt-2 px-1 text-xs text-muted">
            One AI can&apos;t argue with itself, so add council seats below, or <Link href="/settings#ai" className="underline underline-offset-2">add another key</Link> (Groq is free too).
          </p>
        )}

        {seats.length > 0 && (
          <div className="mt-4 border-t border-line pt-4">
            <p className="hud-label mb-3 px-1">The council (optional)</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {(allSeats ? seats : seats.filter((s, i) => i < 4 || council.includes(s.key))).map((s) => {
                const on = council.includes(s.key);
                return (
                  <button
                    key={s.key}
                    onClick={() => setCouncil((c) => (on ? c.filter((x) => x !== s.key) : table >= 7 ? c : [...c, s.key]))}
                    aria-pressed={on}
                    title={s.question}
                    className={cn("press flex items-start gap-2.5 rounded-[12px] border p-2.5 text-left transition-colors", on ? "border-transparent bg-white/[0.05]" : "border-line bg-black/20 hover:bg-white/[0.03]")}
                    style={on ? { boxShadow: `0 0 0 1px ${s.color} inset` } : undefined}
                  >
                    <SeatBadge seat={s} size="md" active={on} />
                    <span className="min-w-0">
                      <span className="block truncate text-[13.5px] font-medium">{s.name}</span>
                      <span className="block truncate text-[11px] text-faint">{s.pillar}</span>
                    </span>
                  </button>
                );
              })}
            </div>
            {!allSeats && seats.length > 4 && (
              <button onClick={() => setAllSeats(true)} className="press mt-2 min-h-9 rounded-[10px] px-1 text-xs text-muted underline-offset-2 hover:text-text hover:underline">
                Show all {seats.length} seats
              </button>
            )}
            <p className="mt-2 px-1 text-[11px] text-faint">Seats argue in an expert&apos;s style, built from their public work. They&apos;re simulations, not the people, and run on your first AI.</p>
          </div>
        )}
        <p className="mt-3 border-t border-line px-1 pt-3 text-xs text-muted">
          Judge: <span className="font-mono text-text/80">{judgeModel}</span>. Up to 3 rounds. Every call uses your own keys.
        </p>
      </section>

      <div className="panel flex flex-col gap-2 p-2">
        <label className="sr-only" htmlFor="room-task">
          What should they debate?
        </label>
        <textarea
          id="room-task"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void start();
          }}
          rows={3}
          maxLength={8000}
          placeholder="What should they debate?"
          className="min-h-24 w-full resize-y rounded-[10px] bg-transparent px-3 py-2.5 text-[15px] outline-none placeholder:text-faint"
        />
        {showNotes && (
          <textarea
            value={context}
            onChange={(e) => setContext(e.target.value)}
            rows={4}
            maxLength={30000}
            aria-label="Notes and facts for the debate"
            placeholder="Paste anything they should argue from: numbers, a plan, an email, notes…"
            className="w-full resize-y rounded-[10px] border border-line bg-black/20 px-3 py-2.5 text-sm outline-none placeholder:text-faint focus:border-line-hi"
          />
        )}
        <div className="flex items-center gap-2 px-1 pb-1">
          <button onClick={() => setShowNotes((x) => !x)} aria-expanded={showNotes} className="press flex min-h-9 items-center gap-1.5 rounded-[10px] border border-line px-3 text-xs text-muted hover:text-text">
            <FileText className="h-3.5 w-3.5" /> {showNotes ? "Hide notes" : "Add notes"}
          </button>
          <button onClick={() => void start()} disabled={!valid || busy} className="press ml-auto flex min-h-10 items-center gap-2 rounded-[10px] bg-text px-4 text-sm font-medium text-bg disabled:opacity-40">
            {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <SendHorizontal className="h-4 w-4" />} Start debate
          </button>
        </div>
      </div>
      {error && <p className="rounded-[12px] border border-bad/30 bg-bad/5 px-3 py-2 text-sm text-bad">{error}</p>}

      {!text && (
        <div className="flex flex-wrap gap-2">
          {SUGGESTIONS.map((s) => (
            <button key={s} onClick={() => setText(s)} className="press rounded-full border border-line px-3 py-1.5 text-left text-xs text-muted hover:text-text">
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
