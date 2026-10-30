"use client";

import { ArrowUpRight, Plus, Search, X } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { MemoryAnswer, MemoryEntry, MemoryStats, SourceKind } from "@/lib/memory";
import { ago, cn } from "@/lib/utils";
import { Empty, Panel, SectionTitle } from "./kit";
import { Md } from "./md";
import { ReplyBar } from "./reply-bar";

const KINDS: { kind: SourceKind; label: string; color: string; text: string }[] = [
  { kind: "chat", label: "Agent chats", color: "var(--color-claude)", text: "text-claude" },
  { kind: "linear", label: "Linear", color: "var(--color-codex)", text: "text-codex" },
  { kind: "obsidian", label: "Obsidian", color: "var(--color-hermes)", text: "text-hermes" },
  { kind: "sources", label: "Captured sources", color: "var(--color-hud)", text: "text-hud" },
  { kind: "notes", label: "Memory notes", color: "var(--color-opencode)", text: "text-opencode" },
];
const META = Object.fromEntries(KINDS.map((k) => [k.kind, k])) as Record<SourceKind, (typeof KINDS)[number]>;

const SECTION_LABEL: Record<string, string> = {
  "claude-code": "Claude Code",
  "ai-apps": "AI apps",
  "ai-techniques": "AI techniques",
  "ai-news": "AI news",
  stocks: "Stocks",
  business: "Business",
  video: "Video",
  personal: "Personal",
  unsorted: "Unsorted",
};

type Asked = MemoryAnswer & { q: string };

