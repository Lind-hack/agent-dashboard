"use client";

import { Bot, CalendarDays, ChevronRight, Globe, House, Inbox, LayoutGrid, MessageSquare, Mic, Settings, Sparkles, Swords, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { AgentLogo } from "@/components/agent-logo";
import { Composer } from "@/components/composer";
import { Core } from "@/components/core";
import { AGENT_HEX, AGENT_LABELS, type AgentKey } from "@/lib/agents";
import { cn } from "@/lib/utils";

// The OS frame: sidebar on desktop, top bar + thumb tab bar on the phone, and the Talk sheet that
// any screen can open. Sections appear here as they ship (NAV is the single list).

type NavItem = { href: string; label: string; icon: typeof House; badge?: boolean };

export const WORKSPACE: NavItem[] = [
  { href: "/", label: "Home", icon: House },
  { href: "/inbox", label: "Inbox", icon: Inbox, badge: true },
  { href: "/room", label: "Room", icon: Swords },
  { href: "/chat", label: "Chats", icon: MessageSquare },
  { href: "/calendar", label: "Today", icon: CalendarDays },
  { href: "/memory", label: "Memory", icon: Sparkles },
];
export const TOOLS: NavItem[] = [
  { href: "/agents", label: "Agents", icon: Bot },
  { href: "/website", label: "Website", icon: Globe },
];
// Sections still being built in this release stay out of the nav until they exist.
const LIVE = new Set(["/", "/inbox", "/room", "/chat", "/calendar", "/memory", "/website", "/agents", "/settings", "/more"]);

const isActive = (path: string, href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`));

// Badge count + which agents are working, polled once a minute (every 10 s while something runs).
function useSystem() {
  const [s, setS] = useState<{ count: number; working: AgentKey[] }>({ count: 0, working: [] });
  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      const b = await fetch("/api/inbox?count=1", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
      if (stop) return;
      const next = { count: typeof b?.count === "number" ? b.count : 0, working: Array.isArray(b?.working) ? (b.working as AgentKey[]) : [] };
      setS(next);
      timer = setTimeout(load, next.working.length ? 10_000 : 60_000);
    };
    void load();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, []);
  return s;
}

function TalkSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center lg:items-center" role="dialog" aria-modal="true" aria-label="Talk to an agent">
      <button aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/65 backdrop-blur-sm" />
      <div className="rise panel brackets relative w-full max-w-lg rounded-b-none bg-bg-raised/95 px-5 pt-4 pb-[calc(20px+env(safe-area-inset-bottom))] lg:rounded-[var(--radius-panel)] lg:pb-6">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/15 lg:hidden" />
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="hud-label">Core · voice or text</p>
            <h2 className="mt-1 text-lg font-semibold tracking-[-0.02em]">Talk to an agent</h2>
          </div>
          <button onClick={onClose} aria-label="Close" className="grid h-10 w-10 place-items-center rounded-xl text-muted hover:bg-white/5 hover:text-text">
            <X className="h-5 w-5" />
          </button>
        </div>
        <Composer onStarted={onClose} />
      </div>
    </div>
  );
}

function SideLink({ item, path, count }: { item: NavItem; path: string; count: number }) {
  const on = isActive(path, item.href);
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={on ? "page" : undefined}
      className={cn(
        "relative flex h-10 items-center gap-3 rounded-[11px] px-3 text-sm transition-colors duration-200",
        on ? "bg-white/[0.06] text-text shadow-[0_1px_0_rgb(255_255_255/0.06)_inset,0_0_0_1px_rgb(255_255_255/0.05)_inset]" : "text-muted hover:bg-white/[0.03] hover:text-text",
      )}
    >
      {on && <span className="absolute top-1/2 -left-4 h-4 w-[2px] -translate-y-1/2 rounded-full bg-hud shadow-[0_0_10px_var(--color-hud)]" aria-hidden />}
      <Icon className="h-[18px] w-[18px]" strokeWidth={on ? 2 : 1.75} />
      {item.label}
      {item.badge && count > 0 && <span className="tnum ml-auto rounded-md bg-hermes/15 px-1.5 py-0.5 font-mono text-[11px] text-hermes">{count}</span>}
    </Link>
  );
}

function Brand({ working }: { working: AgentKey[] }) {
  return (
    <Link href="/" className="flex items-center gap-3 px-1">
      <span className="relative h-9 w-9 overflow-hidden rounded-[11px] bg-black shadow-[0_0_0_1px_rgb(169_228_245/0.25)_inset]">
        <Core className="absolute inset-0 h-full w-full" density={0.35} energy={working.length ? 0.8 : 0.3} tints={working.map((a) => AGENT_HEX[a])} />
      </span>
      <span className="leading-tight">
        <span className="block text-[16px] font-semibold tracking-[-0.03em]">Agentic OS</span>
        <span className="hud-label block !text-[9.5px]">Lind · vps</span>
      </span>
    </Link>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const [talk, setTalk] = useState(false);
  const { count, working } = useSystem();
  if (path === "/login") return <>{children}</>;

  const workspace = WORKSPACE.filter((i) => LIVE.has(i.href));
  const tools = TOOLS.filter((i) => LIVE.has(i.href));
  const crumb =
    [...WORKSPACE, ...TOOLS, { href: "/settings", label: "Settings", icon: Settings }].find((i) => isActive(path, i.href))?.label ??
    (path.startsWith("/jobs") || path.startsWith("/codex") || path === "/voice" ? "Chats" : path.startsWith("/agents/g") ? "Room" : "");

  return (
    <div className="min-h-dvh lg:pl-[248px]">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[248px] flex-col border-r border-line bg-[#09090c]/80 px-4 py-5 backdrop-blur-xl lg:flex">
        <Brand working={working} />
        <p className="hud-label mt-8 mb-2 px-3">Workspace</p>
        <nav className="flex flex-col gap-0.5">
          {workspace.map((i) => (
            <SideLink key={i.href} item={i} path={path} count={count} />
          ))}
        </nav>

        {/* The Core card: tap to talk; it shows who's working right now. */}
        <button onClick={() => setTalk(true)} className="group brackets relative mt-6 h-[188px] w-full overflow-hidden rounded-[16px] border border-line bg-black/40 text-left" aria-label="Talk to an agent">
          <Core className="absolute inset-0 h-full w-full transition-transform duration-700 ease-[var(--ease-out-expo)] group-hover:scale-[1.04]" energy={working.length ? 0.85 : 0.3} tints={working.map((a) => AGENT_HEX[a])} />
          <span className="hud-label absolute top-3 left-3 flex items-center gap-1.5 !text-[9.5px]">
            <span className={cn("h-1.5 w-1.5 rounded-full", working.length ? "bg-ok shadow-[0_0_8px_var(--color-ok)]" : "bg-hud/60")} />
            {working.length ? `${working.length} working` : "core idle"}
          </span>
          {working.length > 0 && (
            <span className="absolute top-2.5 right-3 flex -space-x-1.5">
              {working.map((a) => (
                <AgentLogo key={a} agent={a} size="xs" state="working" title={AGENT_LABELS[a]} />
              ))}
            </span>
          )}
          <span className="absolute inset-x-3 bottom-3 flex items-center gap-2 rounded-[10px] border border-white/10 bg-black/55 px-3 py-2 text-xs text-text backdrop-blur-md">
            <Mic className="h-3.5 w-3.5 text-hud" /> Tap to talk
          </span>
        </button>

        {tools.length > 0 && (
          <>
            <p className="hud-label mt-6 mb-2 px-3">Tools</p>
            <nav className="flex flex-col gap-0.5">
              {tools.map((i) => (
                <SideLink key={i.href} item={i} path={path} count={count} />
              ))}
            </nav>
          </>
        )}

        <div className="mt-auto border-t border-line pt-3">
          <SideLink item={{ href: "/settings", label: "Settings", icon: Settings }} path={path} count={0} />
          <div className="mt-2 flex items-center gap-3 px-3 py-2">
            <span className="grid h-8 w-8 place-items-center rounded-[10px] bg-[linear-gradient(135deg,var(--color-claude),var(--color-hermes))] text-sm font-semibold text-bg">L</span>
            <span className="leading-tight">
              <span className="block text-sm">Lind</span>
              <span className="block text-[11px] text-faint">Personal workspace</span>
            </span>
          </div>
        </div>
      </aside>

      {/* Top bar */}
      <header className="sticky top-0 z-20 border-b border-line bg-bg/75 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-[1180px] items-center gap-3 px-4 lg:px-8">
          <Link href="/" className="relative h-8 w-8 overflow-hidden rounded-[10px] bg-black shadow-[0_0_0_1px_rgb(169_228_245/0.25)_inset] lg:hidden" aria-label="Home">
            <Core className="absolute inset-0 h-full w-full" density={0.3} energy={working.length ? 0.8 : 0.3} tints={working.map((a) => AGENT_HEX[a])} />
          </Link>
          <p className="font-mono text-[12px] tracking-[0.06em]">
            <span className="text-muted">agentic</span>
            <span className="px-1.5 text-faint">/</span>
            <span className="text-text">{(crumb || "vps").toLowerCase()}</span>
          </p>
          <div className="ml-auto flex items-center gap-1">
            <Link href="/chat" className="hidden h-9 items-center gap-2 rounded-[10px] px-3 text-sm text-muted hover:bg-white/5 hover:text-text sm:flex">
              <MessageSquare className="h-4 w-4" strokeWidth={1.75} /> Chats
            </Link>
            <button onClick={() => setTalk(true)} className="flex h-9 items-center gap-2 rounded-[10px] px-3 text-sm text-muted hover:bg-white/5 hover:text-text">
              <Mic className="h-4 w-4" strokeWidth={1.75} /> Voice
            </button>
          </div>
        </div>
      </header>

      <main className="pb-tabbar mx-auto max-w-[1180px] min-w-0 overflow-x-clip px-4 pt-4 lg:px-8">{children}</main>

      {/* Phone tab bar */}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-[#09090c]/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden" aria-label="Main">
        <div className="mx-auto grid max-w-md grid-cols-5 items-end px-2">
          {[
            { href: "/", label: "Home", icon: House },
            { href: "/inbox", label: "Inbox", icon: Inbox, badge: true },
          ].map((i) => (
            <TabLink key={i.href} item={i} path={path} count={count} />
          ))}
          <div className="flex justify-center">
            <button
              onClick={() => setTalk(true)}
              aria-label="Talk to an agent"
              className="relative -mt-7 grid h-[60px] w-[60px] place-items-center overflow-hidden rounded-[18px] bg-black shadow-[0_0_0_1px_rgb(169_228_245/0.3)_inset,0_14px_30px_-10px_rgb(169_228_245/0.45)]"
            >
              <Core className="absolute inset-0 h-full w-full" density={0.45} energy={working.length ? 0.85 : 0.4} tints={working.map((a) => AGENT_HEX[a])} />
              <Mic className="relative h-5 w-5 text-white drop-shadow-[0_0_6px_rgb(0_0_0)]" />
            </button>
          </div>
          {[
            { href: "/room", label: "Room", icon: Swords },
            { href: "/more", label: "More", icon: LayoutGrid },
          ].map((i) => (
            <TabLink key={i.href} item={i} path={path} count={count} />
          ))}
        </div>
      </nav>

      <TalkSheet open={talk} onClose={() => setTalk(false)} />
    </div>
  );
}

function TabLink({ item, path, count }: { item: NavItem; path: string; count: number }) {
  const on = isActive(path, item.href);
  const Icon = item.icon;
  return (
    <Link href={item.href} aria-current={on ? "page" : undefined} className={cn("relative flex flex-col items-center gap-1 py-2.5 text-[11px]", on ? "text-text" : "text-faint")}>
      {on && <span className="absolute top-0 h-[2px] w-6 rounded-full bg-hud shadow-[0_0_10px_var(--color-hud)]" aria-hidden />}
      <Icon className="h-[22px] w-[22px]" strokeWidth={on ? 2 : 1.6} />
      {item.label}
      {item.badge && count > 0 && (
        <span className="tnum absolute top-1 left-1/2 ml-2 min-w-4 rounded-md bg-hermes px-1 text-center font-mono text-[10px] leading-4 font-semibold text-bg">{count > 99 ? "99+" : count}</span>
      )}
    </Link>
  );
}

// "More" page content on the phone: everything that isn't in the tab bar.
export function MoreLinks() {
  const items = [...WORKSPACE, ...TOOLS, { href: "/settings", label: "Settings", icon: Settings }].filter(
    (i) => LIVE.has(i.href) && !["/", "/inbox", "/room"].includes(i.href),
  );
  return (
    <div className="panel overflow-hidden">
      {items.map((i) => {
        const Icon = i.icon;
        return (
          <Link key={i.href} href={i.href} className="flex min-h-14 items-center gap-3 border-b border-line px-4 last:border-0 hover:bg-white/[0.02]">
            <span className="grid h-9 w-9 place-items-center rounded-[10px] bg-white/[0.04] shadow-[0_0_0_1px_rgb(255_255_255/0.06)_inset]">
              <Icon className="h-[18px] w-[18px] text-muted" strokeWidth={1.75} />
            </span>
            <span className="text-[15px]">{i.label}</span>
            <ChevronRight className="ml-auto h-4 w-4 text-faint" aria-hidden />
          </Link>
        );
      })}
    </div>
  );
}
