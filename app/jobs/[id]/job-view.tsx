"use client";

import { Archive, ArrowUpRight, ChevronDown, GitBranch, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AgentLogo } from "@/components/agent-logo";
import { Md } from "@/components/md";
import { StatusPill } from "@/components/kit";
import { ReplyBar } from "@/components/reply-bar";
import { AGENT_LABELS } from "@/lib/agents";
import type { Job } from "@/lib/store";
import { ago, cn } from "@/lib/utils";
import { ContextPanel, EarlierOnPc, HandoffStrip } from "./handoff-panels";

type LogEvent = { t?: string; kind?: string; text?: string; ok?: boolean; costUsd?: number; sessionId?: string };

// Group consecutive tool calls so the conversation reads like a chat, with the work folded away.
type Block = { kind: "you" | "agent" | "result" | "error" | "start"; text: string } | { kind: "tools"; items: string[] };

function toBlocks(log: LogEvent[]): Block[] {
  const out: Block[] = [];
  for (const e of log) {
    if (e.kind === "init") continue;
    if (e.kind === "tool") {
      const last = out.at(-1);
      if (last?.kind === "tools") last.items.push(e.text ?? "");
      else out.push({ kind: "tools", items: [e.text ?? ""] });
      continue;
    }
    if (e.kind === "turn") {
      const t = e.text ?? "";
      out.push(t.startsWith("You: ") ? { kind: "you", text: t.slice(5) } : { kind: "start", text: t });
      continue;
    }
    if (e.kind === "result") {
      // The result repeats the agent's last message; show it once, as the turn's answer.
      const last = out.at(-1);
      if (last && last.kind === "agent" && last.text.trim() === (e.text ?? "").trim()) out.pop();
      out.push({ kind: e.ok === false ? "error" : "result", text: e.text ?? "" });
      continue;
    }
    out.push({ kind: e.kind === "error" ? "error" : "agent", text: e.text ?? "" });
  }
  return out;
}

