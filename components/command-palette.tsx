"use client";

import { ArrowRight, Brain, CalendarDays, CornerDownLeft, Mic, Search, Swords, type LucideIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgentLogo } from "@/components/agent-logo";
import type { AgentKey } from "@/lib/agents";
import { cn } from "@/lib/utils";

// ⌘K / Ctrl+K anywhere (or the search button): jump to any page, chat or room, or turn what you type
// into an action — roast it, ask memory about it, talk. Keyboard: ↑↓ to move, Enter to run, Esc to close.

export const OPEN_PALETTE = "agentic:open-palette";
export const openPalette = () => window.dispatchEvent(new Event(OPEN_PALETTE));

type Nav = { href: string; label: string; icon: LucideIcon };
type Item = { id: string; group: string; label: string; hint?: string; icon?: LucideIcon; agent?: AgentKey; agents?: AgentKey[]; run: () => void };
type Chat = { id: string; title: string; agent: AgentKey; status: string; href: string };
type RoomRow = { id: string; title: string; agents: AgentKey[]; status: string; href: string };

// Small fuzzy score: every query word must appear; earlier and word-start matches rank higher.
function score(text: string, q: string): number {
  if (!q) return 1;
  const t = text.toLowerCase();
  let s = 0;
  for (const w of q.toLowerCase().split(/\s+/).filter(Boolean)) {
    const i = t.indexOf(w);
    if (i < 0) return 0;
    s += 10 - Math.min(9, i / 8) + (i === 0 || /\W/.test(t[i - 1]) ? 4 : 0);
  }
  return s;
}

