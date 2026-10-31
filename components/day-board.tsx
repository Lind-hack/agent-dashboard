"use client";

import { Check, CheckSquare, Flame, Minus, Plus, RotateCcw, Square, Target, Timer, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { Board, BoardGoal, BoardTask } from "@/lib/day-board";
import type { Habit, HabitDay } from "@/lib/habits";
import { cn } from "@/lib/utils";

// The day board (v5.3, from Lind's habit-tracker reference): habits, tasks and goals as rows that fill
// up as they get done. The ring on the right does the one thing (+1 step, tick, open the goal); the
// row opens a sheet with a big ring and −/+. A week strip on top rings every day. Finished rows turn
// solid and sink to the bottom. Every tap shows at once and syncs after; a failure puts it back.

const HUES = [150, 200, 225, 265, 300, 345, 15, 38];
const ICONS = ["💧", "🏋️", "🏃", "📚", "🧘", "🥗", "✍️", "😴", "🚿", "💊", "🎯", "☀️", "🧠", "📵"];
const SUGGEST: Partial<Habit>[] = [
  { title: "Drink water", icon: "💧", hue: 200, target: 2, step: 0.25, unit: "litres" },
  { title: "Gym", icon: "🏋️", hue: 150 },
  { title: "Read", icon: "📚", hue: 38, target: 20, step: 5, unit: "min" },
  { title: "Healthy meals", icon: "🥗", hue: 15, target: 3, step: 1, unit: "meals" },
  { title: "No phone first hour", icon: "📵", hue: 265 },
];
const PRIORITY_HUE = [225, 200, 38, 15];
const WEEK = ["S", "M", "T", "W", "T", "F", "S"];

const fmtN = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(n < 1 ? 2 : 1).replace(/0$/, ""));
const fmtMin = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}` : `${m}m`);
const vibrate = () => navigator.vibrate?.(8);
const vtName = (id: string) => `row-${id.replace(/[^\w-]/g, "_")}`;

type Row =
  | { kind: "habit"; key: string; hue: number; icon: string; title: string; sub: string; ratio: number; done: boolean; streak: number; h: HabitDay }
  | { kind: "task"; key: string; hue: number; icon: string; title: string; sub: string; ratio: number; done: boolean; streak: number; t: BoardTask }
  | { kind: "goal"; key: string; hue: number; icon: string; title: string; sub: string; ratio: number; done: boolean; streak: number; g: BoardGoal };

function rows(b: Board): Row[] {
  const out: Row[] = [
    ...b.habits.map((h): Row => ({
      kind: "habit",
      key: h.habit.id,
      hue: h.habit.hue,
      icon: h.habit.icon,
      title: h.habit.title,
      sub: `${h.habit.days.length ? h.habit.days.map((d) => WEEK[d]).join(" ") : "Every day"}${h.habit.target !== 1 || h.habit.unit ? ` · ${fmtN(h.value)}/${fmtN(h.habit.target)}${h.habit.unit ? ` ${h.habit.unit}` : ""}` : ""}`,
      ratio: Math.min(1, h.value / h.habit.target),
      done: h.done,
      streak: h.streak,
      h,
    })),
    ...b.tasks.map((t): Row => ({
      kind: "task",
      key: t.id,
      hue: PRIORITY_HUE[t.priority] ?? 225,
      icon: "",
      title: t.title,
      sub: [t.overdue ? "Overdue" : "Task", t.estimateMin ? fmtMin(t.estimateMin) : "", t.subtasks.length ? `${t.subtasks.filter((s) => s.done).length}/${t.subtasks.length} steps` : "", t.due?.includes("T") ? `due ${t.due.slice(11)}` : ""].filter(Boolean).join(" · "),
      ratio: t.done ? 1 : t.percent / 100,
      done: t.done,
      streak: 0,
      t,
    })),
    ...b.goals.map((g): Row => ({
      kind: "goal",
      key: g.id,
      hue: 280,
      icon: "",
      title: g.title,
      sub: `Goal · ${fmtMin(g.weekMin)} of ${fmtMin(g.targetMin)} this week${g.todayMin ? ` · ${fmtMin(g.todayMin)} today` : ""}`,
      ratio: Math.min(1, g.weekMin / Math.max(1, g.targetMin)),
      done: g.weekMin >= g.targetMin,
      streak: g.streak,
      g,
    })),
  ];
  // Open first, finished at the bottom; the original order inside each.
  return [...out.filter((r) => !r.done), ...out.filter((r) => r.done)];
}

// Re-order with the browser's view transition when it has one (rows glide to their new place).
function transition(update: () => void) {
  const d = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  if (d.startViewTransition && !matchMedia("(prefers-reduced-motion: reduce)").matches) d.startViewTransition(() => flushSync(update));
  else update();
}

export function DayBoard({ initial }: { initial: Board }) {
  const router = useRouter();
  const [b, setB] = useState(initial);
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState<Partial<Habit> | null>(null);
  const [err, setErr] = useState("");
  const last = useRef<{ id: string; day: string; value: number } | null>(null);

  useEffect(() => setB(initial), [initial]);

  const load = useCallback(async (day: string) => {
    const r = await fetch(`/api/habits?day=${day}`, { cache: "no-store" }).catch(() => null);
    if (r?.ok) {
      const next = (await r.json()) as Board;
      transition(() => setB(next));
    }
  }, []);

  async function sync(req: Promise<Response>, rollback: Board) {
    const r = await req.catch(() => null);
    if (!r?.ok) {
      const out = await r?.json().catch(() => null);
      setErr(out?.error ?? "Couldn't save that — check the connection.");
      transition(() => setB(rollback));
      return false;
    }
    setErr("");
    void load(b.day);
    if (b.day === b.today) router.refresh();
    return true;
  }

  function stepHabit(h: HabitDay, delta: number) {
    const before = b;
    const value = Math.max(0, Math.min(h.habit.target * 3, Math.round((h.value + delta) * 100) / 100));
    last.current = { id: h.habit.id, day: b.day, value: h.value };
    vibrate();
    transition(() => setB({ ...b, habits: b.habits.map((x) => (x.habit.id === h.habit.id ? { ...x, value, done: value >= x.habit.target } : x)) }));
    void sync(fetch("/api/habits", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: h.habit.id, day: b.day, value }) }), before);
  }

  function undoHabit() {
    const u = last.current;
    if (!u) return;
    const h = b.habits.find((x) => x.habit.id === u.id);
    if (h) stepHabit(h, u.value - h.value);
    last.current = null;
  }

  function toggleTask(t: BoardTask, patch: { done?: boolean; toggleSubtask?: string } = { done: !t.done }) {
    const before = b;
    vibrate();
    transition(() =>
      setB({
        ...b,
        tasks: b.tasks.map((x) => {
          if (x.id !== t.id) return x;
          if (patch.toggleSubtask) {
            const subtasks = x.subtasks.map((s) => (s.id === patch.toggleSubtask ? { ...s, done: !s.done } : s));
            return { ...x, subtasks, percent: Math.round((100 * subtasks.filter((s) => s.done).length) / subtasks.length) };
          }
          return { ...x, done: !!patch.done, percent: patch.done ? 100 : 0 };
        }),
      }),
    );
    void sync(fetch("/api/todos", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: t.id, ...patch }) }), before);
  }

  async function startGoal(g: BoardGoal, minutes = 25) {
    vibrate();
    const r = await fetch("/api/coach", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "focus", goalId: g.id, minutes }) }).catch(() => null);
    const out = await r?.json().catch(() => null);
    if (!r?.ok) return setErr(out?.error ?? "Couldn't start it.");
    router.push(`/focus?block=${encodeURIComponent(out.block.id)}`);
  }

  async function saveHabit(h: Partial<Habit>) {
    const r = await fetch("/api/habits", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ habit: h }) }).catch(() => null);
    const out = await r?.json().catch(() => null);
    if (!r?.ok) return setErr(out?.error ?? "Couldn't save the habit.");
    setAdding(null);
    void load(b.day);
  }

  async function archive(id: string) {
    await fetch(`/api/habits?id=${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => null);
    setOpen(null);
    void load(b.day);
  }

  const list = rows(b);
  const sel = list.find((r) => r.key === open) ?? null;
  const dayDone = list.length ? list.filter((r) => r.done).length : 0;

  return (
    <section aria-label="Habits, tasks and goals" className="mt-6">
      <div className="mb-3 flex items-end justify-between gap-3 px-1">
        <div>
          <h2 className="text-xl font-semibold tracking-[-0.02em]">{b.day === b.today ? "Today" : new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "long", day: "numeric", month: "short" }).format(new Date(`${b.day}T12:00:00Z`))}</h2>
          <p className="tnum text-xs text-muted">
            {list.length ? `${dayDone} of ${list.length} done` : "Nothing yet"}
            {b.habits.length ? ` · ${b.habits.filter((h) => h.done).length}/${b.habits.length} habits` : ""}
          </p>
        </div>
        <button onClick={() => setAdding({ hue: HUES[0], icon: ICONS[0], target: 1, step: 1, unit: "", days: [] })} aria-label="New habit" className="press grid h-10 w-10 place-items-center rounded-full border border-line text-muted hover:text-text">
          <Plus className="h-5 w-5" />
        </button>
      </div>

      <WeekStrip week={b.week} day={b.day} today={b.today} onPick={(d) => void load(d)} />

      {err && <p className="mt-3 rounded-[12px] border border-bad/30 bg-bad/10 px-3 py-2 text-[13px] text-bad">{err}</p>}

      {list.length === 0 ? (
        <div className="panel mt-3 p-4">
          <p className="text-[15px]">Nothing on this day yet.</p>
          <p className="mt-1 text-[13px] text-muted">Start with a habit — one tap adds it:</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {SUGGEST.map((s) => (
              <button key={s.title} onClick={() => void saveHabit(s)} className="press flex h-9 items-center gap-1.5 rounded-full border border-line px-3 text-[13px] hover:border-line-hi">
                <span aria-hidden>{s.icon}</span> {s.title}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {list.map((r) => (
            <li key={`${r.kind}:${r.key}`} style={{ viewTransitionName: vtName(`${r.kind}-${r.key}`) }}>
              <RowCard
                r={r}
                onOpen={() => setOpen(r.key)}
                onRing={() => (r.kind === "habit" ? stepHabit(r.h, r.done ? -r.h.value : r.h.habit.step) : r.kind === "task" ? toggleTask(r.t) : setOpen(r.key))}
              />
            </li>
          ))}
        </ul>
      )}

      {sel && (
        <Sheet onClose={() => setOpen(null)} label={sel.title}>
          <Detail
            r={sel}
            onStep={(d) => sel.kind === "habit" && stepHabit(sel.h, d)}
            onUndo={last.current?.id === sel.key ? undoHabit : undefined}
            onTask={(p) => sel.kind === "task" && toggleTask(sel.t, p)}
            onGoal={(m) => sel.kind === "goal" && void startGoal(sel.g, m)}
            onEdit={() => {
              if (sel.kind !== "habit") return;
              setOpen(null);
              setAdding(sel.h.habit);
            }}
            onArchive={() => sel.kind === "habit" && void archive(sel.h.habit.id)}
          />
        </Sheet>
      )}

      {adding && (
        <Sheet onClose={() => setAdding(null)} label={adding.id ? "Edit habit" : "New habit"}>
          <HabitForm initial={adding} onSave={(h) => void saveHabit(h)} />
        </Sheet>
      )}
    </section>
  );
}

function Ring({ ratio, size, stroke, hue, done, children, className }: { ratio: number; size: number; stroke: number; hue: number; done?: boolean; children?: React.ReactNode; className?: string }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <span className={cn("relative grid shrink-0 place-items-center", className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="absolute inset-0 -rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={done ? "rgb(255 255 255 / 0.35)" : `hsl(${hue} 45% 55% / 0.22)`} strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={done ? "#fff" : `hsl(${hue} 75% 66%)`}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - Math.max(0, Math.min(1, ratio)))}
          className="transition-[stroke-dashoffset] duration-500 ease-[var(--ease-out-expo)] motion-reduce:transition-none"
        />
      </svg>
      {children}
    </span>
  );
}

function RowCard({ r, onOpen, onRing }: { r: Row; onOpen: () => void; onRing: () => void }) {
  const Icon = r.kind === "goal" ? Target : r.done ? CheckSquare : Square;
  return (
    <div
      className={cn("relative isolate flex min-h-[68px] items-center gap-3 overflow-hidden rounded-[18px] pr-2.5 pl-3.5 transition-colors duration-300", r.done && "shadow-[0_0_0_1px_rgb(255_255_255/0.08)_inset]")}
      style={{ background: r.done ? `hsl(${r.hue} 55% 34%)` : `hsl(${r.hue} 28% 13%)` }}
    >
      {/* The fill: the row is a progress bar. */}
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 -z-10 transition-[width] duration-500 ease-[var(--ease-out-expo)] motion-reduce:transition-none"
        style={{ width: `${r.done ? 100 : r.ratio * 100}%`, background: `hsl(${r.hue} 45% 24%)` }}
      />
      <button onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 py-3 text-left" aria-label={`${r.title}: ${r.sub}. Open`}>
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[12px] bg-black/20 text-[20px]" aria-hidden>
          {r.icon || <Icon className="h-[18px] w-[18px]" style={{ color: `hsl(${r.hue} 80% 78%)` }} />}
        </span>
        <span className="min-w-0 flex-1">
          <span className={cn("block truncate text-[16px] leading-snug font-medium", r.done && r.kind === "task" && "line-through decoration-white/40")}>{r.title}</span>
          <span className="mt-0.5 flex items-center gap-1.5 truncate text-[12.5px] text-white/60">
            {r.streak > 1 && (
              <span className="flex shrink-0 items-center gap-0.5 text-warn">
                <Flame className="h-3 w-3" aria-hidden />
                {r.streak}
              </span>
            )}
            <span className="truncate">{r.sub}</span>
          </span>
        </span>
      </button>
      <button
        onClick={onRing}
        aria-label={r.kind === "habit" ? (r.done ? `Undo ${r.title}` : `Log ${r.title}`) : r.kind === "task" ? (r.done ? `Mark ${r.title} not done` : `Tick ${r.title}`) : `Open ${r.title}`}
        className="press grid h-12 w-12 shrink-0 place-items-center rounded-full"
      >
        <Ring ratio={r.done ? 1 : r.ratio} size={42} stroke={3.5} hue={r.hue} done={r.done}>
          {r.done ? <Check key="done" className="check-pop h-5 w-5 text-white" strokeWidth={3} /> : r.kind === "goal" ? <Timer className="h-[18px] w-[18px] text-white/85" /> : r.kind === "task" ? <Check className="h-5 w-5 text-white/45" strokeWidth={2.5} /> : <Plus className="h-5 w-5 text-white/85" />}
        </Ring>
      </button>
    </div>
  );
}

function WeekStrip({ week, day, today, onPick }: { week: Board["week"]; day: string; today: string; onPick: (d: string) => void }) {
  return (
    <div className="grid grid-cols-7 gap-1" role="tablist" aria-label="Week">
      {week.map((w) => {
        const d = new Date(`${w.day}T12:00:00Z`);
        const active = w.day === day;
        return (
          <button
            key={w.day}
            role="tab"
            aria-selected={active}
            aria-label={`${new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "long", day: "numeric" }).format(d)}: ${Math.round(w.ratio * 100)}% done`}
            onClick={() => onPick(w.day)}
            className={cn("press flex flex-col items-center gap-1 rounded-[14px] py-2 transition-colors", active ? "bg-hud/15 text-text" : "text-muted hover:bg-white/[0.04]")}
          >
            <span className={cn("text-[11px]", w.day === today && "font-semibold text-hud")}>{new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short" }).format(d)}</span>
            <Ring ratio={w.items ? w.ratio : 0} size={34} stroke={3} hue={w.ratio >= 1 ? 150 : 195} done={false}>
              <span className="tnum text-[12.5px] font-medium">{d.getUTCDate()}</span>
            </Ring>
          </button>
        );
      })}
    </div>
  );
}

function Sheet({ onClose, label, children }: { onClose: () => void; label: string; children: React.ReactNode }) {
  const [drag, setDrag] = useState(0);
  const start = useRef<number | null>(null);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    const html = document.documentElement;
    const was = html.style.overflow;
    html.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", k);
      html.style.overflow = was;
    };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center lg:items-center" role="dialog" aria-modal="true" aria-label={label}>
      <button aria-label="Close" onClick={onClose} className="palette-scrim absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div
        className="sheet-up relative max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-[26px] border-t border-line bg-bg-raised pb-[max(1.25rem,env(safe-area-inset-bottom))] lg:rounded-[26px] lg:border"
        style={{ transform: drag ? `translateY(${drag}px)` : undefined, transition: start.current === null ? "transform 300ms var(--ease-out-expo)" : "none" }}
      >
        {/* Drag the handle down to close. */}
        <div
          className="flex cursor-grab touch-none justify-center pt-3 pb-2"
          onPointerDown={(e) => {
            start.current = e.clientY;
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => start.current !== null && setDrag(Math.max(0, e.clientY - start.current))}
          onPointerUp={() => {
            const far = drag > 90;
            start.current = null;
            setDrag(0);
            if (far) onClose();
          }}
        >
          <span className="h-1.5 w-10 rounded-full bg-white/20" />
        </div>
        <button onClick={onClose} aria-label="Close" className="absolute top-3 right-3 grid h-9 w-9 place-items-center rounded-full text-muted hover:bg-white/5 hover:text-text">
          <X className="h-4 w-4" />
        </button>
        <div className="px-5">{children}</div>
      </div>
    </div>
  );
}

function Detail({
  r,
  onStep,
  onUndo,
  onTask,
  onGoal,
  onEdit,
  onArchive,
}: {
  r: Row;
  onStep: (delta: number) => void;
  onUndo?: () => void;
  onTask: (p: { done?: boolean; toggleSubtask?: string }) => void;
  onGoal: (minutes: number) => void;
  onEdit: () => void;
  onArchive: () => void;
}) {
  // The big ring fits beside −/+ on any phone: 220px, less on narrow screens.
  const [size, setSize] = useState(220);
  useEffect(() => setSize(Math.max(150, Math.min(220, window.innerWidth - 176))), []);
  const big = (
    <Ring ratio={r.done ? 1 : r.ratio} size={size} stroke={size > 190 ? 16 : 13} hue={r.hue} done={false} className="mx-auto">
      <span className="text-center">
        {r.kind === "habit" ? (
          <>
            <span className="tnum block text-[40px] leading-none font-semibold tracking-[-0.03em]">{fmtN(r.h.value)}</span>
            <span className="mt-1 block text-[13px] text-muted">
              of {fmtN(r.h.habit.target)} {r.h.habit.unit || (r.h.habit.target === 1 ? "time" : "")}
            </span>
          </>
        ) : r.kind === "task" ? (
          <span className="tnum block text-[40px] leading-none font-semibold tracking-[-0.03em]">{r.done ? 100 : r.t.percent}%</span>
        ) : (
          <>
            <span className="tnum block text-[34px] leading-none font-semibold tracking-[-0.03em]">{fmtMin(r.g.weekMin)}</span>
            <span className="mt-1 block text-[13px] text-muted">of {fmtMin(r.g.targetMin)} this week</span>
          </>
        )}
      </span>
    </Ring>
  );
  return (
    <div>
      <div className="pr-8 text-center">
        <p className="text-[22px] leading-tight font-semibold tracking-[-0.02em]">
          {r.icon && <span className="mr-1.5" aria-hidden>{r.icon}</span>}
          {r.title}
        </p>
        <p className="mt-1 text-[13px] text-muted">
          {r.sub}
          {r.streak > 1 ? ` · ${r.streak}-day streak` : ""}
        </p>
      </div>

      {r.kind === "habit" ? (
        <div className="mt-6 flex items-center justify-between gap-2">
          <button onClick={() => onStep(-r.h.habit.step)} disabled={r.h.value <= 0} aria-label="One step back" className="press grid h-14 w-14 place-items-center rounded-full bg-white/[0.07] text-text disabled:opacity-30">
            <Minus className="h-6 w-6" />
          </button>
          {big}
          <button onClick={() => onStep(r.h.habit.step)} aria-label={`Add ${fmtN(r.h.habit.step)} ${r.h.habit.unit}`} className="press grid h-14 w-14 place-items-center rounded-full text-black" style={{ background: `hsl(${r.hue} 75% 66%)` }}>
            <Plus className="h-6 w-6" />
          </button>
        </div>
      ) : (
        <div className="mt-6">{big}</div>
      )}

      {r.kind === "habit" && (
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          {!r.done && (
            <button onClick={() => onStep(r.h.habit.target - r.h.value)} className="press h-11 rounded-[12px] px-4 text-[14px] font-medium text-black" style={{ background: `hsl(${r.hue} 75% 66%)` }}>
              Complete
            </button>
          )}
          {onUndo && (
            <button onClick={onUndo} className="press flex h-11 items-center gap-1.5 rounded-[12px] border border-line px-4 text-[14px] text-muted hover:text-text">
              <RotateCcw className="h-4 w-4" /> Undo
            </button>
          )}
          <button onClick={onEdit} className="press h-11 rounded-[12px] border border-line px-4 text-[14px] text-muted hover:text-text">
            Edit
          </button>
          <button onClick={onArchive} aria-label="Remove this habit" className="press grid h-11 w-11 place-items-center rounded-[12px] border border-line text-muted hover:text-bad">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      )}

      {r.kind === "task" && (
        <div className="mt-6">
          {r.t.subtasks.length > 0 && (
            <ul className="mb-4 flex flex-col">
              {r.t.subtasks.map((s) => (
                <li key={s.id}>
                  <button onClick={() => onTask({ toggleSubtask: s.id })} className="flex min-h-11 w-full items-center gap-3 rounded-[10px] px-2 text-left text-[15px] hover:bg-white/[0.04]">
                    {s.done ? <CheckSquare className="h-5 w-5 shrink-0 text-ok" /> : <Square className="h-5 w-5 shrink-0 text-muted" />}
                    <span className={cn(s.done && "text-muted line-through")}>{s.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button onClick={() => onTask({ done: !r.done })} className={cn("press h-12 w-full rounded-[14px] text-[15px] font-medium", r.done ? "border border-line text-muted" : "bg-text text-bg")}>
            {r.done ? "Mark not done" : "Done"}
          </button>
        </div>
      )}

      {r.kind === "goal" && (
        <div className="mt-6">
          {r.g.next && <p className="mb-3 text-center text-[14px] text-muted">Next: {r.g.next}</p>}
          <div className="grid grid-cols-3 gap-2">
            {[25, 50, 90].map((m) => (
              <button key={m} onClick={() => onGoal(m)} className={cn("press h-12 rounded-[14px] text-[15px] font-medium", m === 25 ? "text-black" : "border border-line text-text")} style={m === 25 ? { background: `hsl(${r.hue} 75% 70%)` } : undefined}>
                Start {m}m
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function HabitForm({ initial, onSave }: { initial: Partial<Habit>; onSave: (h: Partial<Habit>) => void }) {
  const [h, setH] = useState<Partial<Habit>>(initial);
  const set = (p: Partial<Habit>) => setH((x) => ({ ...x, ...p }));
  const counted = (h.target ?? 1) !== 1 || !!h.unit;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave(h);
      }}
      className="flex flex-col gap-4"
    >
      <p className="text-[20px] font-semibold tracking-[-0.02em]">{h.id ? "Edit habit" : "New habit"}</p>
      <div className="flex items-center gap-2 rounded-[14px] border border-line px-3" style={{ background: `hsl(${h.hue ?? 150} 28% 13%)` }}>
        <span className="text-[22px]" aria-hidden>
          {h.icon}
        </span>
        <input autoFocus value={h.title ?? ""} onChange={(e) => set({ title: e.target.value })} placeholder="Drink water, gym, read…" aria-label="Habit name" className="h-12 min-w-0 flex-1 bg-transparent text-[16px] focus:outline-none" />
      </div>
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Icon">
        {ICONS.map((i) => (
          <button key={i} type="button" role="radio" aria-checked={h.icon === i} onClick={() => set({ icon: i })} className={cn("press grid h-10 w-10 place-items-center rounded-[11px] text-[19px]", h.icon === i ? "bg-white/15 ring-1 ring-white/40" : "bg-white/[0.04]")}>
            {i}
          </button>
        ))}
      </div>
      <div className="flex gap-2" role="radiogroup" aria-label="Colour">
        {HUES.map((x) => (
          <button key={x} type="button" role="radio" aria-checked={h.hue === x} aria-label={`Colour ${x}`} onClick={() => set({ hue: x })} className={cn("press h-8 w-8 rounded-full", h.hue === x && "ring-2 ring-white ring-offset-2 ring-offset-bg-raised")} style={{ background: `hsl(${x} 65% 55%)` }} />
        ))}
      </div>
      <div className="flex rounded-[12px] bg-white/[0.05] p-1 text-[14px]" role="radiogroup" aria-label="How it's counted">
        {[
          ["Just do it", false],
          ["Count it", true],
        ].map(([l, v]) => (
          <button key={String(l)} type="button" role="radio" aria-checked={counted === v} onClick={() => set(v ? { target: 2, step: 1, unit: h.unit || "times" } : { target: 1, step: 1, unit: "" })} className={cn("h-10 flex-1 rounded-[9px]", counted === v ? "bg-white/15 font-medium" : "text-muted")}>
            {String(l)}
          </button>
        ))}
      </div>
      {counted && (
        <div className="grid grid-cols-3 gap-2">
          <label className="flex flex-col gap-1 text-[12px] text-muted">
            Daily target
            <input type="number" inputMode="decimal" min={0.1} step="any" value={h.target ?? 1} onChange={(e) => set({ target: Number(e.target.value) })} className="h-11 rounded-[11px] border border-line bg-transparent px-3 text-[16px] text-text" />
          </label>
          <label className="flex flex-col gap-1 text-[12px] text-muted">
            Unit
            <input value={h.unit ?? ""} onChange={(e) => set({ unit: e.target.value })} placeholder="litres" className="h-11 rounded-[11px] border border-line bg-transparent px-3 text-[16px] text-text" />
          </label>
          <label className="flex flex-col gap-1 text-[12px] text-muted">
            Each tap adds
            <input type="number" inputMode="decimal" min={0.01} step="any" value={h.step ?? 1} onChange={(e) => set({ step: Number(e.target.value) })} className="h-11 rounded-[11px] border border-line bg-transparent px-3 text-[16px] text-text" />
          </label>
        </div>
      )}
      <div>
        <p className="mb-1.5 text-[12px] text-muted">Days {h.days?.length ? "" : "· every day"}</p>
        <div className="grid grid-cols-7 gap-1.5">
          {WEEK.map((w, i) => {
            const on = h.days?.includes(i);
            return (
              <button key={i} type="button" aria-pressed={!!on} aria-label={["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][i]} onClick={() => setH((x) => ({ ...x, days: x.days?.includes(i) ? x.days.filter((d) => d !== i) : [...(x.days ?? []), i] }))} className={cn("press h-10 rounded-[10px] text-[14px]", on ? "bg-white/15 font-medium text-text" : "bg-white/[0.04] text-muted")}>
                {w}
              </button>
            );
          })}
        </div>
      </div>
      <button type="submit" disabled={!h.title?.trim()} className="press h-12 rounded-[14px] bg-text text-[15px] font-medium text-bg disabled:opacity-40">
        {h.id ? "Save" : "Add habit"}
      </button>
    </form>
  );
}
