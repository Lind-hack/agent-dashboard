"use client";

import { useEffect, useRef } from "react";

// The OS's signature: a slowly turning sphere of points with constellation lines between near
// neighbours, drawn on a canvas. It is also a status light: `energy` (0–1) speeds it up and brightens
// it while agents work, and `tints` mixes in the colours of the agents that are working. ~30 fps,
// paused offscreen and in background tabs, one still frame under reduced motion.

type Props = { className?: string; energy?: number; tints?: string[]; density?: number; label?: string };

const HUD: [number, number, number] = [169, 228, 245];

function parse(c: string): [number, number, number] {
  const m = c.match(/^#([0-9a-f]{6})$/i);
  if (!m) return HUD;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function Core({ className, energy = 0.25, tints = [], density = 1, label }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const live = useRef({ energy, tints });
  live.current = { energy, tints };
  const redraw = useRef<() => void>(() => {});
  const tintKey = tints.join(",");
  // A paused canvas (reduced motion, offscreen) still has to show a status change.
  useEffect(() => redraw.current(), [energy, tintKey]);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // Fibonacci sphere, slightly jittered so it reads as organic, plus precomputed neighbour pairs.
    const n = Math.round(420 * density);
    const pts: { x: number; y: number; z: number; tint: number; tw: number }[] = [];
    for (let i = 0; i < n; i++) {
      const y = 1 - (i / (n - 1)) * 2;
      const r = Math.sqrt(1 - y * y);
      const t = i * 2.399963229728653;
      const j = 1 + (Math.sin(i * 12.9898) * 43758.5453 % 1) * 0.06;
      pts.push({ x: Math.cos(t) * r * j, y: y * j, z: Math.sin(t) * r * j, tint: i % 7, tw: (i * 0.618) % 1 });
    }
    const pairs: [number, number][] = [];
    const max = 0.22 / Math.sqrt(density);
    for (let a = 0; a < n; a++) {
      for (let b = a + 1; b < n; b++) {
        const dx = pts[a].x - pts[b].x;
        const dy = pts[a].y - pts[b].y;
        const dz = pts[a].z - pts[b].z;
        if (dx * dx + dy * dy + dz * dz < max * max) pairs.push([a, b]);
      }
    }

    let raf = 0;
    let last = 0;
    let angle = 0.6;
    let visible = true;
    let running = false;
    let w = 0;
    let h = 0;
    const proj = new Float32Array(n * 3);

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const r = canvas.getBoundingClientRect();
      w = Math.max(1, Math.round(r.width * dpr));
      h = Math.max(1, Math.round(r.height * dpr));
      canvas.width = w;
      canvas.height = h;
      draw(performance.now(), 0);
    };

    function draw(now: number, dt: number) {
      const { energy: e, tints: tl } = live.current;
      const colors = [HUD, ...tl.map(parse)];
      angle += dt * (0.00008 + e * 0.00028);
      const tilt = 0.38;
      const R = Math.min(w, h) * 0.36;
      const cx = w / 2;
      const cy = h / 2;
      const ca = Math.cos(angle);
      const sa = Math.sin(angle);
      const ct = Math.cos(tilt);
      const st = Math.sin(tilt);
      for (let i = 0; i < n; i++) {
        const p = pts[i];
        const x = p.x * ca - p.z * sa;
        const z0 = p.x * sa + p.z * ca;
        const y = p.y * ct - z0 * st;
        const z = p.y * st + z0 * ct;
        const persp = 1 / (1.9 - z * 0.55);
        proj[i * 3] = cx + x * R * persp * 1.6;
        proj[i * 3 + 1] = cy + y * R * persp * 1.6;
        proj[i * 3 + 2] = z;
      }
      ctx!.clearRect(0, 0, w, h);

      // Halo behind the sphere.
      const glow = ctx!.createRadialGradient(cx, cy, R * 0.1, cx, cy, R * 1.6);
      const [hr, hg, hb] = colors[colors.length > 1 ? 1 : 0];
      glow.addColorStop(0, `rgba(${hr},${hg},${hb},${0.1 + e * 0.12})`);
      glow.addColorStop(1, "rgba(0,0,0,0)");
      ctx!.fillStyle = glow;
      ctx!.fillRect(0, 0, w, h);

      ctx!.lineWidth = Math.max(0.6, w / 900);
      for (const [a, b] of pairs) {
        const za = proj[a * 3 + 2];
        const zb = proj[b * 3 + 2];
        const depth = (za + zb) / 2;
        if (depth < -0.35) continue;
        const [r, g, bl] = colors[pts[a].tint % colors.length];
        ctx!.strokeStyle = `rgba(${r},${g},${bl},${(0.05 + (depth + 1) * 0.09) * (0.7 + e * 0.6)})`;
        ctx!.beginPath();
        ctx!.moveTo(proj[a * 3], proj[a * 3 + 1]);
        ctx!.lineTo(proj[b * 3], proj[b * 3 + 1]);
        ctx!.stroke();
      }
      const dot = Math.max(1, w / 420);
      for (let i = 0; i < n; i++) {
        const z = proj[i * 3 + 2];
        const [r, g, bl] = colors[pts[i].tint % colors.length];
        const twinkle = reduced ? 1 : 0.75 + 0.25 * Math.sin(now * 0.002 + pts[i].tw * 40);
        ctx!.fillStyle = `rgba(${r},${g},${bl},${Math.min(1, (0.3 + (z + 1) * 0.42) * twinkle * (0.85 + e * 0.3))})`;
        const s = dot * (0.7 + (z + 1) * 0.65);
        ctx!.fillRect(proj[i * 3] - s / 2, proj[i * 3 + 1] - s / 2, s, s);
      }
    }

    function frame(now: number) {
      if (!running) return;
      const dt = last ? Math.min(now - last, 100) : 16;
      if (now - last >= 33) {
        draw(now, dt);
        last = now;
      }
      raf = requestAnimationFrame(frame);
    }
    const start = () => {
      if (running || reduced || !visible || document.hidden) return;
      running = true;
      last = 0;
      raf = requestAnimationFrame(frame);
    };
    const stop = () => {
      running = false;
      cancelAnimationFrame(raf);
    };

    redraw.current = () => {
      if (!running) draw(performance.now(), 0);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) start();
      else stop();
    });
    io.observe(canvas);
    const onVis = () => (document.hidden ? stop() : start());
    document.addEventListener("visibilitychange", onVis);
    resize();
    start();
    return () => {
      stop();
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [density]);

  return <canvas ref={ref} className={className} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true} />;
}
