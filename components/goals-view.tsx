"use client";

import { ArrowRight, Check, CircleCheck, LoaderCircle, Pencil, Target } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Goal, GoalHorizon } from "@/lib/goals";
import type { GoalWeek } from "@/lib/plan-store";
import { cn } from "@/lib/utils";
import { GoalMomentum } from "./goal-momentum";
import { GoalsEditor } from "./goals-editor";
import { Panel, SectionTitle } from "./kit";

const HORIZON: Record<GoalHorizon, string> = {
  now: "Now",
  short: "Short term",
  long: "Long term",
};

const order: Record<GoalHorizon, number> = { now: 0, short: 1, long: 2 };
const byHorizon = (a: Goal, z: Goal) => order[a.horizon] - order[z.horizon];

function dueInfo(due: string | undefined, today: string) {
  if (!due) return null;
  const days = Math.round((Date.parse(`${due}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000);
  const date = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(
    new Date(`${due}T12:00:00Z`),
  );
  const label = days < 0 ? `${Math.abs(days)}d overdue` : days === 0 ? "today" : days === 1 ? "tomorrow" : `${days}d left`;
  return { label: `${date} · ${label}`, tone: days < 0 ? "text-bad" : days <= 3 ? "text-warn" : "text-faint" };
}

export function GoalsView({ goals, weeks, today }: { goals: Goal[]; weeks: Record<string, GoalWeek>; today: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");

  const active = goals.filter((g) => !g.done && (g.horizon === "now" || g.horizon === "short")).sort(byHorizon);
  const long = goals.filter((g) => !g.done && g.horizon === "long");
  const achieved = goals.filter((g) => g.done);
  const north = active[0];
  const rest = active.slice(1);

  async function achieve(goal: Goal) {
    setBusy(goal.id);
    setMsg("");
    try {
      const next = goals.map((g) => (g.id === goal.id ? { ...g, done: true } : g));
      const res = await fetch("/api/goals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goals: next }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) throw new Error(body?.error ?? `error ${res.status}`);
      setMsg(`“${goal.title}” is achieved.`);
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  if (editing) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3 px-1">
          <p className="text-sm text-muted">Editing your goals. Save when the list reads true.</p>
          <button onClick={() => setEditing(false)} className="shrink-0 text-xs text-faint transition-colors hover:text-text">
            Cancel
          </button>
        </div>
        <GoalsEditor
          initial={goals}
          onSaved={() => {
            setEditing(false);
            setMsg("Saved. The next plan will use them.");
          }}
        />
        {msg && <Message msg={msg} />}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3 px-1">
        <p className="text-xs text-faint">
          {active.length > 0 ? `${active.length} in play` : goals.length > 0 ? "Nothing in play" : "Start with one"}
          {long.length > 0 ? ` · ${long.length} on the horizon` : ""}
        </p>
        <button
          onClick={() => setEditing(true)}
          className="flex h-8 shrink-0 items-center gap-1.5 rounded-[9px] border border-line px-2.5 text-xs text-muted transition-colors hover:border-line-hi hover:text-text"
        >
          <Pencil className="h-3.5 w-3.5" aria-hidden /> Edit goals
        </button>
      </div>

      {goals.length === 0 ? (
        <Panel className="goal-wash relative overflow-hidden">
          <div className="max-w-[52ch] p-6 sm:p-8">
            <span className="grid h-11 w-11 place-items-center rounded-[13px] border border-hud/25 bg-hud/[0.06]">
              <Target className="h-5 w-5 text-hud" aria-hidden />
            </span>
            <h2 className="mt-4 text-[1.65rem] leading-[1.08] font-semibold tracking-[-0.035em] text-balance sm:text-[1.9rem]">
              Give the day something to aim at.
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              Write down what you&apos;re actually chasing, then the one action that moves it this week. The planner puts your active goals first — before tasks, before everything else.
            </p>
            <button
              onClick={() => setEditing(true)}
              className="mt-5 flex h-10 items-center gap-2 rounded-[12px] bg-text px-5 text-sm font-medium text-bg transition-colors hover:bg-white"
            >
              Write your first goal <ArrowRight className="h-4 w-4" aria-hidden />
            </button>
          </div>
        </Panel>
      ) : north ? (
        <>
          <GoalCard goal={north} week={weeks[north.id]} today={today} hero busy={busy === north.id} onAchieve={achieve} />
          {rest.length > 0 && (
            <section className="mt-4">
              <SectionTitle right={`${rest.length} more`}>Also in play</SectionTitle>
              <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2">
                {rest.map((g) => (
                  <GoalCard key={g.id} goal={g} week={weeks[g.id]} today={today} busy={busy === g.id} onAchieve={achieve} />
                ))}
              </div>
            </section>
          )}
        </>
      ) : (
        <Panel className="p-5">
          <p className="text-[16px] font-medium">No active goals.</p>
          <p className="mt-1 max-w-[46ch] text-sm leading-relaxed text-muted">
            Move one of the long-term goals up, or write a new one. The day planner only reserves time for now and short-term goals.
          </p>
          <button
            onClick={() => setEditing(true)}
            className="mt-4 flex h-9 items-center gap-2 rounded-[10px] bg-text px-4 text-sm font-medium text-bg transition-colors hover:bg-white"
          >
            Set an active goal
          </button>
        </Panel>
      )}

      {long.length > 0 && (
        <section className="mt-5">
          <SectionTitle right={`${long.length}`}>On the horizon</SectionTitle>
          <Panel className="overflow-hidden">
            {long.map((g) => {
              const due = dueInfo(g.due, today);
              return (
                <div key={g.id} className="flex items-start gap-3 border-b border-line px-4 py-3 last:border-0">
                  <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-[10px] border border-line bg-white/[0.02]">
                    <Target className="h-4 w-4 text-faint" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <p className="min-w-0 flex-1 text-[15px] leading-snug">{g.title}</p>
                      {due && <span className={cn("font-mono text-[9.5px]", due.tone)}>{due.label}</span>}
                    </div>
                    {g.why && <p className="mt-0.5 line-clamp-2 text-[12px] leading-relaxed text-muted">{g.why}</p>}
                  </div>
                  <GoalMomentum week={weeks[g.id] ?? { done: 0, total: 0, days: [] }} today={today} className="mt-1 shrink-0" />
                </div>
              );
            })}
          </Panel>
        </section>
      )}

      {achieved.length > 0 && (
        <section className="mt-5">
          <Panel className="overflow-hidden">
            <details className="group">
              <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm text-muted transition-colors hover:text-text [&::-webkit-details-marker]:hidden">
                <Check className="h-4 w-4 text-ok" aria-hidden /> Achieved
                <span className="ml-auto font-mono text-[10px] text-faint">{achieved.length}</span>
              </summary>
              <div className="border-t border-line">
                {achieved.map((g) => (
                  <div key={g.id} className="flex items-start gap-3 border-b border-line px-4 py-3 last:border-0">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-ok/70" aria-hidden />
                    <div className="min-w-0">
                      <p className="text-[14px] leading-snug text-muted">{g.title}</p>
                      {g.why && <p className="mt-0.5 text-[11px] text-faint">{g.why}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </details>
          </Panel>
        </section>
      )}

      {msg && <Message msg={msg} />}
    </div>
  );
}

function GoalCard({
  goal,
  week,
  today,
  hero = false,
  busy,
  onAchieve,
}: {
  goal: Goal;
  week?: GoalWeek;
  today: string;
  hero?: boolean;
  busy: boolean;
  onAchieve: (goal: Goal) => void;
}) {
  const due = dueInfo(goal.due, today);
  const momentum = week ?? { done: 0, total: 0, days: [] };
  return (
    <Panel className={cn("relative overflow-hidden", hero && "brackets goal-wash")}>
      <div className={cn("relative p-4", hero && "p-5 sm:p-7")}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span
            className={cn(
              "inline-flex h-6 items-center rounded-md border px-2 font-mono text-[9.5px] tracking-[0.12em] uppercase",
              goal.horizon === "now" ? "border-hud/30 text-hud" : "border-line text-faint",
            )}
          >
            {HORIZON[goal.horizon]}
          </span>
          {due && <span className={cn("font-mono text-[10px]", due.tone)}>{due.label}</span>}
        </div>

        <h2
          className={cn(
            "mt-3 max-w-[24ch] leading-[1.08] font-semibold tracking-[-0.035em] text-balance",
            hero ? "text-[1.85rem] sm:text-[2.15rem]" : "text-[1.35rem]",
          )}
        >
          {goal.title}
        </h2>
        {goal.why && <p className="mt-2 max-w-[54ch] text-[14px] leading-relaxed text-muted">{goal.why}</p>}

        <div className="mt-5">
          <p className="hud-label">Next move</p>
          <p className={cn("mt-1 max-w-[50ch] leading-snug", hero ? "text-[16px]" : "text-[14px]")}>
            {goal.next || "Choose one concrete action that moves this forward."}
          </p>
        </div>

        <div className="mt-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <GoalMomentum week={momentum} today={today} labels />
            <p className="mt-1 font-mono text-[9.5px] text-faint">
              {momentum.total ? `${momentum.done}/${momentum.total} blocks this week` : "no blocks yet this week"}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {hero && (
              <Link
                href="/calendar"
                className="flex h-9 items-center gap-1.5 rounded-[10px] bg-text px-4 text-sm font-medium text-bg transition-colors hover:bg-white"
              >
                Open today <ArrowRight className="h-3.5 w-3.5" aria-hidden />
              </Link>
            )}
            <button
              onClick={() => onAchieve(goal)}
              disabled={busy}
              className="flex h-9 items-center gap-1.5 rounded-[10px] border border-line px-3 text-xs text-muted transition-colors hover:border-ok/40 hover:text-ok disabled:opacity-40"
            >
              {busy ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" aria-hidden />}
              Achieved
            </button>
          </div>
        </div>
      </div>
    </Panel>
  );
}

function Message({ msg }: { msg: string }) {
  const good = msg.startsWith("Saved") || msg.startsWith("“");
  return (
    <p className={cn("flex items-center gap-2 px-1 text-sm", good ? "text-ok" : "text-bad")} aria-live="polite">
      {good && <CircleCheck className="h-4 w-4" aria-hidden />} {msg}
    </p>
  );
}
