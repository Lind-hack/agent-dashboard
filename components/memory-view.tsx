"use client";

import { ArrowUpRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { MemoryAnswer, MemoryStats, SourceKind } from "@/lib/memory";
import { ago, cn } from "@/lib/utils";
import { Panel, SectionTitle } from "./kit";
import { Md } from "./md";
import { ReplyBar } from "./reply-bar";

const KINDS: { kind: SourceKind; label: string; color: string; text: string }[] = [
  { kind: "chat", label: "Agent chats", color: "var(--color-claude)", text: "text-claude" },
  { kind: "linear", label: "Linear", color: "var(--color-codex)", text: "text-codex" },
  { kind: "obsidian", label: "Obsidian", color: "var(--color-hermes)", text: "text-hermes" },
  { kind: "notes", label: "Memory notes", color: "var(--color-opencode)", text: "text-opencode" },
];
const META = Object.fromEntries(KINDS.map((k) => [k.kind, k])) as Record<SourceKind, (typeof KINDS)[number]>;

type Asked = MemoryAnswer & { q: string };

export function MemoryView({ stats }: { stats: MemoryStats }) {
  const [asked, setAsked] = useState<Asked | null>(null);
  const [thinking, setThinking] = useState("");
  const answer = useRef<HTMLDivElement>(null);
  const lit = asked ? new Set(asked.sources.map((s) => s.kind)) : null;

  useEffect(() => {
    if (asked) answer.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [asked]);

  async function ask(q: string) {
    setThinking(q);
    try {
      const res = await fetch("/api/memory/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ q }) });
      const body = await res.json().catch(() => null);
      if (!res.ok || typeof body?.answer !== "string") throw new Error(body?.error ?? `error ${res.status}`);
      setAsked({ q, answer: body.answer, sources: body.sources ?? [] });
    } finally {
      setThinking("");
    }
  }

  // /memory?q=… (from the command palette) asks straight away.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("q")?.trim();
    if (q) void ask(q).catch(() => {});
    // Runs once on arrival; later questions come from the reply bar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <div className="grid gap-4 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <Panel className="flex flex-col items-center p-5">
          <Ring stats={stats} lit={lit} busy={!!thinking} />
          <ul className="mt-5 grid w-full grid-cols-2 gap-x-4 gap-y-2 text-sm">
            {KINDS.map((k) => (
              <li key={k.kind} className={cn("flex items-center gap-2 transition-opacity duration-500", lit && !lit.has(k.kind) && "opacity-35")}>
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: k.color }} />
                <span className="truncate text-muted">{k.label}</span>
                <span className="tnum ml-auto text-text">{stats.counts[k.kind]}</span>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel className="flex flex-col p-5">
          <p className="text-xs text-muted">Last 12 weeks · what was written, by source</p>
          <Timeline stats={stats} asked={asked} />
        </Panel>
      </div>

      {(!stats.vault || stats.counts.notes === 0) && (
        <p className="mt-4 px-1 text-xs leading-relaxed text-faint">
          {!stats.vault && "The Obsidian vault isn't readable on the VPS yet. "}
          {stats.counts.notes === 0 && "No memory notes synced yet — run node handoff/sync-notes.mjs on the PC."}
        </p>
      )}

      <div ref={answer} className="scroll-mt-20">
        {thinking && (
          <Panel className="rise mt-8 p-5">
            <p className="text-sm text-muted">{thinking}</p>
            <p className="mt-2 text-xs text-faint">Searching chats, Linear, Obsidian and notes…</p>
          </Panel>
        )}
        {asked && !thinking && (
          <section className="rise mt-8">
            <Panel className="p-5">
              <p className="mb-3 text-sm text-muted">{asked.q}</p>
              <div className="text-[15px] leading-relaxed">
                <Md text={asked.answer} />
              </div>
            </Panel>
            {asked.sources.length > 0 && (
              <div className="mt-6">
                <SectionTitle right={`${asked.sources.length} found`}>Sources</SectionTitle>
                <Panel className="overflow-hidden">
                  <ol>
                    {asked.sources.map((s) => {
                      const m = META[s.kind];
                      const inner = (
                        <>
                          <span className={cn("tnum w-6 shrink-0 pt-0.5 text-right text-xs", m.text)}>{s.n}</span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-baseline gap-2">
                              <span className="truncate text-[15px]">{s.title}</span>
                              {s.href && <ArrowUpRight className="h-3.5 w-3.5 shrink-0 self-center text-faint" aria-hidden />}
                            </span>
                            <span className="mt-0.5 block text-xs text-faint">
                              <span className={m.text}>{m.label}</span> · {ago(s.at)}
                            </span>
                            <span className="mt-1.5 line-clamp-3 block text-[13px] leading-relaxed text-muted">{s.snippet}</span>
                          </span>
                        </>
                      );
                      const row = "flex gap-3 border-b border-line px-4 py-3.5 last:border-0";
                      return (
                        <li key={s.n}>
                          {s.href ? (
                            <a href={s.href} target={s.href.startsWith("/") ? undefined : "_blank"} rel="noreferrer" className={cn(row, "hover:bg-white/[0.02]")}>
                              {inner}
                            </a>
                          ) : (
                            <div className={row}>{inner}</div>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                </Panel>
              </div>
            )}
          </section>
        )}
      </div>

      <div className="h-28" aria-hidden />
      <ReplyBar placeholder="Ask your memory — “what did we decide about the Bota index?”" onSend={ask} />
    </>
  );
}

// The memory ring: each source's share of everything indexed. While searching it turns; after an
// answer, the sources that supplied it stay lit and the rest dim.
function Ring({ stats, lit, busy }: { stats: MemoryStats; lit: Set<SourceKind> | null; busy: boolean }) {
  const count = Object.values(stats.counts).reduce((a, b) => a + b, 0);
  const total = Math.max(1, count);
  const r = 84;
  const C = 2 * Math.PI * r;
  const gap = 6;
  let offset = 0;
  const arcs = KINDS.filter((k) => stats.counts[k.kind] > 0).map((k) => {
    const len = Math.max(2, (stats.counts[k.kind] / total) * C - gap);
    const arc = { ...k, len, offset };
    offset += len + gap;
    return arc;
  });
  return (
    <div className="relative grid aspect-square w-full max-w-[240px] place-items-center">
      <svg viewBox="0 0 200 200" className={cn("absolute inset-0 h-full w-full -rotate-90", busy && "animate-[spin_2.4s_linear_infinite] motion-reduce:animate-none")} aria-hidden>
        <circle cx="100" cy="100" r={r} fill="none" stroke="rgb(255 255 255 / 0.05)" strokeWidth="14" />
        <circle cx="100" cy="100" r={r - 18} fill="none" stroke="rgb(255 255 255 / 0.04)" strokeWidth="1" strokeDasharray="2 5" />
        {arcs.map((a) => (
          <circle
            key={a.kind}
            cx="100"
            cy="100"
            r={r}
            fill="none"
            stroke={a.color}
            strokeWidth="14"
            strokeLinecap="round"
            strokeDasharray={`${a.len} ${C}`}
            strokeDashoffset={-a.offset}
            className="transition-opacity duration-500"
            style={{ opacity: lit && !lit.has(a.kind) ? 0.18 : 1, filter: lit?.has(a.kind) ? `drop-shadow(0 0 6px ${a.color})` : undefined }}
          />
        ))}
      </svg>
      <div className="text-center">
        <p className="tnum text-4xl font-semibold tracking-[-0.04em]">{count.toLocaleString("en")}</p>
        <p className="mt-0.5 text-xs text-muted">{busy ? "searching…" : lit ? `${lit.size} source${lit.size === 1 ? "" : "s"} used` : "memories"}</p>
      </div>
    </div>
  );
}

// Stacked weekly bars. After an answer, a marker sits on each week a cited source comes from.
function Timeline({ stats, asked }: { stats: MemoryStats; asked: Asked | null }) {
  const max = Math.max(1, ...stats.weeks.map((w) => Object.values(w.counts).reduce((a, b) => a + b, 0)));
  const first = Date.parse(stats.weeks[0]?.start ?? "");
  const hitWeeks = new Map<number, SourceKind>();
  for (const s of asked?.sources ?? []) {
    const w = Math.floor((Date.parse(s.at) - first) / (7 * 86_400_000));
    if (w >= 0 && w < stats.weeks.length && !hitWeeks.has(w)) hitWeeks.set(w, s.kind);
  }
  const label = (d: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${d}T12:00:00Z`));
  return (
    <div className="mt-4 flex flex-1 flex-col">
      <div className="flex min-h-40 flex-1 items-end gap-1.5">
        {stats.weeks.map((w, i) => {
          const sum = Object.values(w.counts).reduce((a, b) => a + b, 0);
          const hit = hitWeeks.get(i);
          return (
            <div key={w.start} className="relative flex h-full min-w-0 flex-1 flex-col justify-end" title={`Week of ${label(w.start)}: ${sum}`}>
              {hit && <span className="absolute -top-1 left-1/2 h-2 w-2 -translate-x-1/2 rounded-full" style={{ background: META[hit].color, boxShadow: `0 0 8px ${META[hit].color}` }} />}
              <div className="flex flex-col-reverse overflow-hidden rounded-md" style={{ height: `${Math.max(sum ? 6 : 2, (sum / max) * 85)}%` }}>
                {sum === 0 ? (
                  <span className="h-full bg-white/[0.06]" />
                ) : (
                  KINDS.map((k) => (w.counts[k.kind] ? <span key={k.kind} style={{ flexGrow: w.counts[k.kind], background: k.color, opacity: asked && !hitWeeks.has(i) ? 0.35 : 0.85 }} /> : null))
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex justify-between text-[11px] text-faint">
        <span>{stats.weeks[0] && label(stats.weeks[0].start)}</span>
        <span>this week</span>
      </div>
    </div>
  );
}
