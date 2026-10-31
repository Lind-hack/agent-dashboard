"use client";

import { Check, CircleDashed, LoaderCircle, Plane, RotateCcw, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { AutopilotDay, Step } from "@/lib/autopilot";
import { cn } from "@/lib/utils";

// Autopilot on Today (v5.1): the three steps it takes on its own — morning plan, midday re-plan,
// evening rollover — what each did, and one tap to undo it. A switch turns the whole thing off.

const STEPS: { key: Step; label: string; at: string }[] = [
  { key: "morning", label: "Morning plan", at: "07:30" },
  { key: "midday", label: "Midday re-plan", at: "13:00" },
  { key: "evening", label: "Evening rollover", at: "21:20" },
];

export function AutopilotStrip({ initial, enabled: initialEnabled, highlight }: { initial: AutopilotDay; enabled: boolean; highlight?: string }) {
  const router = useRouter();
  const [day, setDay] = useState(initial);
  const [enabled, setEnabled] = useState(initialEnabled);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);

  async function post(body: unknown, key: string) {
    setBusy(key);
    setMsg(null);
    try {
      const res = await fetch("/api/autopilot", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const r = await res.json().catch(() => null);
      if (!res.ok) throw new Error(r?.error ?? `error ${res.status}`);
      if (typeof r.enabled === "boolean") setEnabled(r.enabled);
      if (r.steps) setDay({ day: r.day, steps: r.steps });
      if (r.warning) setMsg({ text: `Undone, but ${r.warning}`, bad: true });
      else if (key.startsWith("undo")) setMsg({ text: "Undone — your plan and tasks are back as they were." });
      router.refresh();
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : String(e), bad: true });
    } finally {
      setBusy("");
    }
  }

  return (
    <section id="autopilot" aria-label="Autopilot" className={cn("panel mt-6 scroll-mt-20 overflow-hidden", highlight && "ring-1 ring-hud/40")}>
      <div className="flex items-center gap-3 border-b border-line px-4 py-3">
        <Plane className={cn("h-4 w-4", enabled ? "text-hud" : "text-faint")} aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-medium">Autopilot</span>
          <span className="block truncate text-[11.5px] text-faint">{enabled ? "plans, re-plans and rolls over your day on its own · every step can be undone" : "off — the day only changes when you change it"}</span>
        </span>
        <button role="switch" aria-checked={enabled} aria-label="Autopilot" onClick={() => void post({ enabled: !enabled }, "toggle")} disabled={busy === "toggle"} className="switch" style={{ ["--sw" as string]: "var(--color-hud)" }} />
      </div>
      <ol className="grid sm:grid-cols-3">
        {STEPS.map((s) => {
          const l = day.steps[s.key];
          const undone = !!l?.undoneAt;
          const canUndo = l && !l.skipped && !l.failed && !undone && !!(l.blocks || l.moved);
          return (
            <li key={s.key} className={cn("flex flex-col gap-1.5 border-line px-4 py-3 sm:border-r sm:last:border-r-0 max-sm:border-b max-sm:last:border-b-0", highlight === s.key && "bg-hud/[0.05]")}>
              <p className="flex items-center gap-2 text-[13px]">
                {!l ? <CircleDashed className="h-3.5 w-3.5 text-faint" /> : l.failed || l.skipped === "gave-up" ? <TriangleAlert className="h-3.5 w-3.5 text-warn" /> : <Check className="h-3.5 w-3.5 text-ok" />}
                <span className="font-medium">{s.label}</span>
                <span className="ml-auto font-mono text-[10.5px] text-faint">{l ? new Date(l.at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : s.at}</span>
              </p>
              <p className={cn("line-clamp-3 text-[12.5px] leading-snug", l ? "text-muted" : "text-faint")}>
                {!l ? (enabled ? `Runs at ${s.at}.` : "Off.") : undone ? "Undone." : l.failed ? `${l.summary} Trying again shortly.` : l.summary}
              </p>
              {l?.error && (l.blocks || l.moved) ? <p className="text-[11px] text-warn">{l.error}</p> : null}
              {canUndo && (
                <button onClick={() => void post({ undo: s.key }, `undo:${s.key}`)} disabled={!!busy} className="mt-auto flex h-8 items-center gap-1.5 self-start rounded-[9px] border border-line px-2.5 text-[12px] text-muted hover:border-line-hi hover:text-text">
                  {busy === `undo:${s.key}` ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />} Undo
                </button>
              )}
            </li>
          );
        })}
      </ol>
      {msg && <p className={cn("border-t border-line px-4 py-2 text-[12.5px]", msg.bad ? "text-bad" : "text-ok")} aria-live="polite">{msg.text}</p>}
    </section>
  );
}