function Tools({ items }: { items: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="text-xs">
      <button onClick={() => setOpen(!open)} className="flex items-center gap-1.5 rounded-[9px] border border-line px-3 py-1 font-mono text-[11px] text-muted hover:text-text" aria-expanded={open}>
        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
        {items.length} step{items.length > 1 ? "s" : ""} · {items.at(-1)?.split(" ")[0]}
      </button>
      {open && (
        <ul className="mt-2 flex flex-col gap-1 border-l border-line pl-3 font-mono text-[11.5px] text-muted">
          {items.map((t, i) => (
            <li key={i} className="break-all">
              {t}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type Tab = "chat" | "context" | "earlier";

export function JobView({ initialJob, initialLog }: { initialJob: Job; initialLog: LogEvent[] }) {
  const [job, setJob] = useState(initialJob);
  const [tab, setTab] = useState<Tab>("chat");
  const [log, setLog] = useState<LogEvent[]>(initialLog);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView();
    let stop = false;
    async function poll() {
      const res = await fetch(`/api/jobs/${initialJob.id}`, { cache: "no-store" }).catch(() => null);
      if (res?.ok && !stop) {
        const body = (await res.json()) as { job: Job; log: LogEvent[] };
        setJob(body.job);
        setLog((prev) => {
          if (body.log.length !== prev.length) setTimeout(() => bottom.current?.scrollIntoView({ behavior: "smooth" }), 50);
          return body.log;
        });
      }
    }
    const id = setInterval(poll, 2500);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [initialJob.id]);

  async function post(payload: Record<string, string>) {
    const res = await fetch(`/api/jobs/${job.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  }

  const running = job.status === "running" || job.status === "queued";
  const preparing = job.status === "preparing";
  const agentName = AGENT_LABELS[job.agent ?? "claude"];
  const blocks = toBlocks(log);

  return (
    <div className="mx-auto max-w-3xl pb-44">
      <header className="pt-2 pb-5 lg:pt-6">
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-muted">
          <span className="flex items-center gap-2 font-sans text-[13px] text-text">
            <AgentLogo agent={job.agent ?? "claude"} size="sm" state={job.status === "running" ? "working" : "ready"} /> {agentName}
          </span>
          {job.repo && (
            <span className="flex items-center gap-1" translate="no">
              <GitBranch className="h-3.5 w-3.5" aria-hidden /> {job.repo.split("/")[1] ?? job.repo}
            </span>
          )}
          {job.issueUrl ? (
            <a href={job.issueUrl} target="_blank" rel="noreferrer" className="flex items-center gap-0.5 hover:text-text">
              {job.id} <ArrowUpRight className="h-3 w-3" />
            </a>
          ) : (
            <span>{job.id}</span>
          )}
          <span>updated {ago(job.updatedAt)}</span>
        </div>
        <h1 className="text-[1.7rem] leading-tight font-semibold tracking-[-0.03em] text-balance">{job.title}</h1>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <StatusPill tone={job.status === "failed" ? "bad" : running || preparing ? "live" : job.status === "waiting" ? "ok" : "neutral"} pulse={job.status === "running"}>
            {job.status === "queued" ? "Waiting for a slot" : job.status === "running" ? `${agentName} is working` : preparing ? "Preparing context" : job.status === "waiting" ? "Your turn" : job.status}
          </StatusPill>
          {job.prUrl && (
            <a href={job.prUrl} target="_blank" rel="noreferrer" className="flex h-8 items-center gap-1 rounded-[10px] border border-line px-3 text-xs hover:border-line-hi">
              Pull request <ArrowUpRight className="h-3.5 w-3.5" />
            </a>
          )}
          {running && (
            <button onClick={() => post({ action: "cancel" })} className="ml-auto flex h-8 items-center gap-1.5 rounded-[10px] border border-bad/40 px-3 text-xs text-bad hover:bg-bad/10">
              <Square className="h-3 w-3 fill-current" /> Stop
            </button>
          )}
          {/* Linear jobs close when the issue is closed; plain chats are archived here. */}
          {!running && !preparing && !job.issueId && job.status !== "closed" && (
            <button onClick={() => post({ action: "archive" })} className="ml-auto flex h-8 items-center gap-1.5 rounded-[10px] border border-line px-3 text-xs text-muted hover:text-text">
              <Archive className="h-3.5 w-3.5" /> Archive
            </button>
          )}
        </div>
        {job.imported && <HandoffStrip imported={job.imported} status={job.status} owner={job.owner} onAction={(a) => void post({ action: a })} />}
        {job.imported && (
          <div className="mt-4 flex gap-1 rounded-[12px] border border-line p-1 text-sm" role="tablist" aria-label="Chat views">
            {(
              [
                ["chat", "Chat"],
                ["context", "Context"],
                ["earlier", "Earlier on PC"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                role="tab"
                aria-selected={tab === k}
                onClick={() => setTab(k)}
                className={cn("min-h-9 flex-1 rounded-[9px] px-3 transition-colors", tab === k ? "bg-text text-bg" : "text-muted hover:text-text")}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </header>

      {job.imported && tab === "context" && <ContextPanel jobId={job.id} dossierState={job.imported.dossier} />}
      {job.imported && tab === "earlier" && <EarlierOnPc jobId={job.id} Tools={Tools} />}

      <div className={cn("flex flex-col gap-4 text-[15px] leading-relaxed", job.imported && tab !== "chat" && "hidden")}>
        {blocks.map((b, i) => {
          if (b.kind === "tools") return <Tools key={i} items={b.items} />;
          if (b.kind === "start") return <p key={i} className="text-xs text-faint">{b.text}</p>;
          if (b.kind === "you")
            return (
              <div key={i} className="max-w-[85%] self-end rounded-[20px] rounded-br-md bg-white/[0.08] px-4 py-2.5 whitespace-pre-wrap">
                {b.text}
              </div>
            );
          if (b.kind === "error")
            return (
              <p key={i} className="rounded-2xl border border-bad/30 bg-bad/5 px-4 py-3 text-sm whitespace-pre-wrap text-bad">
                {b.text}
              </p>
            );
          if (b.kind === "result")
            return (
              <div key={i} className="panel px-4 py-3.5">
                <Md text={b.text} />
              </div>
            );
          return (
            <div key={i} className="text-text/90">
              <Md text={b.text} />
            </div>
          );
        })}
        {preparing && <p className="animate-pulse text-xs text-muted">Getting the code, the chat and the project dossier ready…</p>}
        {running && <p className="animate-pulse text-xs text-muted">{job.status === "queued" ? "Waiting for a free slot…" : `${agentName} is working…`}</p>}
        <div ref={bottom} />
      </div>

      <ReplyBar
        placeholder={
          job.owner === "pc" ? "Back on the PC" : job.owner === "returning" ? "Returning to the PC" : job.status === "closed" ? (job.issueId ? "Issue is closed in Linear" : "Chat archived") : `Message ${agentName}…`
        }
        disabled={job.status === "closed" || job.owner === "returning" || job.owner === "pc"}
        onSend={async (prompt) => {
          await post({ action: "reply", prompt });
          return job.status === "running" ? `Queued — ${agentName} gets it when this turn ends.` : `Sent — ${agentName} is picking it up.`;
        }}
      />
    </div>
  );
}
