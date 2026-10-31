"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

// Today's "Now": what's happening this minute (with a ring that empties as it runs out), what's
// next, and how much of the day is gone. Ticks every 20 s; times are ISO instants from the server.

export type NowItem = { title: string; start: string; end: string; kind: "event" | "block"; done?: boolean };

const fmt = (ms: number) => {
  const m = Math.max(0, Math.round(ms / 60_000));
  return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m` : `${m} min`;
};

export function NowCard({ items, dayStart, dayEnd, freeMin, tz }: { items: NowItem[]; dayStart: string; dayEnd: string; freeMin: number; tz: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 20_000);
    return () => clearInterval(t);
  }, []);
  if (now === null) return <div className="mt-6 h-[132px]" aria-hidden />;

  const timed = items.filter((i) => !i.done).sort((a, b) => a.start.localeCompare(b.start));
  const current = timed.find((i) => Date.parse(i.start) <= now && Date.parse(i.end) > now);
  const next = timed.find((i) => Date.parse(i.start) > now);
  const s = Date.parse(dayStart);
  const e = Date.parse(dayEnd);
  const dayPct = Math.min(1, Math.max(0, (now - s) / Math.max(1, e - s)));
  const time = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

  const left = current ? Date.parse(current.end) - now : 0;
  const span = current ? Date.parse(current.end) - Date.parse(current.start) : 1;
  const ring = current ? Math.max(0, Math.min(1, left / span)) : 0;
  const C = 2 * Math.PI * 26;

  return (
    <div className="mt-6 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]" aria-live="polite">
      <div className={cn("flex items-center gap-4 rounded-[16px] border px-4 py-3.5 backdrop-blur-md", current ? "border-[#f6b25e]/35 bg-[#f6b25e]/[0.07]" : "border-white/10 bg-black/35")}>
        <svg viewBox="0 0 64 64" className="h-14 w-14 shrink-0 -rotate-90" aria-hidden>
          <circle cx="32" cy="32" r="26" fill="none" stroke="rgb(255 255 255 / 0.08)" strokeWidth="5" />
          {ring > 0 && <circle cx="32" cy="32" r="26" fill="none" stroke="#f6b25e" strokeWidth="5" strokeLinecap="round" strokeDasharray={`${C * ring} ${C}`} className="transition-[stroke-dasharray] duration-1000 ease-[var(--ease-out-expo)]" />}
        </svg>
        <div className="min-w-0">
          <p className="hud-label !text-[9.5px] !text-[#f6b25e]">{current ? "now" : "nothing running"}</p>
          <p className="truncate text-[15px] font-medium">{current ? current.title : next ? "Free until the next thing" : "Free for the rest of the day"}</p>
          <p className="tnum text-xs text-muted">{current ? `${fmt(left)} left · until ${time(current.end)}` : next ? `${fmt(Date.parse(next.start) - now)} of open time` : `${fmt(freeMin * 60_000)} free on the calendar`}</p>
        </div>
      </div>
      <div className="flex items-center gap-4 rounded-[16px] border border-white/10 bg-black/35 px-4 py-3.5 backdrop-blur-md">
        <div className="min-w-0 flex-1">
          <p className="hud-label !text-[9.5px]">{next ? `next · ${time(next.start)}` : "next"}</p>
          <p className="truncate text-[15px] font-medium">{next ? next.title : "Nothing else scheduled"}</p>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-label="How much of the day is gone" aria-valuenow={Math.round(dayPct * 100)} aria-valuemin={0} aria-valuemax={100}>
            <div className="day-bar h-full rounded-full" style={{ width: `${dayPct * 100}%` }} />
          </div>
          <p className="tnum mt-1 text-[11px] text-faint">
            {Math.round(dayPct * 100)}% of your day gone · {fmt(Math.max(0, e - now))} left
          </p>
        </div>
        {next && <span className="tnum shrink-0 rounded-[10px] bg-white/[0.06] px-2.5 py-1.5 font-mono text-[12px] text-text">in {fmt(Date.parse(next.start) - now)}</span>}
      </div>
    </div>
  );
}
