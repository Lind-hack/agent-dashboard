"use client";

import { Bell, BellOff, Check, LoaderCircle, Play, Target } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { CoachNow } from "@/lib/coach";
import { cn } from "@/lib/utils";

// The Coach in the browser: the focus bar under the top bar on every page, the push switch, and the
// hook both use. The runner sends the pushes; this side only shows and acts.

export type CoachState = CoachNow & { progress: { id: string; title: string; weekMin: number; targetMin: number; todayDoneMin: number }[] };

export function useCoach(every = 30_000) {
  const [s, setS] = useState<CoachState | null>(null);
  const load = useCallback(async () => {
    const b = await fetch("/api/coach", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    if (b?.day) setS(b);
  }, []);
  useEffect(() => {
    void load();
    const t = setInterval(load, every);
    const back = () => document.visibilityState === "visible" && void load();
    document.addEventListener("visibilitychange", back);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", back);
    };
  }, [load, every]);
  const act = useCallback(
    async (body: Record<string, unknown>) => {
      const res = await fetch("/api/coach", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const out = await res.json().catch(() => null);
      if (!res.ok) throw new Error(out?.error ?? `error ${res.status}`);
      await load();
      return out;
    },
    [load],
  );
  return { s, load, act };
}

export const fmtLeft = (ms: number) => {
  const m = Math.max(0, Math.round(ms / 60_000));
  return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m` : `${m}m`;
};

// The thin strip under the top bar: what this minute is for. Hidden on /focus and /login.
export function FocusBar() {
  const path = usePathname();
  const { s, act } = useCoach();
  const [busy, setBusy] = useState("");
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 15_000);
    return () => clearInterval(t);
  }, []);
  if (!s || path === "/focus" || path === "/login") return null;
  const now = Date.now();
  const c = s.current;
  const n = s.next;
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: s.tz, hour: "2-digit", hourCycle: "h23" }).format(new Date()));
  if (!c && !n && (s.planned || hour < 7 || hour >= 23)) return null;

  const run = async (body: Record<string, unknown>) => {
    setBusy(String(body.action));
    try {
      await act(body);
    } finally {
      setBusy("");
    }
  };
  const pct = c ? Math.min(1, Math.max(0, (now - c.startMs) / (c.endMs - c.startMs))) : 0;
  const late = c && c.status !== "running" && now - c.startMs > 10 * 60_000;

  return (
    <div className="sticky top-14 z-[19] border-b border-line bg-[#0b0910]/85 backdrop-blur-xl" role="status" aria-live="polite">
      <div className="relative mx-auto flex h-11 max-w-[1180px] items-center gap-3 px-4 text-[13px] lg:px-8">
        {c ? (
          <>
            <span className={cn("relative flex h-2 w-2 shrink-0", c.status === "running" ? "text-ok" : late ? "text-warn" : "text-hermes")}>
              <span className="absolute inset-0 animate-ping rounded-full bg-current opacity-50 motion-reduce:hidden" />
              <span className="relative h-2 w-2 rounded-full bg-current" />
            </span>
            <span className="min-w-0 flex-1 truncate">
              <span className="text-muted">{c.status === "running" ? "Focus" : late ? "Not started" : "Now"} · </span>
              <span className="font-medium">{c.title}</span>
              {c.goal && <span className="hidden text-faint sm:inline"> · serves {c.goal.title}</span>}
            </span>
            <span className="tnum hidden shrink-0 font-mono text-[12px] text-muted sm:inline">{c.endMs > now ? `${fmtLeft(c.endMs - now)} left` : `${fmtLeft(now - c.endMs)} over`}</span>
            {c.status !== "running" ? (
              <button onClick={() => void run({ action: "start", id: c.id })} disabled={!!busy} className="press flex h-8 shrink-0 items-center gap-1.5 rounded-[9px] bg-text px-3 font-medium text-bg">
                {busy === "start" ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} Start
              </button>
            ) : (
              <button onClick={() => void run({ action: "done", id: c.id })} disabled={!!busy} className="press flex h-8 shrink-0 items-center gap-1.5 rounded-[9px] border border-ok/40 px-3 text-ok">
                {busy === "done" ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Done
              </button>
            )}
            <Link href={`/focus?block=${encodeURIComponent(c.id)}`} className="press hidden h-8 shrink-0 items-center rounded-[9px] border border-line px-3 text-muted hover:text-text sm:flex">
              Focus mode
            </Link>
            <span className="absolute inset-x-0 bottom-0 h-[2px] bg-white/[0.04]" aria-hidden>
              <span className="day-bar block h-full" style={{ width: `${pct * 100}%` }} />
            </span>
          </>
        ) : n ? (
          <>
            <Target className="h-3.5 w-3.5 shrink-0 text-hermes" />
            <span className="min-w-0 flex-1 truncate">
              <span className="text-muted">Free · next at {n.start}: </span>
              <span className="font-medium">{n.title}</span>
            </span>
            <span className="tnum shrink-0 font-mono text-[12px] text-muted">in {fmtLeft(n.startMs - now)}</span>
          </>
        ) : (
          <>
            <Target className="h-3.5 w-3.5 shrink-0 text-warn" />
            <span className="min-w-0 flex-1 truncate text-muted">No plan for today yet — the day goes to whatever shouts loudest.</span>
            <Link href="/calendar" className="press flex h-8 shrink-0 items-center rounded-[9px] bg-text px-3 font-medium text-bg">
              Plan my day
            </Link>
          </>
        )}
      </div>
    </div>
  );
}

const b64 = (s: string) => {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

// "Coach on this phone": registers the service worker, asks for permission, subscribes.
export function PushSwitch({ className }: { className?: string }) {
  const [state, setState] = useState<"unsupported" | "off" | "on" | "busy" | "denied">("off");
  const [note, setNote] = useState("");
  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return setState("unsupported");
    if (Notification.permission === "denied") return setState("denied");
    void navigator.serviceWorker.getRegistration("/sw.js").then((r) => r?.pushManager.getSubscription().then((s) => s && setState("on")));
  }, []);

  async function enable() {
    setState("busy");
    setNote("");
    try {
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const perm = await Notification.requestPermission();
      if (perm !== "granted") return setState(perm === "denied" ? "denied" : "off");
      const { publicKey } = await fetch("/api/push").then((r) => r.json());
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(publicKey) }));
      const res = await fetch("/api/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subscription: sub.toJSON() }) });
      if (!res.ok) throw new Error("subscribe failed");
      await fetch("/api/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ test: true }) });
      setState("on");
      setNote("Sent a test push.");
    } catch (e) {
      setState("off");
      setNote(e instanceof Error ? e.message : "Couldn't turn on notifications.");
    }
  }
  async function disable() {
    setState("busy");
    const reg = await navigator.serviceWorker.getRegistration("/sw.js");
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await fetch("/api/push", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) });
      await sub.unsubscribe();
    }
    setState("off");
  }

  if (state === "unsupported") return <p className={cn("text-xs text-faint", className)}>This browser can&apos;t receive pushes. On iPhone, add the dashboard to the Home Screen first.</p>;
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <button
        onClick={() => void (state === "on" ? disable() : enable())}
        disabled={state === "busy" || state === "denied"}
        className={cn("press flex h-10 items-center gap-2 rounded-[11px] px-4 text-sm font-medium", state === "on" ? "border border-ok/40 text-ok" : "bg-text text-bg", "disabled:opacity-50")}
      >
        {state === "busy" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : state === "on" ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
        {state === "on" ? "Coach is on this device" : state === "denied" ? "Notifications blocked in the browser" : "Turn on the Coach here"}
      </button>
      {note && <span className="text-xs text-muted">{note}</span>}
    </div>
  );
}
