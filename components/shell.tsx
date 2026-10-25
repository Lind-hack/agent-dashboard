"use client";

import {
  Bot,
  CalendarDays,
  Globe,
  House,
  Inbox,
  LayoutGrid,
  ChevronRight,
  MessageSquare,
  Mic,
  Settings,
  Sparkles,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Composer } from "@/components/composer";
import { Orb } from "@/components/orb";
import { cn } from "@/lib/utils";

// The OS frame: sidebar on desktop, top bar + thumb tab bar on the phone, and the Talk sheet that
// any screen can open. Sections appear here as they ship (NAV is the single list).

type NavItem = { href: string; label: string; icon: typeof House; badge?: boolean };

export const WORKSPACE: NavItem[] = [
  { href: "/", label: "Dashboard", icon: House },
  { href: "/inbox", label: "Inbox", icon: Inbox, badge: true },
  { href: "/chat", label: "Chat", icon: MessageSquare },
  { href: "/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/memory", label: "Memory", icon: Sparkles },
];
export const TOOLS: NavItem[] = [
  { href: "/website", label: "Website", icon: Globe },
  { href: "/agents", label: "Agents", icon: Bot },
];
// Sections still being built in this release stay out of the nav until they exist.
const LIVE = new Set(["/", "/inbox", "/chat", "/website", "/agents", "/settings", "/more"]);

