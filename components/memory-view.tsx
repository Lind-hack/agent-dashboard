"use client";

import { ArrowUpRight, Brain, CircleDot, Clock3, FileText, ListTodo, Mail, MessageSquare, NotebookPen, RefreshCw, Search, Sparkles } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { LibraryItem, Section } from "@/lib/library";
import type { GraphGroup, GraphNode, MemoryAnswer, MemoryStats, SourceKind } from "@/lib/memory";
import { ago, cn } from "@/lib/utils";
import { Panel, SectionTitle } from "./kit";
import { Md } from "./md";
import { CaptureDock } from "./memory-capture";
import { KIND_COLOR, MemoryGraph } from "./memory-graph";
import { Library } from "./memory-library";
import { CountUp, SectionHero } from "./motion";
import { ReplyBar } from "./reply-bar";

const KINDS: { kind: SourceKind; label: string; sub: string; icon: typeof Brain }[] = [
  { kind: "capture", label: "Your captures", sub: "notes, voice, photos, video", icon: Sparkles },
  { kind: "chat", label: "Agent chats", sub: "Claude · Codex · OpenCode · Hermes", icon: MessageSquare },
  { kind: "obsidian", label: "Obsidian", sub: "lind-brain vault", icon: NotebookPen },
  { kind: "notes", label: "Claude notes", sub: "memory synced from the PC", icon: FileText },
  { kind: "linear", label: "Linear", sub: "recent issues", icon: ListTodo },
  { kind: "mail", label: "Email", sub: "last 7 days of Gmail", icon: Mail },
];
const META = Object.fromEntries(KINDS.map((k) => [k.kind, k])) as Record<SourceKind, (typeof KINDS)[number]>;

type Asked = MemoryAnswer & { q: string };
type Graph = { nodes: GraphNode[]; groups: GraphGroup[] };

