"use client";

import { CalendarArrowUp, CalendarClock, Check, ChevronDown, Flag, ListPlus, LoaderCircle, Plus, Target, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Todo } from "@/lib/todos";
import { cn } from "@/lib/utils";
import { Panel, SectionTitle } from "./kit";

// Dashboard tasks on Today (v5): add with an estimate, priority, deadline and goal; tick; break into
// steps; schedule into the next free slot (and onto the calendar); push to tomorrow.

type Lists = { overdue: Todo[]; today: Todo[]; done: Todo[]; later: Todo[] };
type Goal = { id: string; title: string };

const FLAG = ["", "text-codex", "text-warn", "text-bad"];
const PRI = ["None", "Low", "Medium", "High"];
const ESTIMATES = [15, 30, 45, 60, 90, 120, 180];
const fmt = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? `${m % 60}` : ""}` : `${m}m`);
const pct = (t: Todo) => (t.done ? 100 : t.subtasks.length ? Math.round((100 * t.subtasks.filter((s) => s.done).length) / t.subtasks.length) : 0);
const field = "h-9 rounded-[10px] border border-line bg-black/30 px-2.5 text-[13px] outline-none focus:border-line-hi";

async function call(method: string, body: unknown, url = "/api/todos") {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const out = await res.json().catch(() => null);
  if (!res.ok) throw new Error(out?.error ?? `error ${res.status}`);
  return out;
}

export function TodoBoard({ lists, goals, day, tomorrow }: { lists: Lists; goals: Goal[]; day: string; tomorrow: string }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [est, setEst] = useState(30);
  const [pri, setPri] = useState(0);
  const [due, setDue] = useState("");
  const [goalId, setGoalId] = useState("");
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [showDone, setShowDone] = useState(false);
  const goalTitle = new Map(goals.map((g) => [g.id, g.title]));

  async function run(key: string, fn: () => Promise<{ msg?: string; warning?: string } | void>) {
    setBusy(key);
    setMsg(null);
    try {
      const r = await fn();
      if (r?.warning) setMsg({ text: r.warning, bad: true });
      else if (r?.msg) setMsg({ text: r.msg });
      router.refresh();
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : String(e), bad: true });
    } finally {
      setBusy("");
    }
  }

  const add = () =>
    title.trim() &&
    run("add", async () => {
      await call("POST", { title, estimateMin: est, priority: pri, due: due ? (due.length === 5 ? `${day}T${due}` : due) : undefined, goalId: goalId || undefined, day });
      setTitle("");
      setDue("");
      setPri(0);
      setGoalId("");
    });

  const open = [...lists.overdue, ...lists.today];
  const leftMin = open.reduce((s, t) => s + Math.round((t.estimateMin * (100 - pct(t))) / 100), 0);

  return (
    <section id="tasks" className="mt-8 scroll-mt-20">
      <SectionTitle right={`${lists.done.length}/${lists.done.length + open.length} done · ${fmt(leftMin)} left`}>Tasks</SectionTitle>
      <Panel className="overflow-hidden">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
          className="border-b border-line p-3"
        >
          <div className="flex items-center gap-2">
            <ListPlus className="ml-1 h-4 w-4 shrink-0 text-faint" aria-hidden />
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add a task for today…" aria-label="New task" className="h-10 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-faint" />
            <button type="button" onClick={() => setMore((m) => !m)} aria-expanded={more} aria-label="Task details" className="grid h-9 w-9 place-items-center rounded-[10px] text-faint hover:bg-white/5 hover:text-text">
              <ChevronDown className={cn("h-4 w-4 transition-transform", more && "rotate-180")} />
            </button>
            <button type="submit" disabled={!title.trim() || busy === "add"} className="flex h-9 items-center gap-1.5 rounded-[10px] bg-text px-3.5 text-sm font-medium text-bg disabled:opacity-40">
              {busy === "add" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add
            </button>
          </div>
          {more && (
            <div className="rise mt-2 flex flex-wrap items-center gap-2 pl-7">
              <select value={est} onChange={(e) => setEst(Number(e.target.value))} aria-label="Estimate" className={field}>
                {ESTIMATES.map((m) => (
                  <option key={m} value={m}>
                    ~{fmt(m)}
                  </option>
                ))}
              </select>
              <select value={pri} onChange={(e) => setPri(Number(e.target.value))} aria-label="Priority" className={field}>
                {PRI.map((p, i) => (
                  <option key={p} value={i}>
                    {i ? `${p} priority` : "No priority"}
                  </option>
                ))}
              </select>
              <input type="time" value={due.length === 5 ? due : ""} onChange={(e) => setDue(e.target.value)} aria-label="Due by (today)" title="Due by (today)" className={field} />
              {goals.length > 0 && (
                <select value={goalId} onChange={(e) => setGoalId(e.target.value)} aria-label="Goal" className={cn(field, "max-w-[220px]")}>
                  <option value="">No goal</option>
                  {goals.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.title}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}
        </form>

        {msg && <p className={cn("border-b border-line px-4 py-2 text-xs", msg.bad ? "text-bad" : "text-ok")} aria-live="polite">{msg.text}</p>}

        {open.length === 0 && lists.done.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted">Nothing on today&apos;s list. Add what has to get done — the planner and the assistant work from it.</p>
        ) : open.length === 0 ? (
          <p className="flex items-center gap-2 px-5 py-6 text-sm text-ok">
            <Check className="h-4 w-4" /> Today&apos;s list is finished.
          </p>
        ) : (
          <>
            {lists.overdue.length > 0 && <p className="hud-label !text-bad px-4 pt-3 pb-1">Overdue · {lists.overdue.length}</p>}
            {lists.overdue.map((t) => (
              <TodoRow key={t.id} t={t} overdue goal={t.goalId ? goalTitle.get(t.goalId) : undefined} busy={busy} run={run} tomorrow={tomorrow} />
            ))}
            {lists.overdue.length > 0 && lists.today.length > 0 && <p className="hud-label px-4 pt-3 pb-1">Today · {lists.today.length}</p>}
            {lists.today.map((t) => (
              <TodoRow key={t.id} t={t} goal={t.goalId ? goalTitle.get(t.goalId) : undefined} busy={busy} run={run} tomorrow={tomorrow} />
            ))}
          </>
        )}

        {lists.done.length > 0 && (
          <div className="border-t border-line">
            <button onClick={() => setShowDone((s) => !s)} className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-xs text-faint hover:text-text" aria-expanded={showDone}>
              <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", showDone && "rotate-180")} /> Done today · {lists.done.length}
            </button>
            {showDone && lists.done.map((t) => <TodoRow key={t.id} t={t} goal={t.goalId ? goalTitle.get(t.goalId) : undefined} busy={busy} run={run} tomorrow={tomorrow} />)}
          </div>
        )}
      </Panel>
      {lists.later.length > 0 && (
        <p className="mt-2 px-1 text-xs text-faint">
          Later: {lists.later.slice(0, 4).map((t) => `${t.title} (${t.day.slice(5)})`).join(" · ")}
          {lists.later.length > 4 ? ` · +${lists.later.length - 4}` : ""}
        </p>
      )}
    </section>
  );
}

function TodoRow({ t, overdue, goal, busy, run, tomorrow }: { t: Todo; overdue?: boolean; goal?: string; busy: string; run: (k: string, fn: () => Promise<{ msg?: string; warning?: string } | void>) => void; tomorrow: string }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState("");
  const p = pct(t);
  const dueTime = t.due?.includes("T") ? t.due.slice(11) : null;
  return (
    <div className={cn("border-b border-line last:border-0", t.done && "opacity-55")}>
      <div className="flex min-h-14 items-center gap-2 px-2.5 py-2">
        <button onClick={() => run(`done:${t.id}`, () => call("PATCH", { id: t.id, done: !t.done }))} aria-label={t.done ? `Reopen ${t.title}` : `Done: ${t.title}`} className="group grid h-10 w-10 shrink-0 place-items-center rounded-full">
          <span className={cn("grid h-[22px] w-[22px] place-items-center rounded-full border transition-colors", t.done ? "border-ok bg-ok/20" : "border-line-hi group-hover:border-ok group-hover:bg-ok/15")}>
            {busy === `done:${t.id}` ? <LoaderCircle className="h-3 w-3 animate-spin" /> : <Check className={cn("h-3 w-3 text-ok transition-opacity", t.done ? "opacity-100" : "opacity-0 group-hover:opacity-100")} />}
          </span>
        </button>
        <button onClick={() => setOpen((o) => !o)} className="min-w-0 flex-1 text-left" aria-expanded={open}>
          <span className={cn("block truncate text-[15px] leading-snug", t.done && "line-through")}>{t.title}</span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-faint">
            <span className="tnum">~{fmt(t.estimateMin)}</span>
            {dueTime && <span className={cn("tnum", overdue ? "text-bad" : "text-warn")}>due {dueTime}</span>}
            {overdue && !dueTime && <span className="text-bad">from {t.day.slice(5)}</span>}
            {goal && (
              <span className="flex min-w-0 items-center gap-1 text-hermes">
                <Target className="h-3 w-3 shrink-0" aria-hidden />
                <span className="max-w-[160px] truncate">{goal}</span>
              </span>
            )}
            {t.subtasks.length > 0 && <span className="tnum">{t.subtasks.filter((s) => s.done).length}/{t.subtasks.length} steps</span>}
            {t.source !== "dashboard" && <span>{t.source === "ticktick" ? "TickTick" : "assistant"}</span>}
          </span>
          {t.subtasks.length > 0 && !t.done && (
            <span className="mt-1.5 block h-[3px] w-full max-w-[220px] overflow-hidden rounded-full bg-white/[0.07]">
              <span className="block h-full rounded-full bg-ok transition-[width] duration-500" style={{ width: `${p}%` }} />
            </span>
          )}
        </button>
        {t.priority > 0 && <Flag className={cn("h-4 w-4 shrink-0", FLAG[t.priority])} aria-label={`${PRI[t.priority]} priority`} />}
        {!t.done && (
          <button onClick={() => run(`sched:${t.id}`, async () => { const r = await call("PATCH", { id: t.id, schedule: {} }); return { msg: `On the plan at ${r.block?.start}${r.calendar ? " · on your calendar with an alarm" : ""}.` }; })} aria-label={`Schedule ${t.title}`} title="Schedule into the next free slot" className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] text-faint hover:bg-white/5 hover:text-hud">
            {busy === `sched:${t.id}` ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <CalendarClock className="h-4 w-4" />}
          </button>
        )}
      </div>
      {open && (
        <div className="rise flex flex-col gap-1 pr-3 pb-3 pl-[52px]">
          {t.notes && <p className="mb-1 text-[13px] whitespace-pre-wrap text-muted">{t.notes}</p>}
          {t.subtasks.map((s) => (
            <div key={s.id} className="group flex items-center gap-2 text-[13.5px]">
              <button onClick={() => run(`st:${s.id}`, () => call("PATCH", { id: t.id, toggleSubtask: s.id }))} aria-label={s.done ? `Undo ${s.title}` : `Done: ${s.title}`} className={cn("grid h-5 w-5 shrink-0 place-items-center rounded-[6px] border", s.done ? "border-ok bg-ok/20" : "border-line-hi")}>
                {s.done && <Check className="h-3 w-3 text-ok" />}
              </button>
              <span className={cn("min-w-0 flex-1 truncate", s.done && "text-faint line-through")}>{s.title}</span>
              <button onClick={() => run(`rm:${s.id}`, () => call("PATCH", { id: t.id, removeSubtask: s.id }))} aria-label={`Remove step ${s.title}`} className="grid h-7 w-7 place-items-center rounded-[8px] text-faint opacity-0 group-hover:opacity-100 hover:text-bad focus:opacity-100">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!step.trim()) return;
              const s = step;
              setStep("");
              run(`add:${t.id}`, () => call("PATCH", { id: t.id, addSubtask: s }));
            }}
            className="flex items-center gap-2"
          >
            <Plus className="h-3.5 w-3.5 shrink-0 text-faint" aria-hidden />
            <input value={step} onChange={(e) => setStep(e.target.value)} placeholder="Add a step…" aria-label="Add a step" className="h-8 min-w-0 flex-1 bg-transparent text-[13.5px] outline-none placeholder:text-faint" />
          </form>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <select value={t.estimateMin} onChange={(e) => run(`est:${t.id}`, () => call("PATCH", { id: t.id, estimateMin: Number(e.target.value) }))} aria-label="Estimate" className={field}>
              {[...new Set([...ESTIMATES, t.estimateMin])].sort((a, z) => a - z).map((m) => (
                <option key={m} value={m}>
                  ~{fmt(m)}
                </option>
              ))}
            </select>
            <select value={t.priority} onChange={(e) => run(`pri:${t.id}`, () => call("PATCH", { id: t.id, priority: Number(e.target.value) }))} aria-label="Priority" className={field}>
              {PRI.map((p, i) => (
                <option key={p} value={i}>
                  {i ? p : "No priority"}
                </option>
              ))}
            </select>
            {!t.done && (
              <button onClick={() => run(`tmr:${t.id}`, async () => { await call("PATCH", { id: t.id, day: tomorrow, ...(t.due && t.due.slice(0, 10) < tomorrow ? { due: "" } : {}) }); return { msg: `“${t.title}” moved to tomorrow.` }; })} className="flex h-9 items-center gap-1.5 rounded-[10px] px-3 text-[13px] text-muted hover:bg-white/5 hover:text-text">
                <CalendarArrowUp className="h-3.5 w-3.5" /> Tomorrow
              </button>
            )}
            <button onClick={() => run(`del:${t.id}`, async () => { const res = await fetch(`/api/todos?id=${encodeURIComponent(t.id)}`, { method: "DELETE" }); if (!res.ok) throw new Error("Couldn't delete it."); })} className="flex h-9 items-center gap-1.5 rounded-[10px] px-3 text-[13px] text-muted hover:bg-bad/10 hover:text-bad">
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
