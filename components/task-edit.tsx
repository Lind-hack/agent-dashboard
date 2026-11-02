"use client";

import { Flag, LoaderCircle } from "lucide-react";
import { useState } from "react";
import type { Todo } from "@/lib/todos";
import { cn } from "@/lib/utils";

// Edit a task (v5.4, Lind: "edit the task and the colour of the importance"): title, notes, how
// important (the colour it carries on Today), which day, the deadline, the estimate and the goal it
// serves. Used in the day board's sheet and the full task list; saves only what changed.

export const PRIORITIES = [
  { label: "None", hue: 225, tone: "text-faint" },
  { label: "Low", hue: 200, tone: "text-codex" },
  { label: "Medium", hue: 38, tone: "text-warn" },
  { label: "High", hue: 15, tone: "text-bad" },
] as const;
const ESTIMATES = [15, 30, 45, 60, 90, 120, 180, 240];
const field = "h-11 w-full rounded-[11px] border border-line bg-black/30 px-3 text-[15px] outline-none focus:border-line-hi";

export type EditableTask = Pick<Todo, "id" | "title" | "priority" | "estimateMin"> & { notes?: string; day?: string; due?: string; goalId?: string };

export function TaskEdit({ task, goals, onSaved, onCancel }: { task: EditableTask; goals: { id: string; title: string }[]; onSaved: () => void; onCancel: () => void }) {
  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes ?? "");
  const [priority, setPriority] = useState(task.priority);
  const [day, setDay] = useState(task.day ?? "");
  const [dueDay, setDueDay] = useState(task.due?.slice(0, 10) ?? "");
  const [dueTime, setDueTime] = useState(task.due?.includes("T") ? task.due.slice(11, 16) : "");
  const [estimate, setEstimate] = useState(task.estimateMin);
  const [goalId, setGoalId] = useState(task.goalId ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return setErr("A task needs a title.");
    const due = dueDay ? (dueTime ? `${dueDay}T${dueTime}` : dueDay) : "";
    const patch: Record<string, unknown> = {};
    if (title.trim() !== task.title) patch.title = title.trim();
    if (notes.trim() !== (task.notes ?? "")) patch.notes = notes.trim();
    if (priority !== task.priority) patch.priority = priority;
    if (day && day !== task.day) patch.day = day;
    if (due !== (task.due ?? "")) patch.due = due;
    if (estimate !== task.estimateMin) patch.estimateMin = estimate;
    if (goalId !== (task.goalId ?? "")) patch.goalId = goalId;
    if (!Object.keys(patch).length) return onCancel();
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/todos", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: task.id, ...patch }) });
      const out = await res.json().catch(() => null);
      if (!res.ok) throw new Error(out?.error ?? `error ${res.status}`);
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't save it.");
    } finally {
      setBusy(false);
    }
  }

  const known = goals.some((g) => g.id === goalId);
  return (
    <form onSubmit={(e) => void save(e)} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1.5">
        <span className="text-[12px] text-muted">Task</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} className={field} autoFocus />
      </label>

      <div role="radiogroup" aria-label="How important" className="flex flex-col gap-1.5">
        <span className="text-[12px] text-muted">How important</span>
        <div className="grid grid-cols-4 gap-1.5">
          {PRIORITIES.map((p, i) => (
            <button
              key={p.label}
              type="button"
              role="radio"
              aria-checked={priority === i}
              onClick={() => setPriority(i as Todo["priority"])}
              className={cn("press flex h-11 items-center justify-center gap-1.5 rounded-[11px] border text-[13.5px] transition-colors", priority === i ? "border-transparent font-semibold text-white" : "border-line text-muted")}
              style={priority === i ? { background: `hsl(${p.hue} 55% ${i ? 40 : 30}%)` } : undefined}
            >
              <Flag className="h-3.5 w-3.5" fill={i ? "currentColor" : "none"} style={priority === i ? undefined : { color: `hsl(${p.hue} 70% 65%)` }} />
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] text-muted">Day</span>
          <input type="date" value={day} onChange={(e) => setDay(e.target.value)} className={field} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] text-muted">Takes about</span>
          <select value={estimate} onChange={(e) => setEstimate(Number(e.target.value))} className={field}>
            {[...new Set([...ESTIMATES, task.estimateMin])].sort((a, z) => a - z).map((m) => (
              <option key={m} value={m}>
                {m >= 60 ? `${m / 60}h`.replace(".5h", "h 30m") : `${m} min`}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] text-muted">Deadline</span>
          <input type="date" value={dueDay} onChange={(e) => setDueDay(e.target.value)} className={field} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] text-muted">by (time)</span>
          <input type="time" value={dueTime} onChange={(e) => setDueTime(e.target.value)} disabled={!dueDay} className={cn(field, !dueDay && "opacity-40")} />
        </label>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-[12px] text-muted">Goal it serves</span>
        <select value={goalId} onChange={(e) => setGoalId(e.target.value)} className={field}>
          <option value="">None</option>
          {!known && goalId && <option value={goalId}>(current goal)</option>}
          {goals.map((g) => (
            <option key={g.id} value={g.id}>
              {g.title}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-[12px] text-muted">Notes</span>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="rounded-[11px] border border-line bg-black/30 px-3 py-2 text-[15px] outline-none focus:border-line-hi" />
      </label>

      {err && <p className="text-[13px] text-bad">{err}</p>}
      <div className="flex gap-2">
        <button disabled={busy} className="press flex h-12 flex-1 items-center justify-center gap-2 rounded-[14px] bg-text text-[15px] font-semibold text-bg disabled:opacity-60">
          {busy && <LoaderCircle className="h-4 w-4 animate-spin" />} Save
        </button>
        <button type="button" onClick={onCancel} className="press h-12 rounded-[14px] border border-line px-5 text-[15px] text-muted">
          Cancel
        </button>
      </div>
    </form>
  );
}