export function MemoryView({ stats, items: initialItems, sections: initialSections }: { stats: MemoryStats; items: LibraryItem[]; sections: Section[] }) {
  const router = useRouter();
  const params = useSearchParams();
  const [items, setItems] = useState(initialItems);
  const [sections, setSections] = useState(initialSections);
  const [graph, setGraph] = useState<Graph | null>(null);
  const [enabled, setEnabled] = useState(stats.enabled);
  const [view, setView] = useState<"rings" | "timeline">("rings");
  const [query, setQuery] = useState("");
  const [asked, setAsked] = useState<Asked | null>(null);
  const [thinking, setThinking] = useState("");
  const [refreshed, setRefreshed] = useState<string | null>(null);
  const answer = useRef<HTMLDivElement>(null);
  const total = Object.values(stats.counts).reduce((a, b) => a + b, 0);

  const loadGraph = useCallback(async () => {
    const g = await fetch("/api/memory/graph", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    if (g?.nodes) setGraph(g);
  }, []);
  useEffect(() => {
    void loadGraph();
  }, [loadGraph]);

  // While the automation is reading something, check back every few seconds; when it lands, the
  // graph picks it up too.
  const pending = items.some((i) => i.status === "queued" || i.status === "processing");
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(async () => {
      const b = await fetch("/api/memory/items", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
      if (!b?.items) return;
      setItems(b.items);
      setSections(b.sections);
      if (!b.items.some((i: LibraryItem) => i.status === "queued" || i.status === "processing")) void loadGraph();
    }, 3000);
    return () => clearInterval(t);
  }, [pending, loadGraph]);

  useEffect(() => {
    if (asked) answer.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [asked]);

  const latest = useRef("");
  async function ask(q: string) {
    latest.current = q;
    setThinking(q);
    try {
      const res = await fetch("/api/memory/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ q }) });
      const body = await res.json().catch(() => null);
      if (!res.ok || typeof body?.answer !== "string") throw new Error(body?.error ?? `error ${res.status}`);
      if (latest.current === q) setAsked({ q, answer: body.answer, sources: body.sources ?? [] });
    } finally {
      if (latest.current === q) setThinking("");
    }
  }

  // "/remember …" still works from the ask bar.
  async function send(q: string): Promise<string | void> {
    if (/^\/remember\b/i.test(q)) {
      const text = q.replace(/^\/remember\s*/i, "").trim();
      if (!text) throw new Error("Write what to remember after /remember.");
      const res = await fetch("/api/memory/items", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.item) throw new Error(body?.error ?? `error ${res.status}`);
      setItems((x) => [body.item, ...x]);
      return "Remembered — filing it now";
    }
    return ask(q);
  }

  const urlQ = params.get("q")?.trim() ?? "";
  useEffect(() => {
    if (urlQ) void ask(urlQ).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlQ]);

  async function toggle(kind: SourceKind) {
    const on = !enabled[kind];
    setEnabled((e) => ({ ...e, [kind]: on }));
    const ok = await fetch("/api/memory/sources", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, on }) })
      .then((r) => r.ok)
      .catch(() => false);
    if (!ok) setEnabled((e) => ({ ...e, [kind]: !on }));
  }

  async function refreshAll() {
    setRefreshed("…");
    await fetch("/api/memory/sources", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refresh: true }) }).catch(() => null);
    await loadGraph();
    router.refresh();
    setRefreshed(new Date().toISOString());
  }

  // Answer sources light their dots in the graph (matched by link, or by title when there's none).
  const lit = new Set((asked?.sources ?? []).flatMap((s) => [s.href ?? "", `t:${s.title}`].filter(Boolean)));
  const visibleNodes = graph?.nodes.filter((n) => enabled[n.kind]) ?? [];
  const captures = items.length;

  return (
    <>
      <SectionHero
        clip="memory"
        eyebrow="Visual cortex · memory"
        title="Memory"
        sub="Your knowledge, connected. Throw anything at it — the Core reads it, files it, and you can ask about it later, by text or voice."
        right={
          <dl className="flex gap-6 text-right">
            {[
              ["records", total],
              ["captured", captures],
              ["sections", sections.length],
            ].map(([k, v]) => (
              <div key={k as string}>
                <dd className="text-2xl font-semibold tracking-[-0.03em]">
                  <CountUp value={v as number} />
                </dd>
                <dt className="hud-label !text-[9.5px]">{k}</dt>
              </div>
            ))}
          </dl>
        }
      />

      <CaptureDock onAdded={(it) => setItems((x) => [it, ...x.filter((y) => y.id !== it.id)])} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <Panel className="overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5 sm:px-4">
            <span className="flex items-center gap-2 text-sm font-medium">
              <CircleDot className="h-3.5 w-3.5 text-hermes" /> Visual cortex
            </span>
            <div className="flex rounded-[10px] border border-line p-0.5 text-[12.5px]" role="tablist" aria-label="Graph view">
              {(
                [
                  ["rings", "Rings", CircleDot],
                  ["timeline", "Timeline", Clock3],
                ] as const
              ).map(([k, l, Icon]) => (
                <button key={k} role="tab" aria-selected={view === k} onClick={() => setView(k)} className={cn("flex h-7 items-center gap-1.5 rounded-[8px] px-2.5 transition-colors", view === k ? "bg-white/[0.09] text-text" : "text-muted hover:text-text")}>
                  <Icon className="h-3.5 w-3.5" /> {l}
                </button>
              ))}
            </div>
            <form
              className="order-last flex h-9 w-full items-center gap-2 rounded-[10px] border border-line bg-black/30 px-3 focus-within:border-line-hi sm:order-none sm:ml-auto sm:w-64"
              onSubmit={(e) => {
                e.preventDefault();
                if (query.trim()) void ask(query.trim()).catch(() => {});
              }}
            >
              <Search className="h-3.5 w-3.5 shrink-0 text-faint" aria-hidden />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a memory… (Enter to ask)" aria-label="Find a memory" className="bare-field min-w-0 flex-1 bg-transparent text-[13px] placeholder:text-faint focus:outline-none" />
            </form>
            <span className="tnum hidden font-mono text-[11px] text-faint xl:inline">{visibleNodes.length.toLocaleString("en")} nodes</span>
          </div>
          <div className="relative">
            {view === "rings" ? (
              graph ? (
                <MemoryGraph nodes={visibleNodes} groups={graph.groups} query={query} lit={lit} total={visibleNodes.length} />
              ) : (
                <div className="grid h-[min(78vw,560px)] min-h-[340px] place-items-center text-sm text-faint">Mapping your memory…</div>
              )
            ) : (
              <div className="p-5">
                <p className="text-xs text-muted">Last 12 weeks · what was written, by source</p>
                <Timeline stats={stats} asked={asked} />
              </div>
            )}
            {view === "rings" && (
              <ul className="flex flex-wrap gap-x-5 gap-y-1 border-t border-line px-4 py-2.5 text-[11.5px]">
                {KINDS.filter((k) => stats.counts[k.kind] > 0).map((k) => (
                  <li key={k.kind} className={cn("flex items-center gap-2", !enabled[k.kind] && "opacity-35")}>
                    <span className="h-2 w-2 rounded-full" style={{ background: KIND_COLOR[k.kind] }} />
                    <span className="text-muted">{k.label}</span>
                    <span className="tnum ml-auto text-text">{stats.counts[k.kind].toLocaleString("en")}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Panel>

        <Panel className="flex flex-col p-4">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-medium">Memory sources</p>
            <p className="text-[11px] text-faint">searched when on</p>
          </div>
          <ul className="flex flex-col">
            {KINDS.map((k) => {
              const Icon = k.icon;
              return (
                <li key={k.kind} className="flex items-center gap-3 border-b border-line py-2.5 last:border-0">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[11px]" style={{ background: `color-mix(in oklab, ${KIND_COLOR[k.kind]}, transparent 82%)` }}>
                    <Icon className="h-4 w-4" style={{ color: KIND_COLOR[k.kind] }} strokeWidth={1.75} />
                  </span>
                  <span className="min-w-0 flex-1 leading-tight">
                    <span className="block truncate text-[13.5px]">{k.label}</span>
                    <span className="block truncate text-[11px] text-faint">{stats.counts[k.kind] ? `${stats.counts[k.kind].toLocaleString("en")} · ${k.sub}` : k.kind === "mail" ? "connect Gmail on the Inbox" : k.sub}</span>
                  </span>
                  <button role="switch" aria-checked={enabled[k.kind]} aria-label={`Search ${k.label}`} onClick={() => void toggle(k.kind)} className="switch" style={{ ["--sw" as string]: KIND_COLOR[k.kind] }} />
                </li>
              );
            })}
          </ul>
          <button onClick={() => void refreshAll()} className="press mt-4 flex h-10 items-center justify-center gap-2 rounded-[12px] bg-[linear-gradient(90deg,#e879c9,#f0a3c8)] text-sm font-medium text-[#1a0a16] shadow-[0_10px_30px_-12px_rgb(232_121_201/0.7)]">
            <RefreshCw className={cn("h-4 w-4", refreshed === "…" && "animate-spin")} /> Refresh all
          </button>
          <p className="mt-2 text-center text-[11px] text-faint">{refreshed && refreshed !== "…" ? `Updated ${ago(refreshed)}` : !stats.vault ? "The Obsidian vault isn't readable on the VPS yet." : "Rebuilds the index from every source"}</p>
        </Panel>
      </div>

      <div ref={answer} className="scroll-mt-20">
        {thinking && (
          <Panel className="shimmer mt-6 p-5">
            <p className="text-sm text-muted">{thinking}</p>
            <p className="mt-2 text-xs text-faint">Searching {KINDS.filter((k) => enabled[k.kind]).map((k) => k.label.toLowerCase()).join(", ")}…</p>
          </Panel>
        )}
        {asked && !thinking && (
          <section className="rise mt-6">
            <Panel className="p-5">
              <p className="mb-3 text-sm text-muted">{asked.q}</p>
              <div className="text-[15px] leading-relaxed">
                <Md text={asked.answer} />
              </div>
            </Panel>
            {asked.sources.length > 0 && (
              <div className="mt-5">
                <SectionTitle right={`${asked.sources.length} found`}>Sources</SectionTitle>
                <Panel className="stagger overflow-hidden">
                  {asked.sources.map((s) => {
                    const m = META[s.kind] ?? META.capture;
                    const inner = (
                      <>
                        <span className="tnum w-6 shrink-0 pt-0.5 text-right text-xs" style={{ color: KIND_COLOR[s.kind] }}>
                          {s.n}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-baseline gap-2">
                            <span className="truncate text-[15px]">{s.title}</span>
                            {s.href && <ArrowUpRight className="h-3.5 w-3.5 shrink-0 self-center text-faint" aria-hidden />}
                          </span>
                          <span className="mt-0.5 block text-xs text-faint">
                            <span style={{ color: KIND_COLOR[s.kind] }}>{m.label}</span> · {ago(s.at)}
                          </span>
                          <span className="mt-1.5 line-clamp-3 block text-[13px] leading-relaxed text-muted">{s.snippet}</span>
                        </span>
                      </>
                    );
                    const row = "flex gap-3 border-b border-line px-4 py-3.5 last:border-0";
                    return s.href ? (
                      <a key={s.n} href={s.href} target={s.href.startsWith("/") ? undefined : "_blank"} rel="noreferrer" className={cn(row, "hover:bg-white/[0.02]")}>
                        {inner}
                      </a>
                    ) : (
                      <div key={s.n} className={row}>
                        {inner}
                      </div>
                    );
                  })}
                </Panel>
              </div>
            )}
          </section>
        )}
      </div>

      <Library
        items={items}
        sections={sections}
        focus={params.get("item")}
        onSections={setSections}
        onChange={(it) => {
          setItems((x) => ("deleted" in it ? x.filter((y) => y.id !== it.id) : x.map((y) => (y.id === it.id ? it : y))));
          void loadGraph();
        }}
      />

      <div className="h-28" aria-hidden />
      <ReplyBar placeholder="Ask your memory anything — or /remember …" onSend={send} />
    </>
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
    <div className="mt-4 flex flex-col">
      <div className="flex h-72 items-end gap-1.5">
        {stats.weeks.map((w, i) => {
          const sum = Object.values(w.counts).reduce((a, b) => a + b, 0);
          const hit = hitWeeks.get(i);
          return (
            <div key={w.start} className="relative flex h-full min-w-0 flex-1 flex-col justify-end" title={`Week of ${label(w.start)}: ${sum}`}>
              {hit && <span className="absolute -top-1 left-1/2 h-2 w-2 -translate-x-1/2 rounded-full" style={{ background: KIND_COLOR[hit], boxShadow: `0 0 8px ${KIND_COLOR[hit]}` }} />}
              <div className="flex origin-bottom animate-[grow_700ms_var(--ease-out-expo)_both] flex-col-reverse overflow-hidden rounded-md motion-reduce:animate-none" style={{ height: `${Math.max(sum ? 6 : 2, (sum / max) * 92)}%`, animationDelay: `${i * 40}ms` }}>
                {sum === 0 ? (
                  <span className="h-full bg-white/[0.06]" />
                ) : (
                  KINDS.map((k) => (w.counts[k.kind] ? <span key={k.kind} style={{ flexGrow: w.counts[k.kind], background: KIND_COLOR[k.kind], opacity: asked && !hitWeeks.has(i) ? 0.35 : 0.85 }} /> : null))
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
