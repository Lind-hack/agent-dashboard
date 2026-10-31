import { Flame, Gauge, Hourglass, ListChecks, Timer } from "lucide-react";
import type { DayProgress } from "@/lib/coach";
import { cn } from "@/lib/utils";
import { CountUp } from "./motion";

// The day at a glance (v5): how much of today's work is done against where it should be by now, what's
// left, and whether it still fits before the day ends. The ring's tick marks the expected position.

const fmt = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}` : `${m}m`);
const PACE: Record<DayProgress["pace"], { label: string; tone: string; ring: string }> = {
  ahead: { label: "Ahead of pace", tone: "text-ok", ring: "var(--color-ok)" },
  "on-pace": { label: "On pace", tone: "text-hud", ring: "var(--color-hud)" },
  behind: { label: "Behind pace", tone: "text-warn", ring: "var(--color-warn)" },
  "not-started": { label: "Not started", tone: "text-muted", ring: "var(--color-hermes)" },
};

export function DayPulse({ p }: { p: DayProgress }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const pace = PACE[p.pace];
  const tick = (p.expected / 100) * 360 - 90;
  return (
    <section className="panel brackets relative mt-6 overflow-hidden p-5" aria-label="Today's progress">
      <div
        className="pointer-events-none absolute -top-24 -left-16 h-64 w-64 rounded-full opacity-25 blur-3xl"
        style={{ background: `radial-gradient(circle, ${pace.ring}, transparent 70%)` }}
        aria-hidden
      />
      <div className="relative flex flex-wrap items-center gap-6">
        <div className="relative h-[132px] w-[132px] shrink-0">
          <svg viewBox="0 0 132 132" className="h-full w-full -rotate-90" aria-hidden>
            <circle cx="66" cy="66" r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="10" />
            <circle
              cx="66"
              cy="66"
              r={r}
              fill="none"
              stroke={pace.ring}
              strokeWidth="10"
              strokeLinecap="round"
              strokeDasharray={c}
              strokeDashoffset={c * (1 - p.percent / 100)}
              className="pulse-ring"
              style={{ filter: `drop-shadow(0 0 6px ${pace.ring})` }}
            />
          </svg>
          {/* Where the day says you should be by now */}
          <span className="absolute inset-0" style={{ transform: `rotate(${tick + 90}deg)` }} aria-hidden>
            <span className="absolute top-[3px] left-1/2 h-[16px] w-[2px] -translate-x-1/2 rounded-full bg-text/80" />
          </span>
          <span className="absolute inset-0 grid place-items-center text-center">
            <span>
              <CountUp value={p.percent} suffix="%" className="tnum block text-[1.9rem] leading-none font-semibold tracking-[-0.04em]" />
              <span className="mt-1 block font-mono text-[9.5px] tracking-[0.14em] text-faint uppercase">done</span>
            </span>
          </span>
        </div>

        <div className="min-w-0 flex-1 basis-[220px]">
          <p className={cn("flex items-center gap-2 text-[15px] font-medium", pace.tone)}>
            <Gauge className="h-4 w-4" aria-hidden /> {pace.label}
            {p.pace !== "not-started" && <span className="font-mono text-[11px] font-normal text-faint">aim ~{p.expected}% by now</span>}
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat icon={<ListChecks className="h-3.5 w-3.5" />} label="tasks" value={`${p.tasksDone}/${p.tasksTotal}`} />
            <Stat icon={<Timer className="h-3.5 w-3.5" />} label="work left" value={fmt(p.workLeftMin)} />
            <Stat icon={<Hourglass className="h-3.5 w-3.5" />} label="day left" value={fmt(p.untilEndMin)} />
            <Stat icon={<Flame className="h-3.5 w-3.5" />} label="focused" value={fmt(p.focusMin)} />
          </div>
          {p.overloadMin > 0 ? (
            <p className="mt-3 rounded-[10px] border border-warn/25 bg-warn/[0.07] px-3 py-2 text-[13px] text-warn">
              {fmt(p.overloadMin)} more work than free time left ({fmt(p.freeMin)} outside your events) — cut, shrink or move something. Ask the assistant below.
            </p>
          ) : p.tasksTotal > 0 && p.workLeftMin === 0 ? (
            <p className="mt-3 text-[13px] text-ok">Everything on today&apos;s list is done.</p>
          ) : p.next ? (
            <p className="mt-3 truncate text-[13px] text-muted">
              Most urgent: <span className="text-text">{p.next.title}</span>
              {p.next.dueAt?.includes("T") && <span className="font-mono text-[11px] text-warn"> · due {p.next.dueAt.slice(11)}</span>}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-[12px] border border-line bg-white/[0.025] px-3 py-2">
      <p className="flex items-center gap-1.5 font-mono text-[9.5px] tracking-[0.12em] text-faint uppercase">
        {icon} {label}
      </p>
      <p className="tnum mt-1 text-[1.05rem] leading-none font-semibold tracking-[-0.02em]">{value}</p>
    </div>
  );
}