const isActive = (path: string, href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`));

function useInboxCount() {
  const [n, setN] = useState(0);
  useEffect(() => {
    let stop = false;
    const load = () =>
      fetch("/api/inbox?count=1", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((b) => !stop && typeof b?.count === "number" && setN(b.count))
        .catch(() => {});
    void load();
    const t = setInterval(load, 60_000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, []);
  return n;
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
      <button aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div className="rise panel relative w-full max-w-lg rounded-b-none bg-bg-raised/95 px-5 pt-4 pb-[calc(20px+env(safe-area-inset-bottom))] lg:rounded-[var(--radius-panel)] lg:pb-6">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/15 lg:hidden" />
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold tracking-[-0.02em]">Talk to an agent</h2>
          <button onClick={onClose} aria-label="Close" className="grid h-9 w-9 place-items-center rounded-full text-muted hover:bg-white/5 hover:text-text">
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
        "flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors duration-200",
        on ? "bg-white/[0.07] text-text shadow-[0_1px_0_rgb(255_255_255/0.05)_inset]" : "text-muted hover:bg-white/[0.03] hover:text-text",
      )}
    >
      <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
      {item.label}
      {item.badge && count > 0 && <span className="tnum ml-auto rounded-full bg-hermes/20 px-2 py-0.5 text-[11px] font-medium text-hermes">{count}</span>}
    </Link>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const [talk, setTalk] = useState(false);
  const count = useInboxCount();
  if (path === "/login") return <>{children}</>;

  const workspace = WORKSPACE.filter((i) => LIVE.has(i.href));
  const tools = TOOLS.filter((i) => LIVE.has(i.href));
  const crumb = [...WORKSPACE, ...TOOLS, { href: "/settings", label: "Settings", icon: Settings }].find((i) => isActive(path, i.href))?.label ??
    (path.startsWith("/jobs") || path.startsWith("/codex") || path === "/voice" ? "Chat" : "");

  return (
    <div className="min-h-dvh lg:pl-[248px]">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[248px] flex-col border-r border-line bg-bg/70 px-4 py-5 backdrop-blur-xl lg:flex">
        <Link href="/" className="mb-7 flex items-center gap-3 px-2">
          <span className="relative h-8 w-8 overflow-hidden rounded-full">
            <Orb className="absolute inset-0 h-full w-full" energy={0.2} size={0.34} />
          </span>
          <span className="leading-tight">
            <span className="block text-[17px] font-semibold tracking-[-0.03em]">Agentic OS</span>
            <span className="block text-[10px] tracking-[0.2em] text-faint uppercase">Lind · vps</span>
          </span>
        </Link>
        <p className="mb-2 px-3 text-[11px] font-medium tracking-[0.14em] text-faint uppercase">Workspace</p>
        <nav className="flex flex-col gap-0.5">
          {workspace.map((i) => (
            <SideLink key={i.href} item={i} path={path} count={count} />
          ))}
        </nav>

        <button
          onClick={() => setTalk(true)}
          className="group relative mt-6 aspect-[4/5] w-full overflow-hidden rounded-[20px] border border-line text-left"
          aria-label="Talk to an agent"
        >
          <Orb className="absolute inset-0 h-full w-full transition-transform duration-700 ease-[var(--ease-out-expo)] group-hover:scale-105" />
          <span className="absolute inset-x-3 bottom-3 flex items-center gap-2 rounded-full bg-black/40 px-3 py-2 text-xs text-text backdrop-blur-md">
            <Mic className="h-3.5 w-3.5" /> Tap to talk
          </span>
        </button>

        {tools.length > 0 && (
          <>
            <p className="mt-6 mb-2 px-3 text-[11px] font-medium tracking-[0.14em] text-faint uppercase">Tools</p>
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
            <span className="grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-claude to-hermes text-sm font-semibold text-bg">L</span>
            <span className="leading-tight">
              <span className="block text-sm">Lind</span>
              <span className="block text-[11px] text-faint">Personal workspace</span>
            </span>
          </div>
        </div>
      </aside>

      {/* Top bar */}
      <header className="sticky top-0 z-20 border-b border-line bg-bg/75 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-[1120px] items-center gap-3 px-4 lg:px-8">
          <Link href="/" className="relative h-7 w-7 overflow-hidden rounded-full lg:hidden" aria-label="Dashboard">
            <Orb className="absolute inset-0 h-full w-full" energy={0.2} size={0.34} />
          </Link>
          <p className="text-sm">
            <span className="text-text">Agentic</span>
            <span className="px-1.5 text-faint">/</span>
            <span className="text-muted">{crumb || "vps"}</span>
          </p>
          <div className="ml-auto flex items-center gap-1">
            <Link href="/chat" className="hidden items-center gap-2 rounded-full px-3 py-1.5 text-sm text-muted hover:bg-white/5 hover:text-text sm:flex">
              <MessageSquare className="h-4 w-4" strokeWidth={1.75} /> Chat
            </Link>
            <button onClick={() => setTalk(true)} className="flex items-center gap-2 rounded-full px-3 py-1.5 text-sm text-muted hover:bg-white/5 hover:text-text">
              <Mic className="h-4 w-4" strokeWidth={1.75} /> Voice
            </button>
          </div>
        </div>
      </header>

      <main className="pb-tabbar mx-auto max-w-[1120px] min-w-0 overflow-x-clip px-4 pt-4 lg:px-8">{children}</main>

      {/* Phone tab bar */}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-bg/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden" aria-label="Main">
        <div className="mx-auto grid max-w-md grid-cols-5 items-end px-2">
          {[
            { href: "/", label: "Home", icon: House },
            { href: "/inbox", label: "Inbox", icon: Inbox, badge: true },
          ].map((i) => (
            <TabLink key={i.href} item={i} path={path} count={count} />
          ))}
          <div className="flex justify-center">
            <button onClick={() => setTalk(true)} aria-label="Talk to an agent" className="relative -mt-6 grid h-16 w-16 place-items-center overflow-hidden rounded-full border border-line-hi shadow-[0_12px_30px_-8px_rgb(179_146_240/0.6)]">
              <Orb className="absolute inset-0 h-full w-full" energy={0.5} size={0.3} />
              <Mic className="relative h-6 w-6 text-white drop-shadow" />
            </button>
          </div>
          {[
            { href: "/chat", label: "Chats", icon: MessageSquare },
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
      <Icon className="h-[22px] w-[22px]" strokeWidth={on ? 2 : 1.6} />
      {item.label}
      {item.badge && count > 0 && (
        <span className="tnum absolute top-1 left-1/2 ml-2 min-w-4 rounded-full bg-hermes px-1 text-center text-[10px] leading-4 font-semibold text-bg">{count > 99 ? "99+" : count}</span>
      )}
    </Link>
  );
}

// "More" page content on the phone: everything that isn't in the tab bar.
export function MoreLinks() {
  const items = [...WORKSPACE, ...TOOLS, { href: "/settings", label: "Settings", icon: Settings }].filter(
    (i) => LIVE.has(i.href) && !["/", "/inbox", "/chat"].includes(i.href),
  );
  return (
    <div className="panel overflow-hidden">
      {items.map((i) => {
        const Icon = i.icon;
        return (
          <Link key={i.href} href={i.href} className="flex min-h-14 items-center gap-3 border-b border-line px-4 last:border-0 hover:bg-white/[0.02]">
            <Icon className="h-5 w-5 text-muted" strokeWidth={1.75} />
            <span className="text-[15px]">{i.label}</span>
            <ChevronRight className="ml-auto h-4 w-4 text-faint" aria-hidden />
          </Link>
        );
      })}
    </div>
  );
}
