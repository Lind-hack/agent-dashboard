"use client";

import { Check, FilePen, LoaderCircle, SquareTerminal } from "lucide-react";
import { useEffect, useState } from "react";
import { parseProgress, type LogLike } from "@/lib/progress";
import { cn } from "@/lib/utils";

// Where the agent is in the task, live: its own plan as a stepper (from the PLAN / STEP / DONE lines
// the brief asks for), else the phase read from its latest tool calls; plus files touched, commands
// run and how long this turn has taken.

function useElapsed(since?: string, live = true) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [live]);
  if (!since) return null;
  const s = Math.max(0, Math.round((now - Date.parse(since)) / 1000));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s` : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

export function StepTracker({ log, running }: { log: LogLike[]; running: boolean }) {
  const p = parseProgress(log);
  const elapsed = useElapsed(p.startedAt, running);
  if (!running && !p.steps.length) return null;
  const done = p.steps.filter((s) => s.status === "done").length;
  const pct = p.total ? Math.round((done / p.total) * 100) : null;

  return (
    <section className="panel relative mt-4 overflow-hidden p-4" aria-label="Progress" aria-live="polite">
      <span className="pointer-events-none absolute inset-x-0 top-0 h-[2px] bg-white/[0.04]" aria-hidden>
        {pct !== null && <span className="block h-full transition-[width] duration-700 ease-[var(--ease-out-expo)]" style={{ width: `${pct}%`, background: "var(--agent)", boxShadow: "0 0 10px var(--agent)" }} />}
      </span>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <p className="flex items-center gap-2 text-sm font-medium">
          {running ? <LoaderCircle className="h-4 w-4 animate-spin" style={{ color: "var(--agent)" }} /> : <Check className="h-4 w-4 text-ok" />}
          {p.current && p.total ? `Step ${p.current} of ${p.total}` : running ? (p.phase ?? "Starting") : "Finished"}
          {p.current && p.total && running && p.phase && <span className="font-normal text-muted">· {p.phase.toLowerCase()}</span>}
        </p>
        <p className="ml-auto flex items-center gap-3 font-mono text-[11px] text-faint">
          {p.files.length > 0 && (
            <span className="flex items-center gap-1">
              <FilePen className="h-3 w-3" /> {p.files.length} file{p.files.length > 1 ? "s" : ""}
            </span>
          )}
          {p.commands > 0 && (
            <span className="flex items-center gap-1">
              <SquareTerminal className="h-3 w-3" /> {p.commands}
            </span>
          )}
          {elapsed && <span className="tnum">{elapsed}</span>}
        </p>
      </div>

      {p.steps.length > 0 && (
        <ol className="mt-3 flex flex-col gap-0.5">
          {p.steps.map((s) => (
            <li key={s.n} className={cn("flex items-center gap-3 rounded-[10px] px-2 py-1.5 text-[13.5px] transition-colors", s.status === "active" && "bg-white/[0.04]")}>
              <span
                className={cn("grid h-5 w-5 shrink-0 place-items-center rounded-full border text-[10px] font-mono transition-colors", s.status === "done" ? "border-transparent bg-ok/20 text-ok" : s.status === "active" ? "border-transparent text-bg" : "border-line-hi text-faint")}
                style={s.status === "active" ? { background: "var(--agent)", boxShadow: "0 0 12px -2px var(--agent)" } : undefined}
              >
                {s.status === "done" ? <Check className="h-3 w-3" /> : s.n}
              </span>
              <span className={cn("min-w-0 flex-1 truncate", s.status === "done" ? "text-muted line-through decoration-white/20" : s.status === "active" ? "font-medium" : "text-muted")}>{s.title}</span>
              {s.status === "active" && running && <span className="h-1.5 w-1.5 animate-ping rounded-full motion-reduce:animate-none" style={{ background: "var(--agent)" }} />}
            </li>
          ))}
        </ol>
      )}

      {p.files.length > 0 && (
        <p className="mt-3 flex flex-wrap gap-1.5">
          {p.files.slice(-8).map((f) => (
            <span key={f} className="max-w-[220px] truncate rounded-md bg-white/[0.04] px-1.5 py-0.5 font-mono text-[10.5px] text-muted" title={f}>
              {f.split("/").slice(-2).join("/")}
            </span>
          ))}
          {p.files.length > 8 && <span className="font-mono text-[10.5px] text-faint">+{p.files.length - 8}</span>}
        </p>
      )}
    </section>
  );
}

// Pinned under the top bar while the agent works, so the step it's on stays visible as you scroll the
// conversation.
export function LiveStrip({ log, running }: { log: LogLike[]; running: boolean }) {
  const p = parseProgress(log);
  const elapsed = useElapsed(p.startedAt, running);
  if (!running) return null;
  const done = p.steps.filter((s) => s.status === "done").length;
  const pct = p.total ? Math.round((done / p.total) * 100) : null;
  const active = p.steps.find((s) => s.status === "active");
  return (
    <div className="sticky top-[calc(60px+var(--focusbar,0px))] z-10 -mx-1 mb-1" role="status" aria-live="polite">
      <div className="relative flex items-center gap-3 overflow-hidden rounded-[14px] border border-[color-mix(in_oklab,var(--agent),transparent_60%)] bg-bg-raised/90 px-3.5 py-2 shadow-[0_12px_30px_-18px_rgb(0_0_0/0.9)] backdrop-blur-xl">
        <span className="absolute inset-x-0 bottom-0 h-[2px] bg-white/[0.04]" aria-hidden>
          <span className="block h-full transition-[width] duration-700 ease-[var(--ease-out-expo)]" style={{ width: `${pct ?? 8}%`, background: "var(--agent)", boxShadow: "0 0 8px var(--agent)" }} />
        </span>
        <LoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin" style={{ color: "var(--agent)" }} aria-hidden />
        <span className="min-w-0 flex-1 truncate text-[13px]">
          {p.current && p.total ? <span className="font-mono text-[11px] text-muted">{p.current}/{p.total} · </span> : null}
          {active?.title ?? p.phase ?? "Working"}
        </span>
        {p.steps.length > 0 && (
          <span className="hidden shrink-0 items-center gap-1 sm:flex" aria-hidden>
            {p.steps.map((s) => (
              <span key={s.n} className={cn("h-1.5 rounded-full transition-all", s.status === "active" ? "w-4" : "w-1.5", s.status === "todo" && "bg-white/15")} style={s.status !== "todo" ? { background: s.status === "done" ? "var(--color-ok)" : "var(--agent)" } : undefined} />
            ))}
          </span>
        )}
        {elapsed && <span className="tnum shrink-0 font-mono text-[10.5px] text-faint">{elapsed}</span>}
      </div>
    </div>
  );
}
