"use client";

import { ArrowRight, Check, FilePen, GitPullRequest, LoaderCircle, MessageCircleReply, SquareTerminal, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { AGENT_HEX, AGENT_LABELS, type TaskAgent } from "@/lib/agents";
import type { LiveChat } from "@/lib/chat-live";
import { cn } from "@/lib/utils";
import { AgentLogo } from "./agent-logo";

// The chats board (v5): every agent at work, as a card with the step it's on (its own plan as a
// stepper), what it just did, files and commands so far and how long it's been going — and the chats
// waiting on Lind, with the agent's last words and a reply link. Refreshes itself every 4 seconds.

function elapsed(since: string | undefined, now: number) {
  if (!since) return null;
  const s = Math.max(0, Math.round((now - Date.parse(since)) / 1000));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

export function ChatBoard({ initial }: { initial: LiveChat[] }) {
  const [chats, setChats] = useState(initial);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      const r = await fetch("/api/chats/live", { cache: "no-store" }).then((x) => (x.ok ? x.json() : null)).catch(() => null);
      if (alive && r?.chats) setChats(r.chats);
    };
    const a = setInterval(poll, 4000);
    const b = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      alive = false;
      clearInterval(a);
      clearInterval(b);
    };
  }, []);

  const working = chats.filter((c) => c.status === "running" || c.status === "queued" || c.status === "preparing");
  const yours = chats.filter((c) => c.status === "waiting" || c.status === "failed");
  if (!working.length && !yours.length) return null;

  return (
    <div className="mb-6 flex flex-col gap-5">
      {working.length > 0 && (
        <section aria-label="Working now">
          <p className="hud-label mb-2 flex items-center gap-2 px-1">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-hud motion-reduce:animate-none" /> Working now · {working.length}
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            {working.map((c) => {
              const color = AGENT_HEX[c.agent as TaskAgent] ?? "#9aa4b2";
              const done = c.steps.filter((s) => s.status === "done").length;
              const pct = c.total ? Math.round((100 * done) / c.total) : null;
              return (
                <Link key={c.id} href={`/jobs/${c.id}`} className="panel lift group relative flex flex-col gap-3 overflow-hidden p-4" style={{ ["--agent" as string]: color }}>
                  <span className="pointer-events-none absolute -top-16 -right-16 h-44 w-44 rounded-full opacity-25 blur-3xl" style={{ background: color }} aria-hidden />
                  <span className="absolute inset-x-0 top-0 h-[2px] bg-white/[0.04]" aria-hidden>
                    <span className="block h-full transition-[width] duration-700 ease-[var(--ease-out-expo)]" style={{ width: `${pct ?? 6}%`, background: color, boxShadow: `0 0 10px ${color}` }} />
                  </span>
                  <div className="relative flex items-center gap-3">
                    <AgentLogo agent={c.agent as TaskAgent} size="md" state={c.status === "running" ? "working" : "ready"} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-medium">{c.title}</span>
                      <span className="block truncate font-mono text-[11px] text-faint">
                        {AGENT_LABELS[c.agent as TaskAgent] ?? c.agent}
                        {c.repo && ` · ${c.repo}`}
                      </span>
                    </span>
                    <ArrowRight className="h-4 w-4 shrink-0 text-faint transition-transform group-hover:translate-x-0.5" aria-hidden />
                  </div>
                  <div className="relative">
                    <p className="flex items-center gap-2 text-[13.5px]">
                      <LoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin" style={{ color }} aria-hidden />
                      {c.status === "queued" ? (
                        <span className="text-muted">Waiting for a free slot</span>
                      ) : c.status === "preparing" ? (
                        <span className="text-muted">Getting the code and context ready</span>
                      ) : (
                        <span className="min-w-0 truncate">
                          {c.step && c.total ? <span className="font-mono text-[11.5px] text-muted">Step {c.step} of {c.total} · </span> : null}
                          {c.stepTitle ?? c.phase ?? "Starting"}
                        </span>
                      )}
                    </p>
                    {c.steps.length > 0 && (
                      <ol className="mt-2 flex gap-1" aria-label={`${done} of ${c.steps.length} steps done`}>
                        {c.steps.map((s) => (
                          <li key={s.n} title={`${s.n}. ${s.title}`} className={cn("h-1.5 flex-1 rounded-full transition-colors", s.status === "todo" && "bg-white/[0.08]")} style={s.status !== "todo" ? { background: s.status === "done" ? "var(--color-ok)" : color, boxShadow: s.status === "active" ? `0 0 8px ${color}` : undefined } : undefined} />
                        ))}
                      </ol>
                    )}
                    {c.last && <p className="mt-2 truncate font-mono text-[11px] text-faint">{c.last}</p>}
                  </div>
                  <p className="relative flex items-center gap-3 font-mono text-[10.5px] text-faint">
                    {c.files > 0 && (
                      <span className="flex items-center gap-1">
                        <FilePen className="h-3 w-3" /> {c.files}
                      </span>
                    )}
                    {c.commands > 0 && (
                      <span className="flex items-center gap-1">
                        <SquareTerminal className="h-3 w-3" /> {c.commands}
                      </span>
                    )}
                    {c.status === "running" && <span className="tnum ml-auto">{elapsed(c.startedAt, now)}</span>}
                  </p>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {yours.length > 0 && (
        <section aria-label="Waiting on you">
          <p className="hud-label mb-2 px-1">Your turn · {yours.length}</p>
          <div className="panel overflow-hidden">
            {yours.map((c) => {
              const done = c.steps.filter((s) => s.status === "done").length;
              return (
                <Link key={c.id} href={`/jobs/${c.id}`} className="group flex items-start gap-3 border-b border-line px-3 py-3 last:border-0 hover:bg-white/[0.025]">
                  <AgentLogo agent={c.agent as TaskAgent} size="md" state="ready" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-[15px]">{c.title}</span>
                      {c.pr && <GitPullRequest className="h-3.5 w-3.5 shrink-0 text-muted" aria-label="Has a pull request" />}
                    </span>
                    <span className="mt-0.5 line-clamp-2 text-[13px] text-muted">{c.last || "Finished its turn."}</span>
                    <span className="mt-1 flex items-center gap-2 font-mono text-[10.5px] text-faint">
                      {c.status === "failed" ? (
                        <span className="flex items-center gap-1 text-bad">
                          <TriangleAlert className="h-3 w-3" /> failed
                        </span>
                      ) : c.steps.length > 0 ? (
                        <span className={cn("flex items-center gap-1", done === c.steps.length && "text-ok")}>
                          <Check className="h-3 w-3" /> {done}/{c.steps.length} steps
                        </span>
                      ) : null}
                      <span>{AGENT_LABELS[c.agent as TaskAgent] ?? c.agent}</span>
                    </span>
                  </span>
                  <span className="flex h-8 shrink-0 items-center gap-1.5 self-center rounded-[10px] border border-line px-2.5 text-xs text-muted group-hover:border-line-hi group-hover:text-text">
                    <MessageCircleReply className="h-3.5 w-3.5" /> Reply
                  </span>
                </Link>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
