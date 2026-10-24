"use client";

import { useEffect, useRef, useState } from "react";
import { ReplyBar } from "@/components/reply-bar";
import { AGENT_LABELS } from "@/lib/agents";
import type { Job } from "@/lib/store";
import { ago, cn } from "@/lib/utils";

type LogEvent = { t?: string; kind?: string; text?: string; ok?: boolean; costUsd?: number; sessionId?: string };

const kindStyle: Record<string, string> = {
  text: "text-text whitespace-pre-wrap",
  tool: "font-mono text-xs text-muted",
  turn: "mt-4 border-t border-line pt-3 text-xs font-semibold text-accent whitespace-pre-wrap",
  result: "whitespace-pre-wrap rounded-lg bg-white/[0.03] p-3 text-text",
  error: "whitespace-pre-wrap text-bad",
  init: "font-mono text-xs text-muted",
};

export function JobView({ initialJob, initialLog }: { initialJob: Job; initialLog: LogEvent[] }) {
  const [job, setJob] = useState(initialJob);
  const [log, setLog] = useState<LogEvent[]>(initialLog);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
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
  const cost = (job.turns ?? []).reduce((s, t) => s + (t.costUsd ?? 0), 0);
  const agentName = AGENT_LABELS[job.agent ?? "claude"];

  return (
    <div className="pb-40">
      <div className="mb-1 flex flex-wrap items-center gap-3 font-mono text-xs text-muted">
        <span className="rounded bg-white/5 px-1.5 py-0.5 text-text">{agentName}</span>
        {job.issueUrl ? (
          <a href={job.issueUrl} target="_blank" rel="noreferrer" className="hover:text-text">
            {job.id} ↗
          </a>
        ) : (
          <span>{job.id}</span>
        )}
        <span>{job.repo}</span>
        <span>{job.branch}</span>
      </div>
      <h1 className="mb-3 text-xl font-semibold">{job.title}</h1>
      <div className="mb-6 flex flex-wrap items-center gap-3 text-sm">
        <span className={cn("rounded-full border border-line px-3 py-1", job.status === "failed" && "text-bad", running && "text-accent")}>
          {job.status}
        </span>
        {job.prUrl && (
          <a href={job.prUrl} target="_blank" rel="noreferrer" className="rounded-full border border-line px-3 py-1 hover:border-accent">
            Pull request ↗
          </a>
        )}
        <span className="text-muted">
          {job.turns?.length ?? 0} turn{job.turns?.length === 1 ? "" : "s"} · updated {ago(job.updatedAt)}
          {cost > 0 && ` · $${cost.toFixed(2)} equiv.`}
        </span>
        {running && (
          <button onClick={() => post({ action: "cancel" })} className="ml-auto text-sm text-bad hover:underline">
            Stop
          </button>
        )}
        {/* Linear jobs close when the issue is closed; plain chats are archived here. */}
        {!running && !job.issueId && job.status !== "closed" && (
          <button onClick={() => post({ action: "archive" })} className="ml-auto text-sm text-muted hover:text-text">
            Archive
          </button>
        )}
      </div>
      {job.error && <p className="mb-4 rounded-lg border border-bad/30 p-3 text-sm text-bad">{job.error}</p>}

      <div className="flex flex-col gap-2 text-sm">
        {log.map((e, i) => (
          <div key={i} className={kindStyle[e.kind ?? "text"] ?? "text-muted"}>
            {e.kind === "init" ? `session ${e.sessionId ?? ""}` : e.text}
          </div>
        ))}
        {running && <div className="animate-pulse text-xs text-muted">{job.status === "queued" ? "waiting for a free slot…" : `${agentName} is working…`}</div>}
        <div ref={bottom} />
      </div>

      <ReplyBar
        placeholder={job.status === "closed" ? (job.issueId ? "Issue is closed in Linear" : "Chat archived") : `Message ${agentName}…`}
        disabled={job.status === "closed"}
        onSend={async (prompt) => {
          await post({ action: "reply", prompt });
          return job.status === "running" ? `Queued — ${agentName} gets it when this turn ends.` : `Sent — ${agentName} is picking it up.`;
        }}
      />
    </div>
  );
}
