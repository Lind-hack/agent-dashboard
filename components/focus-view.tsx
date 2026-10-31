"use client";

import { ArrowRight, CalendarClock, Check, LoaderCircle, Minimize2, Play, Sparkles, Target } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { fmtLeft, PushSwitch, useCoach } from "./coach";
import { Orb } from "./orb";

// Focus mode: one block, the time it has left, and every move the Coach's pushes point at — start,
// done, shrink to 25 minutes, move to tomorrow, and the check-in. "Stuck" turns into three tiny
// first steps (Groq) so the block gets started instead of avoided.

export function FocusView() {
  const params = useSearchParams();
  const router = useRouter();
  const { s, act } = useCoach(15_000);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [steps, setSteps] = useState<string[] | null>(null);
  const [checked, setChecked] = useState("");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  if (!s) return <div className="grid min-h-[70dvh] place-items-center text-sm text-faint">Loading your day…</div>;
  const wanted = params.get("block");
  // The block from the push if it's still today's, else whatever this minute is for.
  const asked = wanted ? (s.blocks ?? []).find((x) => x.id === wanted) : undefined;
  const b = asked || s.current || s.next;
  const gone = !!wanted && !asked; // the block from the push is done, moved or no longer today's
  const askCheckin = params.get("checkin") === "1" && !checked;

  const run = async (body: Record<string, unknown>) => {
    setBusy(String(body.action));
    setError("");
    try {
      const out = await act(body);
      if (body.action === "breakdown") setSteps(out?.steps ?? []);
      if (body.action === "checkin") setChecked(String(body.mood));
      if (body.action === "move") router.push("/calendar");
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work.");
    } finally {
      setBusy("");
    }
  };

  if (!b) {
    return (
      <div className="mx-auto flex min-h-[70dvh] max-w-md flex-col items-center justify-center gap-5 text-center">
        <Orb className="h-48 w-48" />
        <h1 className="text-2xl font-semibold tracking-[-0.03em]">Nothing scheduled right now</h1>
        <p className="text-sm text-muted">Pick a goal and give it a focused block — the Coach keeps you on it.</p>
        <Link href="/goals" className="press flex h-11 items-center gap-2 rounded-[12px] bg-text px-5 text-sm font-medium text-bg">
          <Target className="h-4 w-4" /> Choose a goal
        </Link>
      </div>
    );
  }

  const running = b.status === "running";
  const total = b.endMs - b.startMs;
  const left = b.endMs - now;
  const notYet = b.startMs > now;
  const frac = running ? Math.min(1, Math.max(0, left / total)) : notYet ? 1 : Math.max(0, left / total);
  const R = 46;
  const C = 2 * Math.PI * R;

  return (
    <div className="mx-auto flex min-h-[78dvh] max-w-xl flex-col items-center justify-center py-6 text-center">
      {gone && <p className="mb-4 rounded-[10px] border border-line px-3 py-1.5 text-xs text-muted">That block is already done or moved — here&apos;s what&apos;s on now.</p>}
      <p className="hud-label mb-3">{running ? "Focus · on it" : notYet ? `Up next · ${b.start}` : "It's time"}</p>
      <div className="relative grid aspect-square w-[min(78vw,340px)] place-items-center">
        <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full -rotate-90" aria-hidden>
          <circle cx="50" cy="50" r={R} fill="none" stroke="rgb(255 255 255 / 0.06)" strokeWidth="1.6" />
          <circle cx="50" cy="50" r={R} fill="none" stroke="url(#focus-ring)" strokeWidth="1.8" strokeLinecap="round" strokeDasharray={`${C * frac} ${C}`} className="transition-[stroke-dasharray] duration-1000 ease-linear" />
          <defs>
            <linearGradient id="focus-ring" x1="0" x2="1">
              <stop offset="0" stopColor="#f6b25e" />
              <stop offset="0.5" stopColor="#e879c9" />
              <stop offset="1" stopColor="#b392f0" />
            </linearGradient>
          </defs>
        </svg>
        <Orb state={running ? "thinking" : "idle"} className="h-[74%] w-[74%]" />
        <div className="pointer-events-none absolute inset-x-0 bottom-[14%] text-center">
          <p className="tnum font-mono text-3xl font-semibold tracking-tight text-white drop-shadow-[0_2px_10px_rgb(0_0_0)]">{notYet ? `in ${fmtLeft(b.startMs - now)}` : left >= 0 ? fmtLeft(left) : `+${fmtLeft(-left)}`}</p>
          <p className="text-[11px] text-white/70">{notYet ? "until it starts" : left > 0 ? "left" : "over time"}</p>
        </div>
      </div>

      <h1 className="mt-6 max-w-[24ch] text-[1.7rem] leading-tight font-semibold tracking-[-0.03em] text-balance">{b.title}</h1>
      {b.goal && (
        <p className="mt-2 max-w-[44ch] text-sm text-muted">
          Serves <span className="text-hermes">{b.goal.title}</span>
          {b.goal.why && <span className="text-faint"> — {b.goal.why}</span>}
        </p>
      )}

      <div className="mt-7 flex flex-wrap justify-center gap-2">
        {!running ? (
          <button onClick={() => void run({ action: "start", id: b.id })} disabled={!!busy} className="press flex h-12 items-center gap-2 rounded-[14px] bg-text px-6 text-[15px] font-semibold text-bg">
            {busy === "start" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Start now
          </button>
        ) : (
          <button onClick={() => void run({ action: "done", id: b.id })} disabled={!!busy} className="press flex h-12 items-center gap-2 rounded-[14px] bg-ok px-6 text-[15px] font-semibold text-bg">
            {busy === "done" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Done
          </button>
        )}
        <button onClick={() => void run({ action: "shrink", id: b.id })} disabled={!!busy} className="press flex h-12 items-center gap-2 rounded-[14px] border border-line px-4 text-sm text-muted hover:text-text">
          <Minimize2 className="h-4 w-4" /> Just 25 minutes
        </button>
        <button onClick={() => void run({ action: "move", id: b.id })} disabled={!!busy} className="press flex h-12 items-center gap-2 rounded-[14px] border border-line px-4 text-sm text-muted hover:text-text">
          <CalendarClock className="h-4 w-4" /> Tomorrow
        </button>
      </div>

      <section className={cn("panel mt-6 w-full p-4 text-left", askCheckin && "drop-glow")}>
        <p className="text-sm font-medium">{checked ? "Noted — keep going." : "How's it going?"}</p>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {(
            [
              ["on-track", "On track", "text-ok"],
              ["stuck", "Stuck", "text-warn"],
              ["distracted", "Distracted", "text-bad"],
            ] as const
          ).map(([mood, label, tone]) => (
            <button
              key={mood}
              onClick={() => {
                void run({ action: "checkin", id: b.id, mood });
                if (mood === "stuck") void run({ action: "breakdown", id: b.id, note: b.title });
              }}
              disabled={!!busy}
              aria-pressed={checked === mood}
              className={cn("press h-11 rounded-[12px] border text-sm transition-colors", checked === mood ? "border-current bg-white/[0.06]" : "border-line hover:border-line-hi", tone)}
            >
              {label}
            </button>
          ))}
        </div>
        {checked === "distracted" && <p className="mt-3 text-sm text-muted">Close the tab that pulled you away. Put the phone face down. Two minutes on the smallest piece — then it gets easier.</p>}
        {(busy === "breakdown" || steps) && (
          <div className="mt-4 border-t border-line pt-3">
            <p className="flex items-center gap-2 text-xs text-muted">
              <Sparkles className="h-3.5 w-3.5 text-hermes" /> Three tiny first steps
            </p>
            {busy === "breakdown" ? (
              <p className="shimmer mt-2 h-14 rounded-[10px] bg-white/[0.03]" />
            ) : (
              <ol className="stagger mt-2 flex flex-col gap-1.5 text-[14px]">
                {(steps ?? []).map((st, i) => (
                  <li key={i} className="flex gap-2.5">
                    <span className="tnum font-mono text-xs text-hermes">{i + 1}</span>
                    {st}
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
      </section>

      {error && <p className="mt-3 text-sm text-bad">{error}</p>}
      {s.next && s.next.id !== b.id && (
        <p className="mt-5 flex items-center gap-1.5 text-xs text-faint">
          After this: {s.next.start} {s.next.title} <ArrowRight className="h-3 w-3" />
        </p>
      )}
      <PushSwitch className="mt-6 justify-center" />
    </div>
  );
}
