"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

// Small motion pieces shared across pages. All of them settle instantly with reduced motion.

const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// A number that counts up to its value the first time it's seen, and eases to new values after.
// Server components pass decimals/suffix (functions can't cross into a client component); client
// components may pass format.
export function CountUp({ value, className, decimals, suffix = "", format }: { value: number; className?: string; decimals?: number; suffix?: string; format?: (n: number) => string }) {
  const show = format ?? ((n: number) => `${decimals === undefined ? Math.round(n).toLocaleString("en") : n.toFixed(decimals)}${suffix}`);
  const [shown, setShown] = useState(0);
  const from = useRef(0);
  const el = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (reduced()) return setShown(value);
    let raf = 0;
    const run = () => {
      const start = performance.now();
      const a = from.current;
      const step = (now: number) => {
        const k = Math.min(1, (now - start) / 900);
        const e = 1 - Math.pow(1 - k, 4);
        setShown(a + (value - a) * e);
        if (k < 1) raf = requestAnimationFrame(step);
        else from.current = value;
      };
      raf = requestAnimationFrame(step);
    };
    const node = el.current;
    if (!node) return run();
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      run();
    });
    io.observe(node);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [value]);
  return (
    <span ref={el} className={cn("tnum", className)}>
      {show(shown)}
    </span>
  );
}

// A looping Magnific clip behind a page's title. Plays only while visible and never with reduced
// motion (the still poster shows instead).
export function SectionHero({ clip, eyebrow, title, sub, right, className, children }: { clip: "memory" | "inbox" | "today" | "room" | "website" | "agents" | "home"; eyebrow?: string; title: React.ReactNode; sub?: React.ReactNode; right?: React.ReactNode; className?: string; children?: React.ReactNode }) {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !reduced()) void v.play().catch(() => {});
      else v.pause();
    });
    io.observe(v);
    return () => io.disconnect();
  }, []);
  return (
    <section className={cn("section-hero page-in mb-6 px-5 py-6 lg:mb-8 lg:px-8 lg:py-9", className)}>
      <video ref={video} src={`/media/${clip}-loop.mp4`} poster={`/media/${clip}-loop.webp`} muted loop playsInline preload="metadata" aria-hidden />
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          {eyebrow && <p className="hud-label mb-2 !text-[10.5px]">{eyebrow}</p>}
          <h1 className="text-[2rem] leading-[1.05] font-semibold tracking-[-0.035em] text-balance lg:text-[2.7rem]">{title}</h1>
          {sub && <div className="mt-2 max-w-[58ch] text-[15px] text-pretty text-muted">{sub}</div>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

// Just the loop, for a hero laid out by its page (Home).
export function HeroLoop({ clip }: { clip: string }) {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !reduced()) void v.play().catch(() => {});
      else v.pause();
    });
    io.observe(v);
    return () => io.disconnect();
  }, []);
  return <video ref={video} src={`/media/${clip}-loop.mp4`} poster={`/media/${clip}-loop.webp`} muted loop playsInline preload="metadata" aria-hidden />;
}
