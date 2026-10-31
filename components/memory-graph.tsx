"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { GraphEntity, GraphGroup, GraphNode, SourceKind } from "@/lib/memory";
import { cn } from "@/lib/utils";
import { ago } from "@/lib/utils";

// The Visual cortex: every record Memory knows as one dot. Wedges are sections of the Library, mail
// piles and the other sources; within a wedge, newer records sit further out. Typing in the search
// lights the matching dots and draws them back to the core; answers light the records they cite.
// v5: the projects, people and topics records share sit on an inner ring as hubs, with faint threads
// to every record that mentions them; hover a record to see its threads, pick a hub to light its web.

export const KIND_COLOR: Record<SourceKind, string> = {
  capture: "#b392f0",
  chat: "#e2825f",
  linear: "#7c98ff",
  obsidian: "#9f7aea",
  notes: "#5fd3a6",
  mail: "#f472b6",
  pcchat: "#f6b25e",
  github: "#9ca3af",
  calendar: "#38bdf8",
  web: "#34d399",
};

const HUB_COLOR: Record<GraphEntity["type"], string> = { project: "#f6b25e", person: "#5fd3a6", topic: "#d6c8ff" };

export const groupColor = (g: GraphGroup | undefined, kind: SourceKind) => (g?.hue !== undefined ? `hsl(${g.hue} 78% 70%)` : KIND_COLOR[kind]);

type Placed = GraphNode & { a: number; r: number; color: string; hit: boolean; lit: boolean; k: number };
type Hub = GraphEntity & { a: number; r: number; color: string; docs: Placed[] };

const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10000) / 10000;
};
const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