export function MemoryView({ stats }: { stats: MemoryStats }) {
  const [asked, setAsked] = useState<Asked | null>(null);
  const [thinking, setThinking] = useState("");
  const [addSeed, setAddSeed] = useState(0);
  const answer = useRef<HTMLDivElement>(null);
  const lit = asked ? new Set(asked.sources.map((s) => s.kind)) : null;
  const total = Object.values(stats.counts).reduce((a, b) => a + b, 0);
  const categoryEntries = Object.entries(stats.categories).sort((a, b) => b[1] - a[1]);
  const maxCategory = Math.max(1, ...categoryEntries.map(([, n]) => n));

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
      if (latest.current === q) setAsked({ q, answer: body.answer, sources: body.sources ?? [] }); // a newer question wins
    } finally {
      if (latest.current === q) setThinking("");
    }
  }

  // "/add …" (or "/remember …") keeps the text instead of asking about it; "/read <url>" saves the
  // page or transcript to the vault inbox. The reply bar shows where it landed.
  async function send(q: string): Promise<string | void> {
    if (/^\/read\b/i.test(q)) {
      const url = q.replace(/^\/read\s*/i, "").trim();
      if (!url) throw new Error("Paste a URL after /read.");
      return read(url);
    }
    if (/^\/(?:add|remember)\b/i.test(q)) {
      const text = q.replace(/^\/(?:add|remember)\s*/i, "").trim();
      if (!text) throw new Error("Write what to remember after /add.");
      const res = await fetch("/api/memory/capture", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) throw new Error(body?.error ?? `error ${res.status}`);
      return `Saved to memory · ${body.file}`;
    }
    if (/^https?:\/\/\S+$/i.test(q)) return read(q);
    return ask(q);
  }

  async function read(url: string): Promise<string> {
    const res = await fetch("/api/memory/read", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.ok) throw new Error(body?.error ?? `error ${res.status}`);
    return body.duplicate ? `Already in the vault · ${body.file}` : `Read · ${body.category ? `${body.category} · ` : ""}${body.file}`;
  }

  // /memory?q=… (from the command palette) asks straight away — also when already on this page.
  const urlQ = useSearchParams().get("q")?.trim() ?? "";
  useEffect(() => {
    if (urlQ) void send(urlQ).catch(() => {});
    // Only a new question in the URL triggers this; the reply bar handles the rest.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlQ]);

  return (
    <>
      <div className="grid gap-4 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <Panel className="flex flex-col items-center p-5">
          <Ring stats={stats} lit={lit} busy={!!thinking} />
          <ul className="mt-5 w-full space-y-2.5 text-sm">
            {KINDS.map((k) => {
              const n = stats.counts[k.kind];
              return (
                <li key={k.kind} className={cn("transition-opacity duration-500", lit && !lit.has(k.kind) && "opacity-35")}>
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: k.color }} />
                    <span className="truncate text-muted">{k.label}</span>
                    <span className="tnum ml-auto text-text">{n}</span>
                  </div>
                  <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/[0.05]">
                    <div className="h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${total ? (n / total) * 100 : 0}%`, background: k.color, opacity: 0.8 }} />
                  </div>
                </li>
              );
            })}
          </ul>
          {categoryEntries.length > 0 && (
            <div className="mt-4 w-full border-t border-line pt-3">
              <p className="hud-label">New captures by section</p>
              <ul className="mt-2 space-y-1.5">
                {categoryEntries.map(([category, n]) => (
                  <li key={category} className="flex items-center gap-2 text-xs">
                    <span className="w-24 truncate text-muted">{SECTION_LABEL[category] ?? category}</span>
                    <span className="h-1 flex-1 overflow-hidden rounded-full bg-white/[0.05]">
                      <span className="block h-full rounded-full bg-hud transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${(n / maxCategory) * 100}%` }} />
                    </span>
                    <span className="tnum w-5 text-right text-text">{n}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
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

      <Atlas stats={stats} onAdd={() => setAddSeed((n) => n + 1)} />

      <p className="mt-4 px-1 text-xs leading-relaxed text-faint">
        <code className="font-mono text-text">/add &lt;text&gt;</code> keeps your own note; <code className="font-mono text-text">/read https://…</code> saves an article or video transcript. Both are searchable here immediately.
      </p>

      <div className="h-28" aria-hidden />
      <ReplyBar placeholder="Ask your memory — /add <text> or /read <url>" onSend={send} seed={addSeed} seedText="/add " />
    </>
  );
}

// Every memory in one browsable instrument: filter by source or section, search the text, open the
// original. The ring above shows the shape; this shows the actual things.
function Atlas({ stats, onAdd }: { stats: MemoryStats; onAdd: () => void }) {
  const [kind, setKind] = useState<"all" | SourceKind>("all");
  const [category, setCategory] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(30);
  const total = stats.entries.length;

  useEffect(() => setLimit(30), [kind, category, q]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return stats.entries.filter((e) => {
      if (kind !== "all" && e.kind !== kind) return false;
      if (category && e.category !== category) return false;
      if (!needle) return true;
      return `${e.title} ${e.category ?? ""} ${e.snippet}`.toLowerCase().includes(needle);
    });
  }, [stats.entries, kind, category, q]);

  const groups = useMemo(() => {
    const map = new Map<SourceKind, MemoryEntry[]>();
    for (const e of filtered) {
      const list = map.get(e.kind);
      if (list) list.push(e);
      else map.set(e.kind, [e]);
    }
    return KINDS.flatMap((k) => {
      const all = map.get(k.kind);
      if (!all?.length) return [];
      all.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
      return [{ ...k, total: all.length, items: all.slice(0, limit) }];
    });
  }, [filtered, limit]);

  const more = groups.some((g) => g.total > g.items.length);
  const categories = Object.entries(stats.categories).sort((a, b) => b[1] - a[1]);

  function pickKind(next: "all" | SourceKind) {
    setKind(next);
    if (next !== "all" && next !== "sources") setCategory(null);
  }
  function pickCategory(next: string | null) {
    setCategory(next);
    if (next) setKind("sources");
  }

  return (
    <section id="atlas" className="mt-8 scroll-mt-20">
      <SectionTitle right={`${filtered.length} of ${total}`}>Memory atlas</SectionTitle>
      <p className="sr-only" aria-live="polite">{filtered.length} memories shown.</p>
      <Panel className="overflow-hidden">
        <div className="border-b border-line p-3 sm:p-4">
          <div className="flex gap-2">
            <div className="relative flex min-w-0 flex-1 items-center">
              <label htmlFor="memory-search" className="sr-only">Search memory</label>
              <Search className="pointer-events-none absolute left-3 h-4 w-4 text-faint" aria-hidden />
              <input
                id="memory-search"
                type="text"
                inputMode="search"
                enterKeyHint="search"
                name="memory-search"
                autoComplete="off"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search titles, sections and text…"
                className="h-10 w-full rounded-xl border border-line bg-white/[0.02] pl-9 pr-9 text-sm transition-colors placeholder:text-faint focus:border-line-hi"
              />
              {q && (
                <button type="button" onClick={() => setQ("")} aria-label="Clear search" className="absolute right-2 grid h-7 w-7 place-items-center rounded-md text-faint transition-colors hover:bg-white/5 hover:text-text">
                  <X className="h-3.5 w-3.5" aria-hidden />
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={onAdd}
              className="flex h-10 shrink-0 items-center gap-1.5 rounded-xl border border-line px-3 text-sm text-muted transition-colors hover:border-line-hi hover:bg-white/[0.04] hover:text-text"
            >
              <Plus className="h-4 w-4" aria-hidden />
              <span className="hidden sm:inline">Add memory</span>
              <span className="sr-only sm:hidden">Add memory</span>
            </button>
          </div>
        </div>
        <div className="md:grid md:grid-cols-[220px_minmax(0,1fr)]">
          <aside className="border-b border-line p-3 md:border-b-0 md:border-r md:p-4">
            <div role="group" aria-label="Filter by source" className="flex gap-1.5 overflow-x-auto pb-1 md:flex-col md:overflow-visible md:pb-0">
              <FilterButton active={kind === "all" && !category} onClick={() => { setKind("all"); setCategory(null); }} label="All memory" count={total} color="var(--color-text)" />
              {KINDS.map((k) => (
                <FilterButton key={k.kind} active={kind === k.kind} onClick={() => pickKind(k.kind)} label={k.label} count={stats.counts[k.kind]} color={k.color} />
              ))}
            </div>
            {categories.length > 0 && (
              <div className="mt-3 border-t border-line pt-3">
                <p className="hud-label hidden md:block">Sections</p>
                <div role="group" aria-label="Filter by section" className="mt-2 flex gap-1.5 overflow-x-auto pb-1 md:flex-col md:overflow-visible md:pb-0">
                  <CategoryButton active={!category} onClick={() => setCategory(null)} label="All sections" count={categories.reduce((n, [, c]) => n + c, 0)} />
                  {categories.map(([c, n]) => (
                    <CategoryButton key={c} active={category === c} onClick={() => pickCategory(c)} label={SECTION_LABEL[c] ?? c} count={n} />
                  ))}
                </div>
              </div>
            )}
          </aside>
          <div className="min-w-0">
            {groups.length === 0 ? (
              <Empty action={<button type="button" onClick={onAdd} className="text-sm text-text underline decoration-line-hi underline-offset-4 hover:decoration-text">Add a memory</button>}>
                No memory matches that. Try another word, or clear the filters.
              </Empty>
            ) : (
              <>
                <div className="md:max-h-[620px] md:overflow-y-auto md:overscroll-contain">
                  {groups.map((g) => (
                    <section key={g.kind}>
                      <div className="flex items-center gap-2 border-b border-line bg-bg-raised/[0.97] px-4 py-2.5 backdrop-blur md:sticky md:top-0 md:z-10">
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: g.color }} />
                        <h3 className="hud-label !text-[10.5px] !text-muted">{g.label}</h3>
                        <span className="tnum ml-auto text-xs text-faint">{g.items.length < g.total ? `${g.items.length} of ${g.total}` : g.total}</span>
                      </div>
                      <ul>
                        {g.items.map((e) => <MemoryRow key={e.id} entry={e} color={g.color} />)}
                      </ul>
                    </section>
                  ))}
                </div>
                {more && (
                  <div className="border-t border-line p-3">
                    <button type="button" onClick={() => setLimit((n) => n + 30)} className="w-full rounded-lg border border-line px-3 py-2 text-sm text-muted transition-colors hover:border-line-hi hover:bg-white/[0.04] hover:text-text">
                      Show 30 more
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </Panel>
    </section>
  );
}

function FilterButton({ active, onClick, label, count, color }: { active: boolean; onClick: () => void; label: string; count: number; color: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex shrink-0 items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors md:w-full",
        active ? "bg-white/[0.06] text-text" : "text-muted hover:bg-white/[0.03] hover:text-text",
      )}
    >
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
      <span className="truncate">{label}</span>
      <span className="tnum ml-auto text-xs text-faint">{count}</span>
    </button>
  );
}

function CategoryButton({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex shrink-0 items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors md:w-full",
        active ? "bg-white/[0.06] text-text" : "text-muted hover:bg-white/[0.03] hover:text-text",
      )}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-hud" />
      <span className="truncate">{label}</span>
      <span className="tnum ml-auto text-xs text-faint">{count}</span>
    </button>
  );
}

function MemoryRow({ entry, color }: { entry: MemoryEntry; color: string }) {
  const isPath = entry.kind === "obsidian" || entry.kind === "sources";
  const label = isPath ? (entry.title.split("/").pop() ?? entry.title) : entry.title;
  const path = isPath ? entry.title : undefined;
  const inner = (
    <>
      <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="truncate text-[15px]">{label}</span>
          {entry.category && <span className="shrink-0 rounded-md border border-line px-1.5 py-0.5 font-mono text-[10.5px] tracking-[0.04em] text-muted">{SECTION_LABEL[entry.category] ?? entry.category}</span>}
          {entry.href && <ArrowUpRight className="h-3.5 w-3.5 shrink-0 self-center text-faint" aria-hidden />}
        </span>
        <span className="mt-0.5 block truncate text-xs text-faint" title={path}>
          {path ? `${path} · ` : ""}{ago(entry.at)}
        </span>
        <span className="mt-1 line-clamp-2 block text-[13px] leading-relaxed text-muted">{entry.snippet || "No preview."}</span>
      </span>
    </>
  );
  const row = "flex min-h-14 gap-3 border-b border-line px-4 py-3.5 last:border-0";
  return (
    <li>
      {entry.href ? (
        <a href={entry.href} target={entry.href.startsWith("/") ? undefined : "_blank"} rel="noreferrer" className={cn(row, "transition-colors hover:bg-white/[0.02]")}>
          {inner}
        </a>
      ) : (
        <div className={row}>{inner}</div>
      )}
    </li>
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
