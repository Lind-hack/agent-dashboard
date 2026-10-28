"use client";

import { CalendarPlus, Check, ChevronDown, CircleCheck, Flag, ListTodo, LoaderCircle, Sparkles, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { EventDraft, PlanBlock } from "@/lib/calendar";
import type { Capture } from "@/lib/capture";
import type { Task, TaskDraft } from "@/lib/ticktick";
import { cn } from "@/lib/utils";
import { Panel } from "./kit";
import { ReplyBar } from "./reply-bar";

// Client pieces of the Today page: plan-my-day, the TickTick list, capture, and the TickTick connect form.

async function post<T>(url: string, body: unknown, method = "POST"): Promise<T> {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const out = await res.json().catch(() => null);
  if (!res.ok) throw new Error(out?.error ?? `error ${res.status}`);
  return out as T;
}

const field = "rounded-[12px] border border-line bg-black/30 px-3 py-2 text-[15px] outline-none focus:border-line-hi";

export const KIND_STYLE: Record<PlanBlock["kind"], { label: string; bar: string; text: string }> = {
  task: { label: "Task", bar: "bg-codex", text: "text-codex" },
  focus: { label: "Focus", bar: "bg-hermes", text: "text-hermes" },
  break: { label: "Break", bar: "bg-opencode", text: "text-opencode" },
  routine: { label: "Routine", bar: "bg-faint", text: "text-muted" },
};

type Plan = { blocks: PlanBlock[]; summary: string; day: string; tz: string };

export function PlanDay({ canWrite, planned }: { canWrite: boolean; planned: number }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [busy, setBusy] = useState<"" | "plan" | "apply">("");
  const [msg, setMsg] = useState("");
  const [open, setOpen] = useState(!planned);

  async function make() {
    setBusy("plan");
    setMsg("");
    try {
      setPlan(await post<Plan>("/api/plan", { note }));
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  async function apply() {
    if (!plan) return;
    setBusy("apply");
    setMsg("");
    try {
      const res = await fetch("/api/plan/apply", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...plan, note }) });
      const r = (await res.json().catch(() => null)) as { ok?: boolean; vault?: boolean; calendar?: boolean; error?: string; stored?: boolean } | null;
      if (!res.ok || !r?.ok) {
        setMsg(`${r?.error ?? `error ${res.status}`}${r?.stored ? " The plan itself is saved on Today." : ""}`);
        if (r?.stored) {
          setPlan(null);
          setNote("");
          setOpen(false);
          router.refresh();
        }
        return;
      }
      setPlan(null);
      setNote("");
      setOpen(false);
      setMsg(
        r.calendar
          ? r.vault
            ? "On your calendar and saved to Obsidian (100 - Me/plans)."
            : "On your calendar. The Obsidian note was skipped — the vault isn't writable yet."
          : r.vault
            ? "Saved to Today and Obsidian. Connect Google Calendar to put it on the calendar too."
            : "Saved to Today. Connect Google Calendar and the vault to mirror it.",
      );
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  return (
    <Panel id="plan" className="relative scroll-mt-24 p-4">
      {!open ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="flex items-center gap-2 text-sm font-medium">
              <Sparkles className="h-3.5 w-3.5 text-hud" strokeWidth={1.75} aria-hidden /> {planned ? "The plan is set" : "Plan my day"}
            </p>
            <p className="mt-0.5 text-xs leading-relaxed text-faint">Re-planning keeps your ticks and only fills the remaining time.</p>
          </div>
          <button
            onClick={() => setOpen(true)}
            aria-controls="plan-body"
            className="flex h-9 items-center gap-1.5 rounded-[10px] border border-line px-3 text-xs text-muted transition-colors hover:border-line-hi hover:text-text"
          >
            {planned ? "Re-plan" : "Plan"} <ChevronDown className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      ) : (
        <div id="plan-body">
          <div className="flex items-center justify-between gap-3">
            <p className="hud-label flex items-center gap-2">
              <Sparkles className="h-3.5 w-3.5 text-hud" strokeWidth={1.75} aria-hidden /> {planned ? "Re-plan the rest of today" : "Plan my day"}
            </p>
            {planned > 0 && (
              <button onClick={() => setOpen(false)} aria-controls="plan-body" className="text-xs text-faint transition-colors hover:text-text">
                Close
              </button>
            )}
          </div>
          {!plan ? (
            <>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                placeholder="Anything about today? “Gym at 6, finish the Bota PR, light evening.”"
                className={`${field} mt-3 w-full resize-none [field-sizing:content]`}
              />
              <button
                onClick={make}
                disabled={!!busy}
                className="mt-3 flex h-10 items-center gap-2 rounded-[12px] bg-text px-5 text-sm font-medium text-bg disabled:opacity-40"
              >
                {busy === "plan" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {busy === "plan" ? "Planning…" : planned ? "Re-plan from now" : "Plan my day"}
              </button>
            </>
          ) : (
            <div className="rise mt-3">
              {plan.summary && <p className="text-[15px] leading-relaxed">{plan.summary}</p>}
              {plan.blocks.length === 0 ? (
                <p className="mt-2 text-sm text-muted">No blocks fit. Try again with a note about what matters.</p>
              ) : (
                <ol className="mt-4 flex flex-col gap-1.5">
                  {plan.blocks.map((b, i) => (
                    <li key={`${b.start}-${i}`} className="flex items-center gap-3 rounded-[12px] bg-white/[0.03] py-2 pr-1 pl-3">
                      <span className={cn("h-8 w-[3px] shrink-0 rounded-full", KIND_STYLE[b.kind].bar)} aria-hidden />
                      <span className="tnum w-[92px] shrink-0 font-mono text-[12px] text-muted">
                        {b.start}–{b.end}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px]">{b.title}</span>
                        <span className={cn("text-[11px]", KIND_STYLE[b.kind].text)}>
                          {KIND_STYLE[b.kind].label}
                          {b.taskId && " · from TickTick"}
                        </span>
                      </span>
                      <button
                        onClick={() => setPlan({ ...plan, blocks: plan.blocks.filter((_, j) => j !== i) })}
                        aria-label={`Remove ${b.title}`}
                        className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] text-faint hover:bg-white/5 hover:text-text"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </li>
                  ))}
                </ol>
              )}
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  onClick={apply}
                  disabled={!!busy || !plan.blocks.length}
                  className="flex h-10 items-center gap-2 rounded-[12px] bg-text px-5 text-sm font-medium text-bg disabled:opacity-40"
                >
                  {busy === "apply" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <CalendarPlus className="h-4 w-4" />} {canWrite ? "Put on my calendar" : "Keep this plan"}
                </button>
                <button onClick={make} disabled={!!busy} className="h-10 rounded-[12px] px-4 text-sm text-muted hover:bg-white/5 hover:text-text">
                  {busy === "plan" ? "Planning…" : "Try again"}
                </button>
                <button onClick={() => setPlan(null)} disabled={!!busy} className="h-10 rounded-[12px] px-4 text-sm text-muted hover:bg-white/5 hover:text-text">
                  Discard
                </button>
              </div>
              {!canWrite && <p className="mt-2 text-xs text-faint">Google Calendar isn&apos;t connected — the plan is still saved on Today and in Obsidian.</p>}
            </div>
          )}
        </div>
      )}
      {msg && (
        <p className="mt-3 text-sm text-muted" aria-live="polite">
          {msg}
        </p>
      )}
    </Panel>
  );
}

