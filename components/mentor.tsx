"use client";

import { Check, ChevronDown, Compass, LoaderCircle, Minus, Plus, RefreshCw, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { MentorDay, PlanTalk, Scorecard } from "@/lib/mentor";
import { cn } from "@/lib/utils";
import { PlanTalkPanel } from "./plan-together";

// The Mentor on Goals (v5.4): today's orders on top — what to do and exactly how — then each goal's
// plan as a scoreboard: where the number is against the straight line to the target, the next
// milestone, and this week's leading indicators with a + to log them on the spot.

export type MentorGoal = { id: string; title: string; due?: string; card: Scorecard | null; talk: PlanTalk | null };

const fmtN = (n: number) => (Math.abs(n) >= 1000 ? n.toLocaleString("en", { maximumFractionDigits: 0 }) : String(Math.round(n * 10) / 10));

async function post(body: object) {
  const res = await fetch("/api/mentor", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const out = await res.json().catch(() => null);
  if (!res.ok) throw new Error(out?.error ?? `error ${res.status}`);
  return out;
}

export function MentorOrders({ day, done, hasPlans }: { day: MentorDay | null; done: Record<string, boolean>; hasPlans: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [open, setOpen] = useState<number | null>(0);

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setError("");
    try {
      await fn();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work.");
    } finally {
      setBusy("");
    }
  }
  const tick = (id: string) => run(`tick:${id}`, () => fetch("/api/todos", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, done: !done[id] }) }));
  const left = day ? day.orders.filter((o) => !(o.todoId && done[o.todoId])).length : 0;

  return (
    <section id="orders" aria-labelledby="orders-title" className="panel relative scroll-mt-24 overflow-hidden p-5 sm:p-6">
      <span className="pointer-events-none absolute -top-24 -left-20 h-56 w-56 rounded-full bg-[#f6b25e] opacity-[0.12] blur-3xl" aria-hidden />
      <div className="relative flex items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-1.5 font-mono text-[10.5px] tracking-[0.18em] text-[#f6b25e] uppercase">
            <Compass className="h-3.5 w-3.5" /> Your mentor · today&apos;s orders
          </p>
          <h2 id="orders-title" className="mt-1.5 text-[1.5rem] leading-tight font-semibold tracking-[-0.03em]">
            {!day ? "No orders yet today." : left === 0 ? "All orders done. That's how it's built." : `${left} of ${day.orders.length} still to do.`}
          </h2>
        </div>
        {hasPlans && (
          <button onClick={() => void run("orders", () => post({ action: "orders" }))} disabled={!!busy} className="flex h-9 shrink-0 items-center gap-1.5 rounded-[10px] border border-line px-3 text-[12.5px] text-muted hover:text-text disabled:opacity-60">
            {busy === "orders" ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : day ? <RefreshCw className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5 text-[#f6b25e]" />}
            {day ? "New orders" : "Get today's orders"}
          </button>
        )}
      </div>

      {!hasPlans && <p className="relative mt-3 max-w-prose text-[13.5px] text-muted">Plan a goal with your mentor below and lock it. From then on, every morning at 07:00 it reads your numbers and where you are, and puts 1–3 orders on Today with exactly how to do them.</p>}
      {day?.note && <p className="relative mt-3 max-w-prose text-[14px] leading-relaxed text-text/85">{day.note}</p>}

      {day && day.orders.length > 0 && (
        <ol className="relative mt-4 flex flex-col gap-2">
          {day.orders.map((o, i) => {
            const isDone = !!(o.todoId && done[o.todoId]);
            return (
              <li key={`${o.todoId ?? i}`} className={cn("rounded-[12px] border border-line bg-black/20 transition-colors", isDone && "opacity-60")}>
                <div className="flex items-center gap-3 p-3">
                  <button onClick={() => o.todoId && void tick(o.todoId)} disabled={!o.todoId || !!busy} aria-label={isDone ? `Not done: ${o.title}` : `Done: ${o.title}`} className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-full border", isDone ? "border-ok bg-ok/20 text-ok" : "border-line-hi hover:border-ok")}>
                    {busy === `tick:${o.todoId}` ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : isDone && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                  </button>
                  <button onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                    <span className={cn("min-w-0 flex-1 text-[14.5px] leading-snug font-medium", isDone && "line-through")}>{o.title}</span>
                    <span className="tnum shrink-0 font-mono text-[11px] text-faint">{o.minutes}m</span>
                    <ChevronDown className={cn("h-4 w-4 shrink-0 text-faint transition-transform", open === i && "rotate-180")} />
                  </button>
                </div>
                {open === i && o.how && <p className="border-t border-line px-3 py-2.5 pl-[52px] text-[13px] leading-relaxed whitespace-pre-line text-muted">{o.how}</p>}
              </li>
            );
          })}
        </ol>
      )}
      {day && <p className="relative mt-3 text-[11.5px] text-faint">These are on Today as top-priority tasks; the planner books them first.</p>}
      {error && <p className="relative mt-2 text-sm text-bad">{error}</p>}
    </section>
  );
}

export function GoalPlans({ goals, today }: { goals: MentorGoal[]; today: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [level, setLevel] = useState<Record<string, string>>({});

  async function run(key: string, body: object) {
    setBusy(key);
    setError("");
    try {
      await post(body);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work.");
    } finally {
      setBusy("");
    }
  }

  if (!goals.length) return null;
  return (
    <section aria-labelledby="plans-title" className="flex flex-col gap-3">
      <h2 id="plans-title" className="px-1 text-xl font-semibold tracking-[-0.02em]">
        The plan for each goal
      </h2>
      {error && <p className="px-1 text-sm text-bad">{error}</p>}
      <ul className="grid gap-3 lg:grid-cols-2">
        {goals.map((g) => {
          const c = g.card;
          if (g.talk) return <PlanTalkPanel key={g.id} title={g.title} talk={g.talk} />;
          const start = () => void run(`talk:${g.id}`, { action: "talk-start", goalId: g.id });
          if (!c) {
            return (
              <li key={g.id} className="panel flex flex-col gap-3 p-5">
                <p className="text-[15px] font-semibold">{g.title}</p>
                <p className="text-[13.5px] text-muted">No plan yet. Your mentor reads your notes and journal, tells you where it thinks you stand and asks what it needs. Then you build the plan together.</p>
                <button onClick={start} disabled={!!busy} className="flex h-11 items-center justify-center gap-2 self-start rounded-[12px] bg-white px-4 text-[14px] font-semibold text-black disabled:opacity-60">
                  {busy === `talk:${g.id}` ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} {busy === `talk:${g.id}` ? "Reading your notes…" : "Plan this with your mentor"}
                </button>
              </li>
            );
          }
          const o = c.plan.outcome;
          const span = Math.max(1, o.target - o.baseline);
          const pct = Math.min(1, Math.max(0, (c.current - o.baseline) / span));
          const line = Math.min(1, Math.max(0, (c.expected - o.baseline) / span));
          const behind = c.current < c.expected;
          const daysLeft = Math.ceil((Date.parse(`${o.by}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000);
          return (
            <li key={g.id} className="panel flex flex-col gap-4 p-5">
              {!c.plan.lockedAt && (
                <div className="flex flex-col gap-2.5 rounded-[12px] border border-warn/30 bg-warn/[0.07] p-3">
                  <p className="text-[13.5px] leading-snug">This plan was made before your mentor knew where you are. No orders from it until you plan it again together.</p>
                  <button onClick={start} disabled={!!busy} className="flex h-10 items-center justify-center gap-2 self-start rounded-[11px] bg-white px-3.5 text-[13.5px] font-semibold text-black disabled:opacity-60">
                    {busy === `talk:${g.id}` ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} {busy === `talk:${g.id}` ? "Reading your notes…" : "Plan it again"}
                  </button>
                </div>
              )}
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-mono text-[10.5px] tracking-[0.14em] text-faint uppercase">{o.label}</p>
                  <p className="mt-1 text-[15px] font-semibold">{g.title}</p>
                </div>
                <span className={cn("shrink-0 font-mono text-[11px]", daysLeft < 0 ? "text-bad" : "text-faint")}>{daysLeft < 0 ? `${-daysLeft}d past` : `${daysLeft}d left`}</span>
              </div>

              <div>
                <p className="tnum text-[1.9rem] leading-none font-semibold tracking-[-0.04em]">
                  {fmtN(c.current)}
                  <span className="ml-1.5 text-[15px] font-normal text-muted">
                    / {fmtN(o.target)} {o.unit}
                  </span>
                </p>
                <div className="relative mt-3 h-2.5 rounded-full bg-white/[0.06]">
                  <div className={cn("h-full rounded-full", behind ? "bg-warn" : "bg-ok")} style={{ width: `${pct * 100}%` }} />
                  <span className="absolute -top-1 h-[18px] w-0.5 rounded bg-white/70" style={{ left: `${line * 100}%` }} title={`Where the line says you should be: ${fmtN(c.expected)}`} />
                </div>
                <p className={cn("mt-2 text-[12.5px]", behind ? "text-warn" : "text-ok")}>
                  {behind ? `${fmtN(c.expected - c.current)} ${o.unit} behind the line to ${o.by}.` : "On or ahead of the line."}
                  {!c.currentAt && <span className="text-faint"> · never logged</span>}
                </p>
                <form
                  className="mt-2 flex items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const v = Number(level[g.id]);
                    if (Number.isFinite(v) && level[g.id]?.trim()) void run(`out:${g.id}`, { action: "log", goalId: g.id, key: "outcome", value: v }).then(() => setLevel({ ...level, [g.id]: "" }));
                  }}
                >
                  <input
                    inputMode="decimal"
                    value={level[g.id] ?? ""}
                    onChange={(e) => setLevel({ ...level, [g.id]: e.target.value })}
                    placeholder={`Now at… (${o.unit || "number"})`}
                    aria-label={`Log ${o.label}`}
                    className="tnum h-9 w-40 rounded-[9px] border border-line bg-black/30 px-2.5 text-[14px] placeholder:text-faint"
                  />
                  <button disabled={!!busy} className="h-9 rounded-[9px] border border-line px-3 text-[12.5px] text-muted hover:text-text disabled:opacity-60">
                    {busy === `out:${g.id}` ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : "Log"}
                  </button>
                </form>
              </div>

              {c.week.length > 0 && (
                <div>
                  <p className="font-mono text-[10.5px] tracking-[0.14em] text-faint uppercase">This week · what you control</p>
                  <ul className="mt-2 flex flex-col gap-2">
                    {c.week.map((w) => {
                      const r = Math.min(1, w.done / Math.max(1, w.weekly));
                      const step = w.weekly >= 50 ? 5 : 1;
                      return (
                        <li key={w.key} className="flex items-center gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-baseline justify-between gap-2 text-[13px]">
                              <span className="truncate">{w.label}</span>
                              <span className="tnum shrink-0 font-mono text-[12px] text-muted">
                                {fmtN(w.done)}/{fmtN(w.weekly)}
                              </span>
                            </div>
                            <div className="mt-1 h-1.5 rounded-full bg-white/[0.06]">
                              <div className={cn("h-full rounded-full", r >= 1 ? "bg-ok" : "bg-[#f6b25e]")} style={{ width: `${r * 100}%` }} />
                            </div>
                          </div>
                          <button onClick={() => void run(`ind:${w.key}`, { action: "log", goalId: g.id, key: w.key, value: -step })} disabled={!!busy || w.done <= 0} aria-label={`Take back ${step} ${w.label}`} className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-line text-muted disabled:opacity-30">
                            <Minus className="h-3.5 w-3.5" />
                          </button>
                          <button onClick={() => void run(`ind:${w.key}`, { action: "log", goalId: g.id, key: w.key, value: step })} disabled={!!busy} aria-label={`Add ${step} ${w.label}`} className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-line-hi text-text hover:bg-white/10 disabled:opacity-60">
                            {busy === `ind:${w.key}` ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              {c.plan.milestones.length > 0 && (
                <ol className="flex flex-col gap-1.5 border-l border-line pl-3">
                  {c.plan.milestones.map((m) => {
                    const next = c.nextMilestone?.by === m.by && c.nextMilestone.label === m.label;
                    return (
                      <li key={`${m.by}${m.label}`} className={cn("flex items-baseline gap-2 text-[13px]", m.by < today ? "text-faint" : next ? "text-text" : "text-muted")}>
                        <span className="tnum w-[76px] shrink-0 font-mono text-[11px]">{m.by}</span>
                        <span className={cn(next && "font-medium")}>{m.label}</span>
                      </li>
                    );
                  })}
                </ol>
              )}

              {c.plan.strategy && (
                <details className="group">
                  <summary className="cursor-pointer list-none text-[12.5px] text-muted hover:text-text">
                    The mentor&apos;s read <span className="inline-block transition-transform group-open:rotate-90">›</span>
                  </summary>
                  <p className="mt-2 text-[13px] leading-relaxed whitespace-pre-line text-muted">{c.plan.strategy}</p>
                </details>
              )}
              {c.plan.lockedAt && (
                <button onClick={start} disabled={!!busy} className="flex min-h-11 items-center gap-1.5 self-start text-[12.5px] text-muted hover:text-text disabled:opacity-60">
                  {busy === `talk:${g.id}` ? <LoaderCircle className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} {busy === `talk:${g.id}` ? "Reading your notes…" : "Plan it again"}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
