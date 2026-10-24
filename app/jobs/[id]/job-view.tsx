"use client";

import { useEffect, useRef, useState } from "react";
import type { Job } from "@/lib/store";
import { ago, cn } from "@/lib/utils";

type LogEvent = { t?: string; kind?: string; text?: string; ok?: boolean; costUsd?: number; sessionId?: string };

const kindStyle: Record<string, string> = {
  text: "text-text whitespace-pre-wrap",
  tool: "font-mono text-xs text-muted",
  turn: "mt-4 border-t border-line pt-3 text-xs font-semibold uppercase tracking-wider text-accent",
  result: "whitespace-pre-wrap rounded-lg bg-white/[0.03] p-3 text-text",
  error: "whitespace-pre-wrap text-bad",
  init: "font-mono text-xs text-muted",
};

export function JobView({ initialJob, initialLog }: { initialJob: Job; initialLog: LogEvent[] }) {
  const [job, setJob] = useState(initialJob);
  const [log, setLog] = useState<LogEvent[]>(initialLog);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState("");
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
    const id = setInterval(poll, 3000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [initialJob.id]);

  async function act(action: "reply" | "cancel") {
    setSending(true);
    setNotice("");
    const res = await fetch(`/api/jobs/${job.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, prompt: reply }),
    });
    setSending(false);
    if (!res.ok) return setNotice("Didn't go through — try again.");
    if (action === "reply") {
      setReply("");
      setNotice(job.status === "running" ? "Queued — Claude gets it when this turn ends." : "Sent — Claude is picking it up.");
    }
  }

  const running = job.status === "running" || job.status === "queued";
  const cost = (job.turns ?? []).reduce((s, t) => s + (t.costUsd ?? 0), 0);

  return (
    <div className="pb-40">
      <div className="mb-1 flex items-center gap-3 font-mono text-xs text-muted">
        <a href={job.issueUrl} target="_blank" rel="noreferrer" className="hover:text-text">
          {job.id} ↗
        </a>
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
          <button onClick={() => act("cancel")} disabled={sending} className="ml-auto text-sm text-bad hover:underline">
            Stop
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
        {running && <div className="animate-pulse text-xs text-muted">working…</div>}
        <div ref={bottom} />
      </div>

      <div className="fixed inset-x-0 bottom-0 border-t border-line bg-bg/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl gap-2 px-4 py-3">
          <textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            rows={2}
            placeholder={job.status === "closed" ? "Issue is closed in Linear" : "Continue this session…"}
            disabled={job.status === "closed"}
            className="min-w-0 flex-1 resize-none rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none focus:border-accent"
          />
          <button
            onClick={() => act("reply")}
            disabled={sending || !reply.trim() || job.status === "closed"}
            className="rounded-lg bg-accent px-4 text-sm font-medium text-bg disabled:opacity-40"
          >
            Send
          </button>
        </div>
        {notice && <p className="mx-auto max-w-5xl px-4 pb-2 text-xs text-muted">{notice}</p>}
      </div>
    </div>
  );
}