const FLAG: Record<number, string> = { 5: "text-bad", 3: "text-warn", 1: "text-codex" };

export function TaskList({ groups }: { groups: { label: string; tone?: "bad"; tasks: Task[] }[] }) {
  const [done, setDone] = useState<Set<string>>(new Set());
  const [err, setErr] = useState("");
  async function complete(t: Task) {
    setDone((d) => new Set(d).add(t.id));
    setErr("");
    try {
      await post("/api/ticktick/tasks", { projectId: t.projectId, id: t.id }, "PATCH");
    } catch (e) {
      setDone((d) => {
        const n = new Set(d);
        n.delete(t.id);
        return n;
      });
      setErr(e instanceof Error ? e.message : String(e));
    }
  }
  const when = (t: Task) => (t.allDay || !t.due ? "" : new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" }).format(new Date(t.due)));
  const shown = groups.map((g) => ({ ...g, tasks: g.tasks.filter((t) => !done.has(t.id)) })).filter((g) => g.tasks.length);
  return (
    <Panel className="overflow-hidden">
      {err && <p className="border-b border-line px-4 py-2 text-xs text-bad">{err}</p>}
      {shown.length === 0 ? (
        <p className="flex items-center gap-2 px-5 py-6 text-sm text-muted">
          <CircleCheck className="h-4 w-4 text-ok" /> Nothing open for today. Nice.
        </p>
      ) : (
        shown.map((g) => (
          <div key={g.label}>
            <p className={cn("hud-label px-4 pt-3 pb-1", g.tone === "bad" && "!text-bad")}>
              {g.label} · {g.tasks.length}
            </p>
            {g.tasks.map((t) => (
              <div key={t.id} className="flex min-h-14 items-center gap-3 border-b border-line px-4 py-2.5 last:border-0">
                <button
                  onClick={() => complete(t)}
                  aria-label={`Complete ${t.title}`}
                  className="group grid h-9 w-9 shrink-0 place-items-center rounded-full"
                >
                  <span className="grid h-5 w-5 place-items-center rounded-full border border-line-hi transition-colors group-hover:border-ok group-hover:bg-ok/15">
                    <Check className="h-3 w-3 text-ok opacity-0 transition-opacity group-hover:opacity-100" />
                  </span>
                </button>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] leading-snug">{t.title}</span>
                  <span className="text-xs text-faint">
                    {[t.project, when(t), g.tone === "bad" && t.due ? `due ${t.due.slice(0, 10)}` : ""].filter(Boolean).join(" · ")}
                  </span>
                </span>
                {t.priority > 0 && <Flag className={cn("h-4 w-4 shrink-0", FLAG[t.priority])} aria-label="Priority" />}
              </div>
            ))}
          </div>
        ))
      )}
    </Panel>
  );
}

