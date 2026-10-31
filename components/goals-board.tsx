"use client";

import { CalendarPlus, Flame, LoaderCircle, Pencil, Play, Target } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { GoalProgress, Recap } from "@/lib/coach";
import { cn } from "@/lib/utils";
import { PushSwitch } from "./coach";
import { CountUp } from "./motion";

// Goals as a scoreboard: each goal's week against its target, the last 7 days, the streak, and the two
// moves that turn a goal into time — "Focus now" (a running block from this minute) and "Plan into
// today" (the next free slot). Both land in the same plan store the Today page and the Coach read.

const fmt = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}` : `${m}m`);
const HORIZON: Record<string, { label: string; tone: string }> = {
  now: { label: "Now", tone: "#e879c9" },
  short: { label: "Short term", tone: "#b392f0" },
  long: { label: "Long term", tone: "#7c98ff" },
};

export function GoalsBoard({ progress, recap, today }: { progress: GoalProgress[]; recap: Recap | null; today: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  async function act(action: "focus" | "plan", goalId: string, minutes: number) {
    setBusy(`${action}:${goalId}`);
    setError("");
    try {
      const res = await fetch("/api/coach", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, goalId, minutes }) });
      const out = await res.json().catch(() => null);
      if (!res.ok) throw new Error(out?.error ?? `error ${res.status}`);
      if (action === "focus") router.push(`/focus?block=${encodeURIComponent(out.block.id)}`);
      else router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work.");
    } finally {
      setBusy("");
    }
  }

  const live = progress.filter((p) => p.goal.horizon !== "long");
  const weekMin = live.reduce((s, p) => s + p.weekMin, 0);
  const weekTarget = live.reduce((s, p) => s + p.targetMin, 0);

  return (
    <div className="flex flex-col gap-6">
      {recap && (
        <section className="panel land relative overflow-hidden p-5" aria-label={`Recap for ${recap.day}`}>
          <span className="pointer-events-none absolute inset-0 bg-[radial-gradient(420px_160px_at_100%_0%,rgb(246_178_94/0.12),transparent_70%)]" aria-hidden />
          <div className="relative flex flex-wrap items-center gap-5">
            <ScoreRing score={recap.score} />
            <div className="min-w-0 flex-1">
              <p className="hud-label !text-[10px]">{recap.day === today ? "Today's recap" : `Recap · ${recap.day}`}</p>
              <p className="mt-1 text-[15px] leading-relaxed text-pretty">{recap.note ?? `${recap.done} of ${recap.total} blocks done, ${fmt(recap.focusMin)} focused.`}</p>
              <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                <span>
                  {recap.done}/{recap.total} blocks
                </span>
                <span>
                  {fmt(recap.focusMin)} of {fmt(recap.plannedMin)} focused
                </span>
                {recap.moods.stuck + recap.moods.distracted > 0 && (
                  <span>
                    {recap.moods.stuck} stuck · {recap.moods.distracted} distracted
                  </span>
                )}
              </p>
            </div>
          </div>
        </section>
      )}

      <section className="panel flex flex-wrap items-center gap-5 p-5">
        <div className="min-w-0 flex-1">
          <p className="hud-label !text-[10px]">This week</p>
          <p className="mt-1 text-[2rem] leading-none font-semibold tracking-[-0.04em]">
            <CountUp value={weekMin / 60} format={(n) => `${n.toFixed(1)}h`} />
            <span className="ml-2 text-base font-normal text-muted">of {fmt(weekTarget)} on your goals</span>
          </p>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/[0.06]">
            <div className="day-bar h-full rounded-full" style={{ width: `${Math.min(100, (weekMin / Math.max(1, weekTarget)) * 100)}%` }} />
          </div>
        </div>
        <PushSwitch />
      </section>

      {error && <p className="text-sm text-bad">{error}</p>}

      {progress.length === 0 ? (
        <p className="panel px-5 py-8 text-sm text-muted">No goals yet. Add them below — then every day gets a focused block for each one, and the Coach keeps you on it.</p>
      ) : (
        <ul className="stagger grid gap-3 md:grid-cols-2">
          {progress.map((p) => {
            const h = HORIZON[p.goal.horizon] ?? HORIZON.short;
            const pct = Math.min(1, p.weekMin / Math.max(1, p.targetMin));
            const max = Math.max(30, ...p.days.map((d) => d.min));
            const due = p.goal.due ? Math.ceil((Date.parse(`${p.goal.due}T23:59:00`) - Date.now()) / 86_400_000) : null;
            return (
              <li key={p.goal.id} className="panel lift relative overflow-hidden p-5">
                <span className="pointer-events-none absolute -top-16 -right-16 h-40 w-40 rounded-full opacity-25 blur-3xl" style={{ background: h.tone }} aria-hidden />
                <div className="relative flex items-start gap-4">
                  <Ring pct={pct} tone={h.tone} label={`${Math.round(pct * 100)}%`} />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 text-[11px]">
                      <span className="rounded-md px-1.5 py-0.5 font-mono tracking-[0.06em] uppercase" style={{ color: h.tone, background: `color-mix(in oklab, ${h.tone}, transparent 86%)` }}>
                        {h.label}
                      </span>
                      {due !== null && <span className={cn("font-mono", due < 0 ? "text-bad" : due <= 7 ? "text-warn" : "text-faint")}>{due < 0 ? `${-due}d overdue` : `${due}d left`}</span>}
                      {p.streak > 1 && (
                        <span className="flex items-center gap-1 font-mono text-warn">
                          <Flame className="h-3 w-3" /> {p.streak}
                        </span>
                      )}
                    </p>
                    <h3 className="mt-1.5 text-[16px] leading-snug font-semibold tracking-[-0.01em]">{p.goal.title}</h3>
                    <p className="mt-1 text-[13px] text-muted">{p.goal.next ? `Next: ${p.goal.next}` : "No next action yet — add one below."}</p>
                  </div>
                </div>
                <div className="relative mt-4 flex items-end gap-1.5" aria-label={`Last 7 days: ${p.days.map((d) => fmt(d.min)).join(", ")}`}>
                  {p.days.map((d, i) => (
                    <span key={d.day} className="flex flex-1 flex-col items-center gap-1">
                      <span
                        className="w-full origin-bottom animate-[grow_700ms_var(--ease-out-expo)_both] rounded-[4px] motion-reduce:animate-none"
                        style={{ height: `${Math.max(3, (d.min / max) * 44)}px`, background: d.min ? h.tone : "rgb(255 255 255 / 0.06)", opacity: i === 6 ? 1 : 0.7, animationDelay: `${i * 45}ms` }}
                      />
                      <span className="font-mono text-[9px] text-faint">{new Date(`${d.day}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "narrow", timeZone: "UTC" })}</span>
                    </span>
                  ))}
                </div>
                <p className="relative mt-3 text-xs text-faint">
                  {fmt(p.weekMin)} of {fmt(p.targetMin)} this week
                  {p.todayPlannedMin > 0 ? ` · ${fmt(p.todayPlannedMin)} planned today` : p.todayDoneMin ? ` · ${fmt(p.todayDoneMin)} today` : " · nothing planned today"}
                </p>
                {!p.goal.done && (
                  <div className="relative mt-4 flex gap-2">
                    <button onClick={() => void act("focus", p.goal.id, 50)} disabled={!!busy} className="press flex h-10 flex-1 items-center justify-center gap-2 rounded-[11px] bg-text text-sm font-medium text-bg">
                      {busy === `focus:${p.goal.id}` ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Focus now · 50m
                    </button>
                    <button onClick={() => void act("plan", p.goal.id, 50)} disabled={!!busy} className="press flex h-10 items-center gap-2 rounded-[11px] border border-line px-3 text-sm text-muted hover:text-text" aria-label={`Plan 50 minutes on ${p.goal.title} into today`}>
                      {busy === `plan:${p.goal.id}` ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <CalendarPlus className="h-4 w-4" />} Plan
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p className="flex items-center gap-2 px-1 text-xs text-faint">
        <Target className="h-3.5 w-3.5" /> Progress = focus blocks you ticked done on each goal. <Pencil className="ml-1 h-3 w-3" /> Edit goals and weekly targets below.
      </p>
    </div>
  );
}

function Ring({ pct, tone, label }: { pct: number; tone: string; label: string }) {
  const R = 26;
  const C = 2 * Math.PI * R;
  return (
    <span className="relative grid h-16 w-16 shrink-0 place-items-center">
      <svg viewBox="0 0 64 64" className="absolute inset-0 -rotate-90" aria-hidden>
        <circle cx="32" cy="32" r={R} fill="none" stroke="rgb(255 255 255 / 0.07)" strokeWidth="5" />
        {pct > 0 && <circle cx="32" cy="32" r={R} fill="none" stroke={tone} strokeWidth="5" strokeLinecap="round" strokeDasharray={`${C * pct} ${C}`} className="transition-[stroke-dasharray] duration-1000 ease-[var(--ease-out-expo)]" style={{ filter: `drop-shadow(0 0 6px ${tone})` }} />}
      </svg>
      <span className="tnum font-mono text-[12px] font-semibold">{label}</span>
    </span>
  );
}

function ScoreRing({ score }: { score: number }) {
  const tone = score >= 75 ? "#5fd39a" : score >= 50 ? "#f2c14e" : "#f06c6c";
  return (
    <span className="relative grid h-20 w-20 shrink-0 place-items-center">
      <Ring pct={score / 100} tone={tone} label="" />
      <span className="absolute text-xl font-semibold">
        <CountUp value={score} />
      </span>
    </span>
  );
}