export function MemoryGraph({ nodes, groups, entities = [], query, lit, total }: { nodes: GraphNode[]; groups: GraphGroup[]; entities?: GraphEntity[]; query: string; lit: Set<string>; total: number }) {
  const [focus, setFocus] = useState<number | null>(null);
  const [hoverEnts, setHoverEnts] = useState<number[]>([]);
  const canvas = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const [hover, setHover] = useState<{ n: Placed | Hub; x: number; y: number } | null>(null);
  const placedRef = useRef<Placed[]>([]);
  const hubsRef = useRef<Hub[]>([]);
  const geo = useRef({ cx: 0, cy: 0, r0: 0, r1: 0, rot: 0 });
  const [dims, setDims] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const box = wrap.current;
    if (!box) return;
    const ro = new ResizeObserver(() => setDims({ w: box.clientWidth, h: box.clientHeight }));
    ro.observe(box);
    return () => ro.disconnect();
  }, []);
  const ringR = Math.min(dims.w, dims.h) / 2 - (dims.w < 520 ? 34 : 70);

  // Wedges: share of the circle ~ sqrt(count) so a 1,000-page vault doesn't swallow a 5-item section.
  const layout = useMemo(() => {
    const byGroup = new Map<string, GraphNode[]>();
    for (const n of nodes) byGroup.set(n.group, [...(byGroup.get(n.group) ?? []), n]);
    const live = groups.filter((g) => byGroup.has(g.key));
    const weights = live.map((g) => Math.max(1.2, Math.sqrt(byGroup.get(g.key)!.length)));
    const sum = weights.reduce((a, b) => a + b, 0) || 1;
    const gap = live.length > 1 ? 0.05 : 0;
    const span = Math.PI * 2 - gap * live.length;
    let a = -Math.PI / 2;
    const wedges = live.map((g, i) => {
      const w = (weights[i] / sum) * span;
      const wedge = { g, start: a, end: a + w, count: byGroup.get(g.key)!.length };
      a += w + gap;
      return wedge;
    });
    const q = fold(query.trim());
    const terms = q.split(/\s+/).filter((t) => t.length > 1);
    const placed: Placed[] = [];
    for (const w of wedges) {
      const list = [...byGroup.get(w.g.key)!].sort((x, y) => x.at.localeCompare(y.at));
      list.forEach((n, i) => {
        const age = list.length > 1 ? i / (list.length - 1) : 1; // 0 oldest … 1 newest
        const pad = Math.min(0.03, (w.end - w.start) * 0.12);
        const title = fold(n.title);
        placed.push({
          ...n,
          a: w.start + pad + hash(n.id) * (w.end - w.start - pad * 2),
          r: 0.08 + 0.9 * (0.15 + 0.85 * Math.sqrt(age)) * (0.86 + 0.14 * hash(`${n.id}r`)),
          color: groupColor(w.g, n.kind),
          hit: (terms.length > 0 && terms.every((t) => title.includes(t))) || (focus !== null && !!n.ents?.includes(focus)),
          lit: lit.has(n.id) || (n.href ? lit.has(n.href) : false) || lit.has(`t:${n.title}`),
          k: hash(`${n.id}k`),
        });
      });
    }
    // Hubs sit just outside the core, at the average angle of the records that mention them.
    const byEnt = new Map<number, Placed[]>();
    for (const n of placed) for (const e of n.ents ?? []) byEnt.set(e, [...(byEnt.get(e) ?? []), n]);
    const hubs: Hub[] = entities
      .filter((e) => (byEnt.get(e.id)?.length ?? 0) >= 2)
      .map((e) => {
        const docs = byEnt.get(e.id)!;
        const a = Math.atan2(docs.reduce((s, d) => s + Math.sin(d.a), 0), docs.reduce((s, d) => s + Math.cos(d.a), 0));
        return { ...e, a, r: 0.035 + 0.11 * hash(`hub${e.id}`), color: HUB_COLOR[e.type], docs };
      });
    return { wedges, placed, hubs, searching: terms.length > 0 || focus !== null };
  }, [nodes, groups, entities, query, lit, focus]);

  useEffect(() => {
    const el = canvas.current;
    const box = wrap.current;
    if (!el || !box) return;
    const ctx = el.getContext("2d");
    if (!ctx) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const born = performance.now();
    let raf = 0;
    let visible = true;
    placedRef.current = layout.placed;
    hubsRef.current = layout.hubs;
    const hot = new Set(hoverEnts);

    const draw = (now: number) => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const W = box.clientWidth;
      const H = box.clientHeight;
      if (el.width !== Math.round(W * dpr) || el.height !== Math.round(H * dpr)) {
        el.width = Math.round(W * dpr);
        el.height = Math.round(H * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const cx = W / 2;
      const cy = H / 2;
      const R = Math.min(W, H) / 2 - (W < 520 ? 34 : 70);
      const r0 = Math.max(46, R * 0.2);
      const t = (now - born) / 1000;
      const rot = reduce ? 0 : t * 0.012;
      geo.current = { cx, cy, r0, r1: R, rot };
      const intro = reduce ? 1 : Math.min(1, t / 1.4);

      // Rings and ticks.
      ctx.lineWidth = 1;
      for (const [rr, a] of [
        [R + 10, 0.22],
        [R * 0.62, 0.05],
        [r0, 0.12],
      ] as const) {
        ctx.beginPath();
        ctx.arc(cx, cy, rr, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(214,190,255,${a})`;
        ctx.stroke();
      }
      const grad = ctx.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
      grad.addColorStop(0, "rgba(246,178,94,0.55)");
      grad.addColorStop(0.5, "rgba(179,146,240,0.35)");
      grad.addColorStop(1, "rgba(244,114,182,0.55)");
      ctx.beginPath();
      ctx.arc(cx, cy, R + 10, -Math.PI / 2 + rot, -Math.PI / 2 + rot + Math.PI * 2 * intro);
      ctx.strokeStyle = grad;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.lineWidth = 1;
      for (let i = 0; i < 120; i++) {
        const a = (i / 120) * Math.PI * 2 + rot;
        const long = i % 10 === 0;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * (R + 14), cy + Math.sin(a) * (R + 14));
        ctx.lineTo(cx + Math.cos(a) * (R + (long ? 22 : 17)), cy + Math.sin(a) * (R + (long ? 22 : 17)));
        ctx.strokeStyle = `rgba(214,190,255,${long ? 0.3 : 0.12})`;
        ctx.stroke();
      }

      // Lines from the core to search hits and cited records.
      const pos = (n: Placed) => {
        const k = reduce ? 1 : Math.min(1, Math.max(0, intro * 1.6 - n.k * 0.6));
        const e = 1 - Math.pow(1 - k, 3);
        const rr = r0 + (R - r0) * n.r * e;
        const a = n.a + rot;
        return [cx + Math.cos(a) * rr, cy + Math.sin(a) * rr] as const;
      };
      const marked = layout.placed.filter((n) => n.hit || n.lit);
      if (marked.length && marked.length < 400) {
        ctx.lineWidth = 0.6;
        for (const n of marked) {
          const [x, y] = pos(n);
          const g = ctx.createLinearGradient(cx, cy, x, y);
          g.addColorStop(0, "rgba(255,255,255,0)");
          g.addColorStop(1, n.lit ? "rgba(255,255,255,0.55)" : `${n.color}`);
          ctx.strokeStyle = g;
          ctx.globalAlpha = 0.5;
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.quadraticCurveTo(cx + (x - cx) * 0.5 + (y - cy) * 0.15, cy + (y - cy) * 0.5 - (x - cx) * 0.15, x, y);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }

      // Threads from each hub to the records that mention it: faint, lit for the picked/hovered hub.
      const hubPos = (h: Hub) => {
        const rr = r0 + (R - r0) * h.r * intro;
        return [cx + Math.cos(h.a + rot) * rr, cy + Math.sin(h.a + rot) * rr] as const;
      };
      let drawn = 0;
      for (const h of layout.hubs) {
        const on = focus === h.id || hot.has(h.id);
        if (!on && (drawn > 5000 || layout.searching)) continue;
        const [hx, hy] = hubPos(h);
        ctx.strokeStyle = h.color;
        ctx.lineWidth = on ? 0.9 : 0.5;
        ctx.globalAlpha = on ? 0.55 : 0.045;
        ctx.beginPath();
        for (const d of h.docs) {
          const [x, y] = pos(d);
          ctx.moveTo(hx, hy);
          ctx.lineTo(x, y);
          drawn++;
        }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // The dots.
      const dim = layout.searching || lit.size > 0;
      for (const n of layout.placed) {
        const [x, y] = pos(n);
        const on = n.hit || n.lit;
        const tw = reduce ? 1 : 0.75 + 0.25 * Math.sin(t * 2 + n.k * 40);
        ctx.globalAlpha = dim && !on ? 0.13 : (on ? 1 : 0.78) * tw;
        ctx.fillStyle = n.color;
        const size = on ? 2.6 + (n.lit && !reduce ? Math.sin(t * 5) * 0.8 : 0) : nodes.length > 2000 ? 1.25 : nodes.length > 300 ? 1.6 : 2.2;
        ctx.beginPath();
        ctx.arc(x, y, size, 0, Math.PI * 2);
        ctx.fill();
        if (on) {
          ctx.globalAlpha = 0.25;
          ctx.beginPath();
          ctx.arc(x, y, size * 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;

      // The hubs, with names on the biggest.
      const top = new Set(layout.hubs.slice().sort((a, z) => z.count - a.count).slice(0, W < 520 ? 6 : 14).map((h) => h.id));
      ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
      for (const h of layout.hubs) {
        const [hx, hy] = hubPos(h);
        const on = focus === h.id || hot.has(h.id);
        const size = 2.2 + Math.min(5, Math.sqrt(h.count) * 0.55);
        ctx.globalAlpha = focus !== null && !on ? 0.25 : 1;
        ctx.fillStyle = h.color;
        ctx.beginPath();
        ctx.arc(hx, hy, on ? size + 1.5 : size, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = (focus !== null && !on ? 0.1 : 0.22) * (on ? 2 : 1);
        ctx.beginPath();
        ctx.arc(hx, hy, size * 2.6, 0, Math.PI * 2);
        ctx.fill();
        if (on || (top.has(h.id) && focus === null)) {
          ctx.globalAlpha = on ? 1 : 0.7;
          ctx.fillStyle = "#ece6ff";
          const left = Math.cos(h.a + rot) < 0;
          ctx.textAlign = left ? "right" : "left";
          ctx.fillText(h.label.length > 22 ? `${h.label.slice(0, 21)}…` : h.label, hx + (left ? -size - 5 : size + 5), hy + 3);
        }
      }
      ctx.globalAlpha = 1;
      ctx.textAlign = "left";

      // The core: a hexagon with a soft glow.
      const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, r0 * 1.3);
      glow.addColorStop(0, "rgba(179,146,240,0.35)");
      glow.addColorStop(1, "rgba(179,146,240,0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(cx, cy, r0 * 1.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + Math.PI / 6 + rot * 2;
        const hx = cx + Math.cos(a) * r0 * 0.95;
        const hy = cy + Math.sin(a) * r0 * 0.95;
        if (i) ctx.lineTo(hx, hy);
        else ctx.moveTo(hx, hy);
      }
      ctx.closePath();
      ctx.fillStyle = "rgba(8,8,10,0.85)";
      ctx.fill();
      ctx.strokeStyle = "rgba(230,215,255,0.75)";
      ctx.lineWidth = 1.2;
      ctx.stroke();

      if (visible && !document.hidden && !reduce) raf = requestAnimationFrame(draw);
      else raf = 0;
    };
    const wake = () => {
      if (!raf) raf = requestAnimationFrame(draw);
    };
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      wake();
    });
    io.observe(el);
    const ro = new ResizeObserver(wake);
    ro.observe(box);
    document.addEventListener("visibilitychange", wake);
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      document.removeEventListener("visibilitychange", wake);
    };
  }, [layout, lit, focus, hoverEnts]);

  // The nearest dot (record or hub) to the pointer.
  function pick(clientX: number, clientY: number): { n: Placed | Hub; x: number; y: number } | null {
    const el = canvas.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const { cx, cy, r0, r1, rot } = geo.current;
    let best: Placed | Hub | null = null;
    let bd = 100;
    for (const h of hubsRef.current) {
      const rr = r0 + (r1 - r0) * h.r;
      const dx = cx + Math.cos(h.a + rot) * rr - x;
      const dy = cy + Math.sin(h.a + rot) * rr - y;
      const d = (dx * dx + dy * dy) * 0.6; // hubs are bigger targets
      if (d < bd) {
        bd = d;
        best = h;
      }
    }
    for (const n of placedRef.current) {
      const rr = r0 + (r1 - r0) * n.r;
      const dx = cx + Math.cos(n.a + rot) * rr - x;
      const dy = cy + Math.sin(n.a + rot) * rr - y;
      const d = dx * dx + dy * dy;
      if (d < bd) {
        bd = d;
        best = n;
      }
    }
    return best ? { n: best, x, y } : null;
  }

  const isHub = (n: Placed | Hub): n is Hub => "docs" in n;
  const open = (n: Placed | Hub) => {
    if (isHub(n)) {
      setFocus((f) => (f === n.id ? null : n.id));
      return;
    }
    if (!n.href) return;
    if (n.href.startsWith("/")) router.push(n.href);
    else window.open(n.href, "_blank", "noopener");
  };

  // Labels around the ring, at each wedge's middle.
  return (
    <div ref={wrap} className="relative h-[min(78vw,560px)] min-h-[340px] w-full select-none">
      <canvas
        ref={canvas}
        className="absolute inset-0 h-full w-full cursor-crosshair"
        onPointerMove={(e) => {
          const p = pick(e.clientX, e.clientY);
          setHover(p);
          const ents = p ? (isHub(p.n) ? [p.n.id] : (p.n.ents ?? [])) : [];
          setHoverEnts((old) => (old.join() === ents.join() ? old : ents));
        }}
        onPointerLeave={() => {
          setHover(null);
          setHoverEnts([]);
        }}
        onClick={(e) => {
          const p = pick(e.clientX, e.clientY);
          if (p) open(p.n);
        }}
        role="img"
        aria-label={`Memory graph: ${total.toLocaleString("en")} records in ${layout.wedges.length} groups`}
      />
      <div className="pointer-events-none absolute inset-0">
        {layout.wedges.map((w) => {
          const mid = (w.start + w.end) / 2;
          // Just outside the ring; labels on the left hang leftwards, on the right rightwards.
          const x = dims.w / 2 + Math.cos(mid) * (ringR + 34);
          const y = dims.h / 2 + Math.sin(mid) * (ringR + 30);
          const color = groupColor(w.g, w.g.kind);
          if (!dims.w || w.count < Math.max(1, nodes.length * 0.004)) return null;
          return (
            <span
              key={w.g.key}
              className="absolute hidden -translate-y-1/2 items-center gap-1.5 rounded-md bg-black/50 px-1.5 py-0.5 font-mono text-[10px] tracking-[0.08em] whitespace-nowrap text-text uppercase backdrop-blur-sm sm:flex"
              style={{ left: x, top: y, transform: `translate(${Math.cos(mid) < -0.2 ? "-100%" : Math.cos(mid) > 0.2 ? "0" : "-50%"}, -50%)` }}
            >
              <span className="h-2 w-2 rounded-[3px]" style={{ background: color }} />
              {w.g.label} <span className="text-muted">{w.count.toLocaleString("en")}</span>
            </span>
          );
        })}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-center">
          <p className="text-[12px] font-medium text-text">Memory core</p>
          <p className="tnum font-mono text-[10px] text-muted">{total.toLocaleString("en")} records</p>
        </div>
        {hover && (
          <div className="absolute z-10 max-w-[260px] rounded-[10px] border border-line-hi bg-bg-raised/95 px-3 py-2 text-xs shadow-xl backdrop-blur-md" style={{ left: Math.min(hover.x + 12, (wrap.current?.clientWidth ?? 300) - 270), top: hover.y + 12 }}>
            {isHub(hover.n) ? (
              <>
                <p className="text-[13px] text-text">{hover.n.label}</p>
                <p className="mt-0.5 text-faint">
                  <span style={{ color: hover.n.color }}>{hover.n.type}</span> · linked to {hover.n.count} records · click to {focus === hover.n.id ? "clear" : "light its web"}
                </p>
              </>
            ) : (
              <>
                <p className="line-clamp-2 text-[13px] text-text">{hover.n.title}</p>
                <p className="mt-0.5 text-faint">
                  <span style={{ color: hover.n.color }}>{hover.n.kind}</span> · {ago(hover.n.at)}
                  {hover.n.ents?.length ? ` · ${hover.n.ents.length} link${hover.n.ents.length > 1 ? "s" : ""}` : ""}
                  {hover.n.href ? " · click to open" : ""}
                </p>
              </>
            )}
          </div>
        )}
      </div>
      {layout.hubs.length > 0 && (
        <div className="absolute inset-x-0 bottom-0 flex gap-1.5 overflow-x-auto px-2 pb-1 [scrollbar-width:none]" role="toolbar" aria-label="Linked projects, people and topics">
          {layout.hubs
            .slice()
            .sort((a, z) => z.count - a.count)
            .slice(0, 24)
            .map((h) => (
              <button
                key={h.id}
                onClick={() => setFocus((f) => (f === h.id ? null : h.id))}
                aria-pressed={focus === h.id}
                className={cn("flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-[11.5px] whitespace-nowrap backdrop-blur-sm transition-colors", focus === h.id ? "border-white/40 bg-white/15 text-text" : "border-line bg-black/40 text-muted hover:text-text")}
              >
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: h.color }} />
                {h.label}
                <span className="tnum font-mono text-[10px] text-faint">{h.count}</span>
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
