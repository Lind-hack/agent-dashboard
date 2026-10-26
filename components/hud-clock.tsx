"use client";

import { useEffect, useState } from "react";

// Mission clock, Pristina time. Renders nothing until mounted so server and client never disagree.
export function HudClock({ className }: { className?: string }) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!now) return <div className={className} aria-hidden />;
  const part = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Belgrade", ...o }).format(now);
  const hm = part({ hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const s = part({ second: "2-digit" }).padStart(2, "0");
  return (
    <div className={className}>
      <p className="tnum leading-none font-light tracking-[-0.04em]" aria-label={`Time ${hm}`}>
        {hm}
        <span className="ml-1 align-top text-[0.42em] font-normal tracking-normal text-hud/70">{s}</span>
      </p>
      <p className="hud-label mt-1.5 text-right">{part({ weekday: "short", day: "2-digit", month: "short" }).replace(",", " ·")}</p>
    </div>
  );
}
