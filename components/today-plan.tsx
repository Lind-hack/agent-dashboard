"use client";

import { Ban, CalendarClock, Check, Flame, LoaderCircle, MoreHorizontal, Play, RotateCcw, Target } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { BlockAction, BlockStatus, PlanStats, StoredBlock } from "@/lib/plan-store";
import { cn } from "@/lib/utils";
import { Panel, SectionTitle, StatusPill } from "./kit";
import { KIND_STYLE } from "./today";

const duration = (n: number) => (n >= 60 ? `${Math.floor(n / 60)}h${n % 60 ? ` ${n % 60}m` : ""}` : `${n}m`);
const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const clockNow = (nowClock: string) => toMin(nowClock);

type GoalLite = { id: string; title: string; why?: string };

export function TodayPlan({
  day,
  blocks,
  stats,
  leftMin,
  freeMin,
  overflow,
  goals,
  dayEnd,
  nowClock,
}: {
  day: string;
  blocks: StoredBlock[];
  stats: PlanStats;
  leftMin: number;
  freeMin: number;
  overflow: string[];
  goals: GoalLite[];
  dayEnd: string;
  nowClock: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [overrides, setOverrides] = useState<Record<string, BlockStatus>>({});
  const [pulse, setPulse] = useState("");
  const [menu, setMenu] = useState("");
  const goalById = new Map(goals.map((g) => [g.id, g]));

  useEffect(() => {
    setOverrides({});
    setMenu("");
  }, [blocks]);

  useEffect(() => {
    if (!pulse) return;
    const timer = window.setTimeout(() => setPulse(""), 900);
    return () => window.clearTimeout(timer);
  }, [pulse]);

  const view = blocks.map((b) => (overrides[b.id] ? { ...b, status: overrides[b.id] } : b));
  const running = view.find((b) => b.status === "running");
  const next = view
    .filter((b) => b.status === "planned")
    .sort((a, z) => a.start.localeCompare(z.start))[0];
  const active = running ?? next;
  const todayDone = view.filter((b) => b.status === "done").length;
  const allDone = view.length > 0 && todayDone === view.length;
  const blocked = view.filter((b) => b.status === "blocked").length;

  async function act(id: string, action: BlockAction) {
    const before = blocks.find((b) => b.id === id)?.status;
    setBusy(`${id}:${action}`);
    setError("");
    setMenu("");
    if (action === "done" || action === "start" || action === "blocked" || action === "planned") {
      const status: BlockStatus = action === "start" ? "running" : action;
      setOverrides((o) => ({ ...o, [id]: status }));
      if (action === "done") setPulse(id);
    }
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
      if (before) setOverrides((o) => ({ ...o, [id]: before }));
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  return (
    <section className="mt-8">
      <SectionTitle right={stats.weekTotal ? `${stats.weekDone}/${stats.weekTotal} this week` : undefined}>The plan</SectionTitle>

      <Panel className="brackets relative overflow-hidden">
        <PlanHeader
          blocks={view}
          todayDone={todayDone}
          streak={stats.streak}
          leftMin={leftMin}
          freeMin={freeMin}
          nowClock={nowClock}
        />

        {error && <p className="border-b border-line px-4 py-2 text-xs text-bad">{error}</p>}

        {active ? (
          <FocusDeck
            block={active}
            goal={active.goalId ? goalById.get(active.goalId) : undefined}
            nowClock={nowClock}
            busy={busy}
            act={act}
          />
        ) : allDone ? (
          <DayClosed count={todayDone} streak={stats.streak} />
        ) : (
          <PlanWaiting blocked={blocked} hasPlan={view.length > 0} />
        )}
      </Panel>

      {view.length > 0 && (
        <Panel className="relative mt-3 overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
            <p className="hud-label">Blocks</p>
            <p className="font-mono text-[10px] text-faint">tap the check to close one</p>
          </div>
          <ol className="relative py-1">
            <span className="pointer-events-none absolute top-6 bottom-6 left-[30px] w-px bg-line-hi" aria-hidden />
            {view.map((b) => {
              const goal = b.goalId ? goalById.get(b.goalId) : undefined;
              const done = b.status === "done";
              const isRunning = b.status === "running";
              const isBlocked = b.status === "blocked";
              const rowBusy = busy.startsWith(`${b.id}:`);
              const open = menu === b.id;
              return (
                <li
                  key={b.id}
                  className={cn(
                    "group relative z-[1] flex items-start gap-3 border-b border-line px-3 py-3 last:border-0",
                    isRunning && "bg-hud/[0.035]",
                    pulse === b.id && "row-flash",
                  )}
                >
                  <button
                    onClick={() => act(b.id, done ? "planned" : "done")}
                    disabled={!!busy}
                    aria-label={done ? `Reopen ${b.title}` : `Complete ${b.title}`}
                    title={done ? "Reopen" : "Complete"}
                    className={cn(
                      "relative mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full border bg-bg transition-colors disabled:opacity-50",
                      done && "border-ok/45 bg-ok/10 text-ok",
                      isRunning && "border-hud/55 text-hud shadow-[0_0_16px_-4px_var(--color-hud)]",
                      isBlocked && "border-bad/40 text-bad",
                      !done && !isRunning && !isBlocked && "border-line-hi text-faint hover:border-ok/60 hover:bg-ok/10 hover:text-ok",
                      pulse === b.id && "tick-pop",
                    )}
                  >
                    {rowBusy ? (
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                    ) : (
                      <Check className={cn("h-4 w-4 transition-opacity", done || isRunning ? "opacity-100" : "opacity-0 group-hover:opacity-100")} />
                    )}
                    {isRunning && !rowBusy && <span className="absolute -inset-px rounded-full border border-hud/25 animate-ping motion-reduce:hidden" aria-hidden />}
                    {pulse === b.id && <span className="tick-ring" aria-hidden />}
                  </button>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span className="tnum shrink-0 font-mono text-[11px] text-muted">
                        {b.start}
                        <span className="text-faint">–{b.end}</span>
                      </span>
                      <span className={cn("min-w-0 text-[15px] leading-snug", done && "text-muted line-through decoration-white/20")}>{b.title}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
                      {isRunning && <StatusPill tone="live" pulse>now</StatusPill>}
                      {isBlocked && <StatusPill tone="bad">blocked</StatusPill>}
                      <span className={KIND_STYLE[b.kind].text}>{KIND_STYLE[b.kind].label}</span>
                      {goal && (
                        <span className="flex min-w-0 items-center gap-1 text-hud">
                          <Target className="h-3 w-3 shrink-0" aria-hidden />
                          <span className="truncate">{goal.title}</span>
                        </span>
                      )}
                      {b.taskId && <span className="text-muted">TickTick</span>}
                    </div>

                    {open && (
                      <div id={`actions-${b.id}`} className="mt-2 flex flex-wrap gap-1.5">
                        {rowActions(b.status).map((a) => {
                          const Icon = a.icon;
                          return (
                            <button
                              key={a.action}
                              onClick={() => act(b.id, a.action)}
                              disabled={!!busy}
                              className={cn(
                                "flex h-8 items-center gap-1.5 rounded-[9px] border border-line px-2.5 text-[11.5px] text-muted transition-colors hover:border-line-hi hover:text-text disabled:opacity-40",
                                a.tone,
                              )}
                            >
                              <Icon className="h-3.5 w-3.5" aria-hidden /> {a.label}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <button
                    onClick={() => setMenu(open ? "" : b.id)}
                    disabled={!!busy}
                    aria-label={`Actions for ${b.title}`}
                    aria-expanded={open}
                    aria-controls={`actions-${b.id}`}
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] text-faint transition-colors hover:bg-white/5 hover:text-text disabled:opacity-40"
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </button>
                </li>
              );
            })}
          </ol>
        </Panel>
      )}

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

      <p className="mt-2 px-1 text-[10.5px] text-faint">Day ends at {dayEnd}.</p>
    </section>
  );
}

function PlanHeader({
  blocks,
  todayDone,
  streak,
  leftMin,
  freeMin,
  nowClock,
}: {
  blocks: StoredBlock[];
  todayDone: number;
  streak: number;
  leftMin: number;
  freeMin: number;
  nowClock: string;
}) {
  return (
    <div className="border-b border-line px-4 py-4 sm:px-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="hud-label">Today</p>
          <p className="tnum mt-1 text-[1.45rem] leading-none font-semibold tracking-[-0.04em]">
            <span className={todayDone ? "text-ok" : "text-text"}>{todayDone}</span>
            <span className="text-faint">/{blocks.length}</span>
            <span className="ml-1.5 text-[11px] font-normal tracking-normal text-muted">blocks closed</span>
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="hud-label">Streak</p>
          <p className="tnum mt-1 flex items-center justify-end gap-1 text-[16px] leading-none font-medium">
            {streak > 0 && <Flame className="h-3.5 w-3.5 text-warn" aria-hidden />}
            {streak > 0 ? streak : "—"}
          </p>
          <p className="mt-1 font-mono text-[9.5px] text-faint">{streak > 0 ? "days in a row" : "start today"}</p>
        </div>
      </div>

      {blocks.length > 0 && <DayRibbon blocks={blocks} nowClock={nowClock} />}

      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10px] text-faint">
        <span>{duration(leftMin)} left</span>
        <span>{duration(freeMin)} free</span>
        {blocks.length > 0 && <span className="ml-auto text-muted">{todayDone === blocks.length ? "all clear" : `${blocks.length - todayDone} open`}</span>}
      </div>
    </div>
  );
}

function DayRibbon({ blocks, nowClock }: { blocks: StoredBlock[]; nowClock: string }) {
  const starts = blocks.map((b) => toMin(b.start));
  const ends = blocks.map((b) => toMin(b.end));
  const from = Math.min(...starts);
  const to = Math.max(...ends);
  const span = Math.max(1, to - from);
  const now = clockNow(nowClock);
  const nowPct = now >= from && now <= to ? ((now - from) / span) * 100 : null;
  const done = blocks.filter((b) => b.status === "done").length;

  return (
    <div className="mt-3">
      <div className="relative h-2.5 rounded-full bg-white/[0.045]" role="img" aria-label={`${done} of ${blocks.length} blocks done`}>
        {blocks.map((b) => {
          const start = toMin(b.start);
          const end = toMin(b.end);
          const left = ((start - from) / span) * 100;
          const width = Math.max(1.6, ((end - start) / span) * 100);
          return (
            <span
              key={b.id}
              title={`${b.start}–${b.end} · ${b.title} · ${b.status}`}
              style={{ left: `${left}%`, width: `${width}%` }}
              className={cn(
                "absolute inset-y-0 z-0 rounded-full",
                b.status === "done" && "bg-ok/75",
                b.status === "running" && "bg-hud shadow-[0_0_12px_-1px_var(--color-hud)]",
                b.status === "blocked" && "bg-bad/55",
                b.status === "planned" && `${KIND_STYLE[b.kind].bar} opacity-55`,
              )}
            />
          );
        })}
        {nowPct !== null && (
          <span
            className="absolute -top-1 -bottom-1 z-10 w-px bg-hud shadow-[0_0_8px_var(--color-hud)]"
            style={{ left: `${nowPct}%` }}
            aria-hidden
          />
        )}
      </div>
      <div className="mt-1 flex justify-between font-mono text-[9px] text-faint">
        <span>{blocks.reduce((a, b) => (a.start < b.start ? a : b)).start}</span>
        <span>{blocks.reduce((a, b) => (a.end > b.end ? a : b)).end}</span>
      </div>
    </div>
  );
}

function FocusDeck({
  block,
  goal,
  nowClock,
  busy,
  act,
}: {
  block: StoredBlock;
  goal?: GoalLite;
  nowClock: string;
  busy: string;
  act: (id: string, action: BlockAction) => void;
}) {
  const running = block.status === "running";
  const start = toMin(block.start);
  const end = toMin(block.end);
  const now = clockNow(nowClock);
  const progress = running ? Math.min(100, Math.max(0, Math.round(((now - start) / Math.max(1, end - start)) * 100))) : 0;
  const timing = now < start ? `starts in ${start - now}m` : now >= end ? "window passed" : "ready now";

  return (
    <div className="px-4 py-5 sm:px-5">
      <div className="flex flex-wrap items-center gap-2">
        {running ? <StatusPill tone="live" pulse>in flight</StatusPill> : <p className="hud-label !text-[10px] !text-hud">Up next</p>}
        <span className="font-mono text-[10.5px] text-faint">
          {block.start}–{block.end}
        </span>
        {!running && <span className="font-mono text-[10.5px] text-faint">{timing}</span>}
      </div>

      <h3 className="mt-2 max-w-[28ch] text-[1.4rem] leading-[1.1] font-semibold tracking-[-0.03em] text-balance sm:text-[1.6rem]">{block.title}</h3>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
        <span className={KIND_STYLE[block.kind].text}>{KIND_STYLE[block.kind].label}</span>
        {goal && (
          <span className="flex min-w-0 items-center gap-1 text-hud">
            <Target className="h-3 w-3 shrink-0" aria-hidden />
            <span className="truncate">{goal.title}</span>
          </span>
        )}
      </div>
      {goal?.why && <p className="mt-2 max-w-[52ch] text-[13px] leading-relaxed text-muted">Why: {goal.why}</p>}

      {running && (
        <div className="mt-3">
          <div className="h-1 overflow-hidden rounded-full bg-white/[0.06]">
            <div className="h-full rounded-full bg-hud transition-[width] duration-500" style={{ width: `${progress}%` }} />
          </div>
          <div className="mt-1 flex justify-between font-mono text-[9.5px] text-faint">
            <span>{now >= end ? "past end" : `${end - now}m left`}</span>
            <span>{progress}%</span>
          </div>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {running ? (
          <button
            onClick={() => act(block.id, "done")}
            disabled={!!busy}
            className="flex h-10 items-center gap-2 rounded-[12px] bg-text px-5 text-sm font-medium text-bg transition-colors hover:bg-white disabled:opacity-40"
          >
            {busy === `${block.id}:done` ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Finish block
          </button>
        ) : (
          <button
            onClick={() => act(block.id, "start")}
            disabled={!!busy}
            className="flex h-10 items-center gap-2 rounded-[12px] bg-text px-5 text-sm font-medium text-bg transition-colors hover:bg-white disabled:opacity-40"
          >
            {busy === `${block.id}:start` ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Begin now
          </button>
        )}
        {running && (
          <button
            onClick={() => act(block.id, "blocked")}
            disabled={!!busy}
            className="flex h-10 items-center gap-2 rounded-[12px] px-3 text-sm text-muted transition-colors hover:bg-white/5 hover:text-bad disabled:opacity-40"
          >
            <Ban className="h-4 w-4" /> Blocked
          </button>
        )}
        <span className="ml-auto font-mono text-[10px] text-faint">{running ? `until ${block.end}` : `at ${block.start}`}</span>
      </div>
    </div>
  );
}

function DayClosed({ count, streak }: { count: number; streak: number }) {
  return (
    <div className="px-4 py-6 sm:px-5">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[12px] border border-ok/30 bg-ok/10">
          <Check className="h-5 w-5 text-ok" aria-hidden />
        </span>
        <div>
          <p className="hud-label !text-ok">Day closed</p>
          <p className="mt-1 text-[1.25rem] leading-tight font-semibold tracking-[-0.025em]">Every block closed.</p>
          <p className="mt-1 max-w-[46ch] text-sm leading-relaxed text-muted">
            {count} block{count === 1 ? "" : "s"} finished{streak > 0 ? ` · ${streak}-day streak` : ""}. The rest of the day is yours.
          </p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <a
          href="#plan"
          className="flex h-9 items-center gap-2 rounded-[10px] bg-text px-4 text-sm font-medium text-bg transition-colors hover:bg-white"
        >
          Plan more
        </a>
        <Link href="/goals" className="flex h-9 items-center rounded-[10px] px-3 text-sm text-muted transition-colors hover:bg-white/5 hover:text-text">
          Review goals
        </Link>
      </div>
    </div>
  );
}

function PlanWaiting({ blocked, hasPlan }: { blocked: number; hasPlan: boolean }) {
  if (hasPlan) {
    return (
      <div className="px-4 py-6 sm:px-5">
        <p className="hud-label">No next block</p>
        <p className="mt-1 text-[1.2rem] leading-tight font-semibold tracking-[-0.02em]">
          {blocked > 0 ? `${blocked} block${blocked === 1 ? " is" : "s are"} blocked.` : "Nothing left to start."}
        </p>
        <p className="mt-1 max-w-[46ch] text-sm leading-relaxed text-muted">Reopen one below when you can. The day doesn&apos;t need to be full to count.</p>
      </div>
    );
  }
  return (
    <div className="px-4 py-6 sm:px-5">
      <p className="hud-label">No plan yet</p>
      <p className="mt-1 max-w-[30ch] text-[1.25rem] leading-tight font-semibold tracking-[-0.025em]">Give the day a shape.</p>
      <p className="mt-1 max-w-[46ch] text-sm leading-relaxed text-muted">
        One focus block is enough to make today count. Plan it below — the planner puts each active goal first.
      </p>
      <a
        href="#plan"
        className="mt-4 inline-flex h-10 items-center gap-2 rounded-[12px] bg-text px-5 text-sm font-medium text-bg transition-colors hover:bg-white"
      >
        Plan my day
      </a>
    </div>
  );
}

function rowActions(status: BlockStatus): { action: BlockAction; label: string; icon: typeof Play; tone?: string }[] {
  if (status === "done") return [{ action: "planned", label: "Reopen", icon: RotateCcw }];
  if (status === "running")
    return [
      { action: "blocked", label: "Blocked", icon: Ban, tone: "hover:text-bad" },
      { action: "planned", label: "Back to planned", icon: RotateCcw },
    ];
  if (status === "blocked")
    return [
      { action: "planned", label: "Reopen", icon: RotateCcw },
      { action: "move", label: "Move to tomorrow", icon: CalendarClock, tone: "hover:text-hud" },
    ];
  return [
    { action: "start", label: "Start", icon: Play, tone: "hover:text-hud" },
    { action: "blocked", label: "Blocked", icon: Ban, tone: "hover:text-bad" },
    { action: "move", label: "Move to tomorrow", icon: CalendarClock, tone: "hover:text-hud" },
  ];
}