export function CommandPalette({ nav, onTalk }: { nav: Nav[]; onTalk: () => void }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const [data, setData] = useState<{ chats: Chat[]; rooms: RoomRow[] } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const restore = useRef<HTMLElement | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    setQ("");
    setActive(0);
    const el = restore.current;
    requestAnimationFrame(() => el?.focus?.()); // after the dialog has unmounted
  }, []);

  // Every dismissal goes through close(), so focus always returns to where it was.
  const openRef = useRef(false);
  openRef.current = open;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k" && !e.isComposing) {
        e.preventDefault();
        if (openRef.current) close();
        else setOpen(true);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_PALETTE, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_PALETTE, onOpen);
    };
  }, [close]);

  useEffect(() => {
    if (!open) return;
    restore.current = document.activeElement as HTMLElement | null;
    requestAnimationFrame(() => input.current?.focus());
    fetch("/api/palette", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => b && setData({ chats: b.chats ?? [], rooms: b.rooms ?? [] }))
      .catch(() => {});
  }, [open]);

  const go = useCallback(
    (href: string) => {
      close();
      router.push(href);
    },
    [close, router],
  );

  const items = useMemo<Item[]>(() => {
    const query = q.trim();
    const out: Item[] = [];
    if (query) {
      out.push(
        { id: "a-roast", group: "Do", label: `Roast: “${query}”`, hint: "Agents debate it to a verdict", icon: Swords, run: () => go(`/room?task=${encodeURIComponent(query)}`) },
        { id: "a-memory", group: "Do", label: `Ask memory: “${query}”`, hint: "Search everything you've written down", icon: Brain, run: () => go(`/memory?q=${encodeURIComponent(query)}`) },
      );
    }
    const actions: Item[] = [
      { id: "a-talk", group: "Do", label: "Talk to an agent", hint: "Voice or text", icon: Mic, run: () => (close(), onTalk()) },
      { id: "a-plan", group: "Do", label: "Plan today", hint: "Calendar + tasks", icon: CalendarDays, run: () => go("/calendar") },
      { id: "a-room", group: "Do", label: "Start a roast", hint: "Pick agents, set the task", icon: Swords, run: () => go("/room") },
    ];
    out.push(...actions.filter((a) => score(`${a.label} ${a.hint}`, query) > 0));
    out.push(
      ...nav
        .map((n) => ({ n, s: score(n.label, query) }))
        .filter((x) => x.s > 0)
        .map(({ n }) => ({ id: `n-${n.href}`, group: "Go to", label: n.label, icon: n.icon, run: () => go(n.href) })),
    );
    const chats = (data?.chats ?? [])
      .map((c) => ({ c, s: score(c.title, query) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, query ? 8 : 5)
      .map(({ c }) => ({ id: `c-${c.id}`, group: "Chats", label: c.title, hint: c.status === "waiting" ? "your turn" : c.status, agent: c.agent, run: () => go(c.href) }));
    const rooms = (data?.rooms ?? [])
      .map((r) => ({ r, s: score(r.title, query) }))
      .filter((x) => x.s > 0)
      .slice(0, query ? 5 : 3)
      .map(({ r }) => ({ id: `r-${r.id}`, group: "Roasts", label: r.title, hint: r.status, agents: r.agents, run: () => go(r.href) }));
    return [...out, ...chats, ...rooms];
  }, [q, data, nav, go, close, onTalk]);

  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing) return; // IME confirmation, not a command
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(items.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      items[active]?.run();
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "Tab") {
      e.preventDefault(); // focus stays in the palette while it's open
    }
  };

  let lastGroup = "";
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center px-3 pt-[max(12px,env(safe-area-inset-top))] sm:pt-[12vh]" role="dialog" aria-modal="true" aria-label="Command palette">
      <button aria-label="Close" tabIndex={-1} onClick={close} className="palette-scrim absolute inset-0 bg-black/60 backdrop-blur-[3px]" />
      <div className="palette-in panel brackets relative flex max-h-[min(70dvh,560px)] w-full max-w-xl flex-col overflow-hidden bg-bg-raised/95 [overscroll-behavior:contain]" onKeyDown={onKeyDown}>
        {/* The whole search row shows focus (the field itself has no ring inside the panel). */}
        <div className="flex items-center gap-3 border-b border-line px-4 transition-colors focus-within:border-hud/40 focus-within:bg-white/[0.02]">
          <Search className="h-[18px] w-[18px] shrink-0 text-hud" aria-hidden />
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Jump to… or type a task to roast or ask"
            aria-label="Search pages, chats and actions"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={items[active] ? `palette-${items[active].id}` : undefined}
            autoComplete="off"
            spellCheck={false}
            className="h-14 min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-faint focus-visible:outline-none"
          />
          <kbd className="hidden rounded-md border border-line px-1.5 py-0.5 font-mono text-[10.5px] text-faint sm:block">Esc</kbd>
        </div>
        <ul ref={list} id="palette-list" role="listbox" aria-label="Results" className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {items.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted">Nothing matches “{q}”.</li>}
          {items.map((it, i) => {
            const head = it.group !== lastGroup;
            lastGroup = it.group;
            const Icon = it.icon;
            return (
              <li key={it.id} role="presentation">
                {head && <p className="hud-label px-3 pt-3 pb-1.5 !text-[9.5px]">{it.group}</p>}
                <div
                  id={`palette-${it.id}`}
                  role="option"
                  aria-selected={i === active}
                  data-index={i}
                  onMouseMove={() => setActive(i)}
                  onClick={() => it.run()}
                  className={cn("flex min-h-12 cursor-pointer items-center gap-3 rounded-[11px] px-3 py-2", i === active ? "bg-white/[0.07]" : "")}
                >
                  {it.agent ? (
                    <AgentLogo agent={it.agent} size="sm" />
                  ) : it.agents ? (
                    <span className="flex shrink-0 -space-x-2">
                      {it.agents.slice(0, 3).map((a) => (
                        <AgentLogo key={a} agent={a} size="xs" />
                      ))}
                    </span>
                  ) : (
                    Icon && (
                      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-[9px] bg-white/[0.04] shadow-[0_0_0_1px_rgb(255_255_255/0.07)_inset]">
                        <Icon className="h-4 w-4 text-hud" strokeWidth={1.75} aria-hidden />
                      </span>
                    )
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px]">{it.label}</span>
                    {it.hint && <span className="block truncate font-mono text-[10.5px] text-faint">{it.hint}</span>}
                  </span>
                  {i === active ? <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-faint" aria-hidden /> : <ArrowRight className="h-3.5 w-3.5 shrink-0 text-transparent" aria-hidden />}
                </div>
              </li>
            );
          })}
        </ul>
        <p className="hud-label hidden gap-4 border-t border-line px-4 py-2 !text-[9.5px] sm:flex">
          <span>↑↓ move</span>
          <span>↵ open</span>
          <span>⌘&nbsp;K toggle</span>
        </p>
      </div>
    </div>
  );
}
