"use client";

import { useEffect, useRef } from "react";

// The signature visual: a nebula with a glass orb in it, drawn live on a canvas. `energy` rises
// while agents are working, so the orb is also a status light. Pauses offscreen / in background
// tabs; one still frame under prefers-reduced-motion.

type Props = { className?: string; energy?: number; hues?: readonly [number, number, number]; size?: number };

const NEBULA = [268, 222, 18] as const; // violet, Codex blue, Claude coral

// `size` = orb radius as a share of the canvas: small in the big sidebar card, filling tiny buttons.
export function Orb({ className, energy = 0.35, hues = NEBULA, size = 0.2 }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let running = false;
    let visible = true;
    let last = 0;
    const start = () => {
      if (running || reduced || !visible || document.hidden) return;
      running = true;
      raf = requestAnimationFrame(frame);
    };

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const { width, height } = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      // Redraw at the new size; otherwise a still (reduced-motion) orb stays at its pre-layout size.
      if (ready) draw(performance.now());
    };
    let ready = false;
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      start();
    });
    io.observe(canvas);

    // Fixed seeds so the nebula keeps its shape between visits.
    const clouds = Array.from({ length: 7 }, (_, i) => ({
      hue: hues[i % 3],
      r: 0.35 + ((i * 37) % 10) / 22,
      ax: 0.18 + ((i * 13) % 7) / 40,
      ay: 0.14 + ((i * 29) % 5) / 35,
      sx: 0.00011 + i * 0.000023,
      sy: 0.00009 + i * 0.000031,
      ph: i * 1.7,
    }));
    const stars = Array.from({ length: 70 }, (_, i) => ({
      x: ((i * 7919) % 1000) / 1000,
      y: ((i * 104729) % 1000) / 1000,
      s: 0.4 + ((i * 31) % 10) / 12,
      tw: i * 0.37,
    }));

    ready = true;

    function draw(t: number) {
      const w = canvas!.width;
      const h = canvas!.height;
      const m = Math.min(w, h);
      ctx!.globalCompositeOperation = "source-over";
      ctx!.fillStyle = "#0a0712";
      ctx!.fillRect(0, 0, w, h);

      ctx!.globalCompositeOperation = "lighter";
      for (const c of clouds) {
        const x = w * (0.5 + c.ax * Math.sin(t * c.sx + c.ph));
        const y = h * (0.5 + c.ay * Math.cos(t * c.sy + c.ph * 0.7));
        const r = m * c.r;
        const g = ctx!.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, `hsla(${c.hue}, 80%, 58%, ${0.16 + energy * 0.12})`);
        g.addColorStop(1, `hsla(${c.hue}, 80%, 30%, 0)`);
        ctx!.fillStyle = g;
        ctx!.fillRect(0, 0, w, h);
      }
      for (const s of stars) {
        const a = 0.25 + 0.5 * (0.5 + 0.5 * Math.sin(t * 0.002 + s.tw));
        ctx!.fillStyle = `rgba(255,255,255,${a * 0.6})`;
        ctx!.fillRect(s.x * w, s.y * h, s.s * (m / 260), s.s * (m / 260));
      }

      // The orb: dark core, rim light from the upper left, a hue that drifts with the clouds.
      ctx!.globalCompositeOperation = "source-over";
      const cx = w * 0.5;
      const cy = h * 0.52 + Math.sin(t * 0.0006) * m * 0.012;
      const R = m * size * (1 + energy * 0.06 * Math.sin(t * 0.004));
      const hue = hues[0] + Math.sin(t * 0.00025) * 30;
      const halo = ctx!.createRadialGradient(cx, cy, R * 0.8, cx, cy, R * 2.4);
      halo.addColorStop(0, `hsla(${hue}, 90%, 70%, ${0.22 + energy * 0.2})`);
      halo.addColorStop(1, "hsla(0,0%,0%,0)");
      ctx!.fillStyle = halo;
      ctx!.beginPath();
      ctx!.arc(cx, cy, R * 2.4, 0, Math.PI * 2);
      ctx!.fill();
      const body = ctx!.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.05, cx, cy, R);
      body.addColorStop(0, `hsla(${hue + 20}, 95%, 88%, 1)`);
      body.addColorStop(0.35, `hsla(${hue}, 80%, 62%, 1)`);
      body.addColorStop(0.8, `hsla(${hue - 20}, 70%, 28%, 1)`);
      body.addColorStop(1, `hsla(${hue - 30}, 70%, 14%, 1)`);
      ctx!.fillStyle = body;
      ctx!.beginPath();
      ctx!.arc(cx, cy, R, 0, Math.PI * 2);
      ctx!.fill();
    }

    function frame(t: number) {
      if (!visible || document.hidden) {
        running = false;
        return;
      }
      // ~30 fps is plenty for a drifting nebula and halves the battery cost on a phone.
      if (t - last > 33) {
        draw(t);
        last = t;
      }
      raf = requestAnimationFrame(frame);
    }

    draw(performance.now());
    start();
    const onVis = () => start();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [energy, hues, size]);

  return <canvas ref={ref} className={className} aria-hidden />;
}
