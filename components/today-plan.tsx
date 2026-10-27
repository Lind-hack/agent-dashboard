"use client";

import { Ban, CalendarClock, Check, Flame, LoaderCircle, Play, RotateCcw, Target } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { BlockAction, PlanStats, StoredBlock } from "@/lib/plan-store";
import { cn } from "@/lib/utils";
import { Panel, SectionTitle } from "./kit";
import { KIND_STYLE } from "./today";

// The stored plan: what Lind actually did with each block. Ticks live in data/plans/<day>.json, so a
// re-plan can rewrite the calendar and the vault note without erasing progress.

const STATUS: Record<StoredBlock["status"], { label: string; tone: string }> = {
  planned: { label: "planned", tone: "text-muted" },
  running: { label: "now", tone: "text-hud" },
  done: { label: "done", tone: "text-ok" },
  blocked: { label: "blocked", tone: "text-bad" },
  moved: { label: "moved", tone: "text-faint" },
  dropped: { label: "dropped", tone: "text-faint" },
};

const span = (n: number) => (n >= 60 ? `${Math.floor(n / 60)}h${n % 60 ? ` ${n % 60}m` : ""}` : `${n}m`);

export function TodayPlan({
  day,
  note,
  blocks,
  stats,
  leftMin,
  freeMin,
  overflow,
  goals,
  dayEnd,
}: {
  day: string;
  note?: string;
  blocks: StoredBlock[];
  stats: PlanStats;
  leftMin: number;
  freeMin: number;
  overflow: string[];
  goals: { id: string; title: string }[];
  dayEnd: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const goalTitle = new Map(goals.map((g) => [g.id, g.title]));

  async function act(id: string, action: BlockAction) {
    setBusy(`${id}:${action}`);
    setError("");
    try {
      const res = await fetch("/api/plan/blocks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ day, id, action }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? `error ${res.status}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  const running = blocks.find((b) => b.status === "running");

  return (
    <section className="mt-8">
      <SectionTitle right={blocks.length ? `${stats.todayDone}/${stats.todayTotal} done` : undefined}>The plan</SectionTitle>

      {note && <Panel className="mb-3 p-4"><p className="hud-label">Your plan note</p><p className="mt-2 whitespace-pre-wrap text-sm text-muted">{note}</p></Panel>}

      <div className="mb-2.5 grid grid-cols-3 gap-2">
        <Stat label="this week" value={`${stats.weekDays} day${stats.weekDays === 1 ? "" : "s"}`} hint="with a plan" />
        <Stat label="ticked" value={`${stats.percent}%`} hint={`${stats.weekDone}/${stats.weekTotal} blocks`} />
        <Stat label="streak" value={`${stats.streak}`} hint={stats.streak === 1 ? "day in a row" : "days in a row"} icon={stats.streak > 0} />
      </div>

      {blocks.length === 0 ? (
        <Panel>
          <p className="px-5 py-6 text-sm text-muted">Nothing planned for today yet. Make a plan above — blocks land here with Start / Done / Move.</p>
        </Panel>
      ) : (
        <Panel className="overflow-hidden">
          {error && <p className="border-b border-line px-4 py-2 text-xs text-bad">{error}</p>}
          <ol>
            {blocks.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-3 py-2.5 last:border-0">
                <span className={cn("h-9 w-[3px] shrink-0 rounded-full", KIND_STYLE[b.kind].bar, b.status === "done" && "opacity-40")} aria-hidden />
                <span className="tnum w-[84px] shrink-0 font-mono text-[11.5px] text-muted">
                  {b.start}–{b.end}
                </span>
                <span className="min-w-0 flex-1 basis-[150px]">
                  <span className={cn("block truncate text-[15px] leading-snug", b.status === "done" && "text-muted line-through")}>{b.title}</span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
                    <span className={cn(STATUS[b.status].tone, b.status === "running" && "font-medium")}>{STATUS[b.status].label}</span>
                    <span className="text-faint">·</span>
                    <span className={KIND_STYLE[b.kind].text}>{KIND_STYLE[b.kind].label}</span>
                    {b.goalId && goalTitle.get(b.goalId) && (
                      <>
                        <span className="text-faint">·</span>
                        <span className="flex min-w-0 items-center gap-1 text-hermes">
                          <Target className="h-3 w-3 shrink-0" aria-hidden />
                          <span className="truncate">{goalTitle.get(b.goalId)}</span>
                        </span>
                      </>
                    )}
                    {b.taskId && (
                      <>
                        <span className="text-faint">·</span>
                        <span className="text-muted">TickTick</span>
                      </>
                    )}
                  </span>
                </span>
                <span className="ml-auto flex shrink-0 items-center gap-0.5">
                  {b.status !== "done" && b.status !== "running" && (
                    <Control label="Start" onClick={() => act(b.id, "start")} busy={busy === `${b.id}:start`}>
                      <Play className="h-4 w-4" />
                    </Control>
                  )}
                  {b.status !== "done" && (
                    <Control label="Done" onClick={() => act(b.id, "done")} busy={busy === `${b.id}:done`} className="hover:text-ok">
                      <Check className="h-4 w-4" />
                    </Control>
                  )}
                  {b.status !== "blocked" && b.status !== "done" && (
                    <Control label="Blocked" onClick={() => act(b.id, "blocked")} busy={busy === `${b.id}:blocked`} className="hover:text-bad">
                      <Ban className="h-4 w-4" />
                    </Control>
                  )}
                  {b.status === "done" || b.status === "blocked" || b.status === "running" ? (
                    <Control label="Reopen" onClick={() => act(b.id, "planned")} busy={busy === `${b.id}:planned`}>
                      <RotateCcw className="h-4 w-4" />
                    </Control>
                  ) : (
                    <Control label="Move to tomorrow" onClick={() => act(b.id, "move")} busy={busy === `${b.id}:move`} className="hover:text-hud">
                      <CalendarClock className="h-4 w-4" />
                    </Control>
                  )}
                </span>
              </li>
            ))}
          </ol>
        </Panel>
      )}

      <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-xs text-faint">
        <span>
          {span(leftMin)} left · {span(freeMin)} free before {dayEnd}
        </span>
        {running && <span className="text-hud">now: {running.title}</span>}
      </p>

      {overflow.length > 0 && (
        <Panel className="mt-3 border-warn/25 p-4">
          <p className="flex items-center gap-2 text-sm text-warn">
            <Flame className="h-4 w-4" /> Won&apos;t fit today
          </p>
          <ul className="mt-1.5 flex flex-col gap-1 text-[13px] text-muted">
            {overflow.map((t, i) => (
              <li key={`${t}-${i}`} className="truncate">
                {t}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-faint">Move them to tomorrow or replan a lighter day — the point is finishing, not filling.</p>
        </Panel>
      )}
    </section>
  );
}

function Stat({ label, value, hint, icon }: { label: string; value: string; hint: string; icon?: boolean }) {
  return (
    <Panel className="px-3 py-3">
      <p className="hud-label !text-[9.5px]">{label}</p>
      <p className="tnum mt-1 flex items-center gap-1 text-[1.35rem] leading-none font-semibold tracking-[-0.03em]">
        {icon && <Flame className="h-4 w-4 text-warn" aria-hidden />}
        {value}
      </p>
      <p className="mt-1 truncate text-[11px] text-faint">{hint}</p>
    </Panel>
  );
}

function Control({
  label,
  onClick,
  busy,
  className,
  children,
}: {
  label: string;
  onClick: () => void;
  busy?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={!!busy}
      aria-label={label}
      title={label}
      className={cn("grid h-8 w-8 place-items-center rounded-[10px] text-faint transition-colors hover:bg-white/5 hover:text-text disabled:opacity-40 sm:h-9 sm:w-9", className)}
    >
      {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : children}
    </button>
  );
}
