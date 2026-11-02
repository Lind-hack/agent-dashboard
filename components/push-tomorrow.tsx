"use client";

import { CalendarArrowUp, Check, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

// "I can't finish these today" (v5.4.1, Lind: tasks move to tomorrow only when he clearly says so).
// Nothing rolls over by itself any more: open tasks stay on today (overdue ones carried and re-planned)
// until he ticks the ones he can't do and pushes them. Opens by itself in the evening and from the
// 21:20 push (#push).

export function PushTomorrow({ tasks, tomorrow }: { tasks: { id: string; title: string; overdue: boolean }[]; tomorrow: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => {
    if (window.location.hash === "#push" || new Date().getHours() >= 20) setOpen(true);
  }, []);
  if (!tasks.length) return null;

  async function push() {
    setBusy(true);
    setErr("");
    try {
      for (const id of picked) {
        const res = await fetch("/api/todos", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, day: tomorrow }) });
        if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "Couldn't move one of them.");
      }
      setPicked(new Set());
      setOpen(false);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "That didn't work.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="push" aria-label="Push tasks to tomorrow" className="panel scroll-mt-24 overflow-hidden">
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center gap-3 px-4 py-3 text-left">
        <CalendarArrowUp className="h-4 w-4 shrink-0 text-muted" />
        <span className="min-w-0 flex-1 text-[14px]">
          Can&apos;t finish something today? <span className="text-muted">Pick it and push it to tomorrow — nothing moves unless you do.</span>
        </span>
        <span className="tnum shrink-0 font-mono text-[11px] text-faint">{tasks.length} open</span>
      </button>
      {open && (
        <div className="border-t border-line px-3 pt-2 pb-3">
          <ul className="flex flex-col">
            {tasks.map((t) => {
              const on = picked.has(t.id);
              return (
                <li key={t.id}>
                  <button
                    onClick={() => setPicked((p) => (p.has(t.id) ? new Set([...p].filter((x) => x !== t.id)) : new Set([...p, t.id])))}
                    aria-pressed={on}
                    className="flex min-h-11 w-full items-center gap-3 rounded-[10px] px-2 text-left text-[15px] hover:bg-white/[0.04]"
                  >
                    <span className={cn("grid h-5 w-5 shrink-0 place-items-center rounded-[6px] border", on ? "border-warn bg-warn/20 text-warn" : "border-line-hi text-transparent")}>
                      <Check className="h-3.5 w-3.5" strokeWidth={3} />
                    </span>
                    <span className="min-w-0 flex-1 truncate">{t.title}</span>
                    {t.overdue && <span className="shrink-0 font-mono text-[10.5px] text-bad">overdue</span>}
                  </button>
                </li>
              );
            })}
          </ul>
          {err && <p className="px-2 pt-1 text-[13px] text-bad">{err}</p>}
          <button onClick={() => void push()} disabled={busy || !picked.size} className="press mt-2 flex h-11 w-full items-center justify-center gap-2 rounded-[12px] bg-text text-[14px] font-semibold text-bg disabled:opacity-40">
            {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <CalendarArrowUp className="h-4 w-4" />}
            {picked.size ? `I can't do ${picked.size === 1 ? "this" : `these ${picked.size}`} today — push to tomorrow` : "Pick what you can't finish"}
          </button>
        </div>
      )}
    </section>
  );
}