export function CaptureBar() {
  const router = useRouter();
  const [draft, setDraft] = useState<Capture | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const card = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (draft) card.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [draft]);

  async function save() {
    if (!draft) return;
    setSaving(true);
    setError("");
    try {
      if (draft.kind === "event") await post("/api/calendar/events", { draft: draft.event });
      else await post("/api/ticktick/tasks", { task: draft.task });
      setSaved(draft.kind === "event" ? "Added to your calendar." : "Added to TickTick.");
      setDraft(null);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  // Switching kind keeps the title and date.
  function switchKind(kind: Capture["kind"]) {
    if (!draft || draft.kind === kind) return;
    const title = draft.kind === "event" ? draft.event.title : draft.task.title;
    const date = draft.kind === "event" ? draft.event.date : draft.task.date;
    setDraft(
      kind === "event"
        ? { kind, event: { title, date: date ?? new Date().toISOString().slice(0, 10), allDay: true } }
        : { kind, task: { title, date, priority: 0 } },
    );
  }

  const ev = draft?.kind === "event" ? draft.event : null;
  const tk = draft?.kind === "task" ? draft.task : null;
  const setEv = (p: Partial<EventDraft>) => ev && setDraft({ kind: "event", event: { ...ev, ...p } });
  const setTk = (p: Partial<TaskDraft>) => tk && setDraft({ kind: "task", task: { ...tk, ...p } });

  return (
    <>
      {draft && (
        <div ref={card} className="rise panel brackets mt-8 p-5">
          <div className="mb-3 flex gap-1 rounded-[12px] bg-white/[0.04] p-1 text-sm" role="tablist" aria-label="Save as">
            {(["task", "event"] as const).map((k) => (
              <button
                key={k}
                role="tab"
                aria-selected={draft.kind === k}
                onClick={() => switchKind(k)}
                className={cn("flex flex-1 items-center justify-center gap-2 rounded-[9px] px-3 py-2", draft.kind === k ? "bg-white/[0.09] text-text" : "text-muted")}
              >
                {k === "task" ? <ListTodo className="h-4 w-4" /> : <CalendarPlus className="h-4 w-4" />} {k === "task" ? "TickTick task" : "Calendar event"}
              </button>
            ))}
          </div>
          {ev && (
            <>
              <input value={ev.title} onChange={(e) => setEv({ title: e.target.value })} aria-label="Title" className={`${field} w-full`} />
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <input type="date" value={ev.date} onChange={(e) => setEv({ date: e.target.value })} aria-label="Date" className={field} />
                {!ev.allDay && (
                  <>
                    <input type="time" value={ev.start ?? ""} onChange={(e) => setEv({ start: e.target.value })} aria-label="Starts" className={field} />
                    <span className="text-faint">–</span>
                    <input type="time" value={ev.end ?? ""} onChange={(e) => setEv({ end: e.target.value })} aria-label="Ends" className={field} />
                  </>
                )}
                <label className="flex items-center gap-2 px-1 text-sm text-muted">
                  <input
                    type="checkbox"
                    checked={ev.allDay}
                    onChange={(e) => setEv(e.target.checked ? { allDay: true, start: undefined, end: undefined } : { allDay: false, start: "09:00", end: "10:00" })}
                    className="accent-[var(--color-claude)]"
                  />
                  All day
                </label>
              </div>
            </>
          )}
          {tk && (
            <>
              <input value={tk.title} onChange={(e) => setTk({ title: e.target.value })} aria-label="Task" className={`${field} w-full`} />
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <input type="date" value={tk.date ?? ""} onChange={(e) => setTk({ date: e.target.value || undefined, time: e.target.value ? tk.time : undefined })} aria-label="Due date" className={field} />
                {tk.date && <input type="time" value={tk.time ?? ""} onChange={(e) => setTk({ time: e.target.value || undefined })} aria-label="Due time" className={field} />}
                <select value={tk.priority} onChange={(e) => setTk({ priority: Number(e.target.value) as TaskDraft["priority"] })} aria-label="Priority" className={field}>
                  <option value={0}>No priority</option>
                  <option value={1}>Low</option>
                  <option value={3}>Medium</option>
                  <option value={5}>High</option>
                </select>
              </div>
              <p className="mt-2 text-xs text-faint">{tk.date ? "Goes to your TickTick Inbox with this date." : "Goes to your TickTick Inbox, no date."}</p>
            </>
          )}
          {error && <p className="mt-3 text-sm text-bad" aria-live="polite">{error}</p>}
          <div className="mt-4 flex gap-2">
            <button onClick={save} disabled={saving} className="flex items-center gap-2 h-10 rounded-[12px] bg-text px-5 text-sm font-medium text-bg disabled:opacity-40">
              {saving && <LoaderCircle className="h-4 w-4 animate-spin" />} Save
            </button>
            <button onClick={() => setDraft(null)} className="h-10 rounded-[12px] px-4 text-sm text-muted hover:bg-white/5 hover:text-text">
              Discard
            </button>
          </div>
        </div>
      )}
      {!draft && saved && (
        <p className="mt-6 flex items-center gap-2 text-sm text-ok" aria-live="polite">
          <CircleCheck className="h-4 w-4" /> {saved}
        </p>
      )}
      <div className="h-28" aria-hidden />
      <ReplyBar
        placeholder="Add a task or event — “dentist Fri 3pm”, “send invoice by Monday”"
        onSend={async (text) => {
          setError("");
          setSaved("");
          setDraft(await post<Capture>("/api/capture", { text }));
        }}
      />
    </>
  );
}

export function TickTickConnect({ error, callback }: { error?: string; callback: string }) {
  const [id, setId] = useState("");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(error ?? "");

  async function go() {
    setBusy(true);
    setMsg("");
    try {
      const { url } = await post<{ url: string }>("/api/ticktick/connect", { clientId: id, clientSecret: secret });
      window.location.href = url;
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <Panel className="p-5 text-sm leading-relaxed text-muted">
      <p className="text-text">Connect TickTick</p>
      <ol className="mt-2 list-decimal space-y-1 pl-5">
        <li>
          Open{" "}
          <a href="https://developer.ticktick.com/manage" target="_blank" rel="noreferrer" className="text-codex underline-offset-2 hover:underline">
            developer.ticktick.com/manage
          </a>{" "}
          → <span className="text-text">+ App Name</span>, call it anything.
        </li>
        <li>
          Set its OAuth redirect URL to <code className="rounded bg-black/40 px-1.5 py-0.5 font-mono text-[12px] break-all text-text">{callback}</code>
        </li>
        <li>Paste the Client ID and Client Secret here.</li>
      </ol>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <input value={id} onChange={(e) => setId(e.target.value)} placeholder="Client ID" aria-label="Client ID" autoComplete="off" className={`${field} min-w-0 flex-1`} />
        <input value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="Client Secret" aria-label="Client Secret" type="password" autoComplete="off" className={`${field} min-w-0 flex-1`} />
        <button onClick={go} disabled={busy || !id.trim() || !secret.trim()} className="flex items-center justify-center gap-2 h-10 rounded-[12px] bg-text px-5 font-medium text-bg disabled:opacity-40">
          {busy && <LoaderCircle className="h-4 w-4 animate-spin" />} Connect
        </button>
      </div>
      {msg && <p className="mt-3 text-bad">{msg}</p>}
    </Panel>
  );
}
