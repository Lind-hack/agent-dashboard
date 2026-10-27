"use client";

import { Check, CircleCheck, LoaderCircle, Plus, Save, Target, Trash } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Goal, GoalHorizon } from "@/lib/goals";
import { cn } from "@/lib/utils";
import { Panel } from "./kit";

// Edit 100 - Me/Goals.md from the phone. The file stays the source of truth, so Obsidian can edit it
// too; this just saves the whole list in the same format the planner parses.

const HORIZONS: { value: GoalHorizon; label: string }[] = [
  { value: "now", label: "Now" },
  { value: "short", label: "Short term" },
  { value: "long", label: "Long term" },
];

const field = "rounded-[12px] border border-line bg-black/30 px-3 py-2 text-[14px] outline-none focus:border-line-hi";

type Row = Goal & { key: string };

export function GoalsEditor({ initial }: { initial: Goal[] }) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>(initial.map((g, i) => ({ ...g, key: `${g.id}-${i}` })));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const set = (key: string, patch: Partial<Row>) => setRows((r) => r.map((g) => (g.key === key ? { ...g, ...patch } : g)));
  const activeCount = rows.filter((g) => !g.done && (g.horizon === "now" || g.horizon === "short")).length;

  function add(horizon: GoalHorizon) {
    setRows((r) => [...r, { key: `new-${Date.now()}-${r.length}`, id: "", horizon, title: "", next: "", why: "", done: false }]);
  }

  async function save() {
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch("/api/goals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goals: rows.filter((g) => g.title.trim()) }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) throw new Error(body?.error ?? `error ${res.status}`);
      setRows(((body.goals ?? []) as Goal[]).map((g, i) => ({ ...g, key: `${g.id}-${i}` })));
      setMsg("Saved to 100 - Me/Goals.md. The next plan will use them.");
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {rows.length === 0 && (
        <Panel className="p-5 text-sm leading-relaxed text-muted">
          <p className="text-text">Nothing written down yet.</p>
          <p className="mt-1">
            Pick a small number: up to three active goals drive the daily plan. Long-term goals stay here to remind you why the short ones matter.
          </p>
        </Panel>
      )}

      {rows.map((g) => (
        <Panel key={g.key} className={cn("p-4", g.done && "opacity-60")}>
          <div className="flex items-start gap-3">
            <button
              onClick={() => set(g.key, { done: !g.done })}
              aria-label={g.done ? `Reopen ${g.title}` : `Complete ${g.title}`}
              className="group mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-full"
            >
              <span className={cn("grid h-5 w-5 place-items-center rounded-full border transition-colors", g.done ? "border-ok bg-ok/15" : "border-line-hi group-hover:border-ok")}>
                <Check className={cn("h-3 w-3 text-ok", !g.done && "opacity-0 transition-opacity group-hover:opacity-100")} />
              </span>
            </button>

            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <div className="flex flex-wrap gap-2">
                <select
                  value={g.horizon}
                  onChange={(e) => set(g.key, { horizon: e.target.value as GoalHorizon })}
                  aria-label="Horizon"
                  className={cn(field, "shrink-0")}
                >
                  {HORIZONS.map((h) => (
                    <option key={h.value} value={h.value}>
                      {h.label}
                    </option>
                  ))}
                </select>
                <input
                  value={g.title}
                  onChange={(e) => set(g.key, { title: e.target.value })}
                  placeholder="What are you chasing?"
                  aria-label="Goal"
                  className={cn(field, "min-w-0 flex-1 font-medium")}
                />
              </div>
              <input
                value={g.next}
                onChange={(e) => set(g.key, { next: e.target.value })}
                placeholder="Next action — the one thing that moves it this week"
                aria-label="Next action"
                className={cn(field, "w-full")}
              />
              <div className="flex flex-wrap gap-2">
                <input
                  value={g.why}
                  onChange={(e) => set(g.key, { why: e.target.value })}
                  placeholder="Why it matters"
                  aria-label="Why it matters"
                  className={cn(field, "min-w-0 flex-1")}
                />
                <input
                  type="date"
                  value={g.due ?? ""}
                  onChange={(e) => set(g.key, { due: e.target.value || undefined })}
                  aria-label="Target date"
                  className={cn(field, "shrink-0")}
                />
              </div>
            </div>

            <button
              onClick={() => setRows((r) => r.filter((x) => x.key !== g.key))}
              aria-label={`Remove ${g.title || "goal"}`}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] text-faint hover:bg-white/5 hover:text-bad"
            >
              <Trash className="h-4 w-4" />
            </button>
          </div>
        </Panel>
      ))}

      <div className="flex flex-wrap gap-2">
        {HORIZONS.map((h) => (
          <button
            key={h.value}
            onClick={() => add(h.value)}
            className="flex h-10 items-center gap-2 rounded-[12px] border border-line px-4 text-sm text-muted hover:border-line-hi hover:text-text"
          >
            <Plus className="h-4 w-4" /> {h.label}
          </button>
        ))}
      </div>

      {activeCount > 3 && (
        <p className="px-1 text-xs text-warn">Only the first 3 now/short goals drive the daily plan — park the rest as long term.</p>
      )}

      <div className="mt-1 flex flex-wrap items-center gap-3">
        <button onClick={save} disabled={busy} className="flex h-10 items-center gap-2 rounded-[12px] bg-text px-5 text-sm font-medium text-bg disabled:opacity-40">
          {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save goals
        </button>
        <p className="flex items-center gap-1.5 text-xs text-faint">
          <Target className="h-3.5 w-3.5" aria-hidden /> 100 - Me/Goals.md · up to 3 active goals steer the day
        </p>
      </div>

      {msg && (
        <p className={cn("flex items-center gap-2 text-sm", msg.startsWith("Saved") ? "text-ok" : "text-bad")} aria-live="polite">
          {msg.startsWith("Saved") ? <CircleCheck className="h-4 w-4" /> : null} {msg}
        </p>
      )}
    </div>
  );
}
