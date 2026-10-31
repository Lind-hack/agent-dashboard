import { ArrowRight, Crosshair, Flame, Target } from "lucide-react";
import Link from "next/link";
import type { CoachNow, GoalProgress } from "@/lib/coach";
import { cn } from "@/lib/utils";

// Home's top strip: the goal-linked day at a glance — what this minute is for, today's focus so far,
// and each active goal's week against its target. Everything links into /focus or /goals.

const fmt = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}` : `${m}m`);
const TONE = ["#e879c9", "#b392f0", "#7c98ff"];

export function MissionStrip({ now, goals }: { now: CoachNow; goals: GoalProgress[] }) {
  const active = goals.filter((g) => g.goal.horizon !== "long").slice(0, 3);
  const c = now.current;
  const n = now.next;
  return (
    <section className="grid gap-3 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,2fr)]" aria-label="Today's mission">
      <Link
        href={c ? `/focus?block=${encodeURIComponent(c.id)}` : n ? `/focus?block=${encodeURIComponent(n.id)}` : "/calendar"}
        className="panel lift group relative flex min-h-[132px] flex-col justify-between overflow-hidden p-5"
      >
        <span className="pointer-events-none absolute inset-0 bg-[radial-gradient(380px_160px_at_0%_100%,rgb(246_178_94/0.16),transparent_70%)]" aria-hidden />
        <p className="hud-label relative flex items-center gap-2 !text-[10px]">
          <Crosshair className="h-3.5 w-3.5 text-[#f6b25e]" /> {c ? (c.status === "running" ? "Focus · now" : "Now · not started") : n ? `Next · ${n.start}` : now.planned ? "Day's plan is done" : "No plan yet"}
        </p>
        <p className="relative mt-2 text-[1.25rem] leading-snug font-semibold tracking-[-0.02em] text-balance">{c?.title ?? n?.title ?? (now.planned ? "Pick a goal and give it a block." : "Plan the day — two minutes.")}</p>
        <p className="relative mt-2 flex items-center justify-between text-xs text-muted">
          <span>
            {now.done}/{now.total} blocks · {fmt(now.focusMin)} focused today
          </span>
          <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
        </p>
      </Link>

      <Link href="/goals" className="panel lift group relative flex flex-col justify-between overflow-hidden p-5">
        <p className="hud-label flex items-center gap-2 !text-[10px]">
          <Target className="h-3.5 w-3.5 text-hermes" /> Goals this week
        </p>
        {active.length === 0 ? (
          <p className="mt-3 text-sm text-muted">No active goals yet — set up to three and every day gets a focus block for each.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-3">
            {active.map((g, i) => {
              const pct = Math.min(1, g.weekMin / Math.max(1, g.targetMin));
              return (
                <li key={g.goal.id} className="flex items-center gap-3">
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 text-[13.5px]">
                      <span className="truncate">{g.goal.title}</span>
                      {g.streak > 1 && (
                        <span className="flex shrink-0 items-center gap-0.5 font-mono text-[10px] text-warn">
                          <Flame className="h-3 w-3" />
                          {g.streak}
                        </span>
                      )}
                    </span>
                    <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                      <span className="block h-full rounded-full transition-[width] duration-1000 ease-[var(--ease-out-expo)]" style={{ width: `${pct * 100}%`, background: TONE[i], boxShadow: pct ? `0 0 10px -2px ${TONE[i]}` : undefined }} />
                    </span>
                  </span>
                  <span className={cn("tnum w-24 shrink-0 text-right font-mono text-[11px]", pct >= 1 ? "text-ok" : "text-muted")}>
                    {fmt(g.weekMin)} / {fmt(g.targetMin)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Link>
    </section>
  );
}
