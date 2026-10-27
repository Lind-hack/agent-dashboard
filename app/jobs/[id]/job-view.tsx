"use client";

import { Archive, ArrowDown, ArrowUpRight, Check, ChevronDown, Copy, FilePen, FileText, GitBranch, Globe, Play, Plug, Search, Square, SquareTerminal, Volume2, VolumeX, Wrench } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChatIdentity } from "@/components/chat-identity";
import { ChatEmpty } from "@/components/chat-empty";
import { AgentLogo } from "@/components/agent-logo";
import { Md } from "@/components/md";
import { StatusPill } from "@/components/kit";
import { ReplyBar } from "@/components/reply-bar";
import { HighlightSkills } from "@/components/skill-picker";
import { speak, stopSpeaking, unlockAudio, useVoiceState } from "@/components/voice-engine";
import { AGENT_HEX, AGENT_LABELS, AGENT_PERSONA, type TaskAgent } from "@/lib/agents";
import type { Job } from "@/lib/store";
import { ago, cn } from "@/lib/utils";
import { ContextPanel, EarlierOnPc, HandoffStrip } from "./handoff-panels";

type LogEvent = { t?: string; kind?: string; text?: string; ok?: boolean; costUsd?: number; sessionId?: string };

// Group consecutive tool calls so the conversation reads like a chat, with the work folded away.
// `at` = index of the block's first event in the log window, for a key that survives the window sliding.
type Block = ({ kind: "you" | "agent" | "error" | "start"; text: string } | { kind: "result"; text: string; cost?: number } | { kind: "tools"; items: string[] }) & { at: number };

function toBlocks(log: LogEvent[]): Block[] {
  const out: Block[] = [];
  for (const [at, e] of log.entries()) {
    if (e.kind === "init") continue;
    if (e.kind === "tool") {
      const last = out.at(-1);
      if (last?.kind === "tools") last.items.push(e.text ?? "");
      else out.push({ kind: "tools", items: [e.text ?? ""], at });
      continue;
    }
    if (e.kind === "turn") {
      const t = e.text ?? "";
      out.push(t.startsWith("You: ") ? { kind: "you", text: t.slice(5), at } : { kind: "start", text: t, at });
      continue;
    }
    if (e.kind === "result") {
      // The result repeats the agent's last message; show it once, as the turn's answer.
      const last = out.at(-1);
      if (last && last.kind === "agent" && last.text.trim() === (e.text ?? "").trim()) out.pop();
      out.push(e.ok === false ? { kind: "error", text: e.text ?? "", at } : { kind: "result", text: e.text ?? "", cost: e.costUsd, at });
      continue;
    }
    out.push({ kind: e.kind === "error" ? "error" : "agent", text: e.text ?? "", at });
  }
  return out;
}

// The API returns the last 400 events, so a long chat's window slides instead of growing. How many
// events in `next` are new since `prev`: find prev's last event in next.
const same = (a?: LogEvent, b?: LogEvent) => !!a && !!b && a.t === b.t && a.kind === b.kind && a.text === b.text;
function newEvents(prev: LogEvent[], next: LogEvent[]): number {
  const last = prev.at(-1);
  if (!last) return next.length;
  for (let i = next.length - 1; i >= 0; i--) if (same(next[i], last)) return next.length - 1 - i;
  return next.length;
}

// What a tool step is, from its first word (Claude: Read/Edit/Bash…; Codex: Bash/edit/WebSearch/mcp).
const TOOL_KINDS = [
  { re: /^(read|view|cat|ls)\b/i, icon: FileText, label: "read" },
  { re: /^(edit|write|multiedit|notebookedit|add|update|delete|create|apply_patch)\b/i, icon: FilePen, label: "edit" },
  { re: /^(bash|shell|exec|run)\b/i, icon: SquareTerminal, label: "run" },
  { re: /^(grep|glob|search|find|toolsearch)\b/i, icon: Search, label: "search" },
  { re: /^(web|websearch|webfetch|fetch)/i, icon: Globe, label: "web" },
  { re: /^(mcp|[\w-]+\.[\w-]+)/i, icon: Plug, label: "tool" },
];
const kindOf = (t: string) => TOOL_KINDS.find((k) => k.re.test(t.trim())) ?? { icon: Wrench, label: "step" };

function Tools({ items }: { items: string[] }) {
  const [open, setOpen] = useState(false);
  const counts = new Map<string, { icon: typeof Wrench; n: number }>();
  for (const t of items) {
    const k = kindOf(t);
    counts.set(k.label, { icon: k.icon, n: (counts.get(k.label)?.n ?? 0) + 1 });
  }
  return (
    <div className="text-xs">
      <button
        onClick={() => setOpen(!open)}
        className="flex min-h-9 max-w-full items-center gap-2.5 rounded-[10px] border border-line bg-white/[0.015] px-3 py-1.5 font-mono text-[11px] text-muted transition-colors hover:border-line-hi hover:text-text"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2">
          {[...counts].map(([label, { icon: Icon, n }]) => (
            <span key={label} className="flex items-center gap-1" title={`${n} ${label}`}>
              <Icon className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
              <span className="tnum">{n}</span>
            </span>
          ))}
        </span>
        <span className="min-w-0 truncate text-faint">{items.at(-1)}</span>
        <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 transition-transform duration-200", open && "rotate-180")} aria-hidden />
      </button>
      <div className="fold" data-open={open} aria-hidden={!open}>
        <div>
          <ol className="mt-2 ml-1 flex flex-col gap-1 border-l border-line pl-3 font-mono text-[11.5px] text-muted">
            {items.map((t, i) => {
              const Icon = kindOf(t).icon;
              return (
                <li key={i} className="flex gap-2 break-all">
                  <Icon className="mt-0.5 h-3 w-3 shrink-0 text-faint" strokeWidth={1.75} aria-hidden />
                  {t}
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </div>
  );
}

// Play an answer in the agent's own voice; shows moving bars while it's the one speaking.
function Listen({ text, agent, id }: { text: string; agent: TaskAgent; id: string }) {
  const voice = useVoiceState();
  const playing = voice.speakingKey === id;
  return (
    <button
      onClick={() => {
        unlockAudio();
        if (playing) stopSpeaking();
        else void speak(text, agent, id);
      }}
      aria-label={playing ? "Stop reading" : `Listen in ${AGENT_LABELS[agent]}'s voice`}
      className={cn("flex h-8 items-center gap-1.5 rounded-[9px] px-2.5 text-xs transition-colors", playing ? "text-[var(--agent)]" : "text-muted hover:bg-white/5 hover:text-text")}
    >
      {playing ? (
        <span className="talk-bars flex h-3.5 w-3.5 items-center justify-center gap-[2px]" aria-hidden>
          <span />
          <span />
          <span />
        </span>
      ) : (
        <Play className="h-3.5 w-3.5" aria-hidden />
      )}
      {playing ? "Stop" : "Listen"}
    </button>
  );
}

function CopyText({ text }: { text: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setState("copied");
        } catch {
          setState("failed");
        }
        setTimeout(() => setState("idle"), 2000);
      }}
      aria-label="Copy answer"
      className="flex h-8 items-center gap-1.5 rounded-[9px] px-2.5 text-xs text-muted transition-colors hover:bg-white/5 hover:text-text"
    >
      {state === "copied" ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
      <span aria-live="polite">{state === "copied" ? "Copied" : state === "failed" ? "Copy failed — try again" : "Copy"}</span>
    </button>
  );
}

// Who's talking: the agent's mark and name at the start of each of its turns.
function Speaker({ agent }: { agent: TaskAgent }) {
  return (
    <p className="chat-speaker -mb-1.5 flex items-center gap-2">
      <AgentLogo agent={agent} size="xs" />
      <span className="text-xs font-medium" style={{ color: "var(--agent)" }}>
        {AGENT_LABELS[agent]}
      </span>
    </p>
  );
}

const readAloudKey = "ad.readAloud";
type Tab = "chat" | "context" | "earlier";

export function JobView({ initialJob, initialLog }: { initialJob: Job; initialLog: LogEvent[] }) {
  const [job, setJob] = useState(initialJob);
  const [tab, setTab] = useState<Tab>("chat");
  const [log, setLog] = useState<LogEvent[]>(initialLog);
  const [readAloud, setReadAloud] = useState(false);
  const [below, setBelow] = useState(0); // new blocks that arrived while scrolled up
  const bottom = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  // Events dropped off the front of the window so far: block keys = dropped + index stay stable.
  const [dropped, setDropped] = useState(0);
  const arrived = useRef<LogEvent[]>([]); // events that came in with the latest poll

  const agent: TaskAgent = job.agent ?? "claude";
  const agentName = AGENT_LABELS[agent];
  const blocks = toBlocks(log);

  useEffect(() => {
    try {
      setReadAloud(localStorage.getItem(readAloudKey) === "1");
    } catch {}
  }, []);

  // Follow the conversation only while you're at the bottom; otherwise count what's new.
  useEffect(() => {
    const onScroll = () => {
      nearBottom.current = window.innerHeight + window.scrollY > document.documentElement.scrollHeight - 220;
      if (nearBottom.current) setBelow(0);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    bottom.current?.scrollIntoView();
    let stop = false;
    async function poll() {
      const res = await fetch(`/api/jobs/${initialJob.id}`, { cache: "no-store" }).catch(() => null);
      if (res?.ok && !stop) {
        const body = (await res.json()) as { job: Job; log: LogEvent[] };
        setJob(body.job);
        setLog((prev) => {
          const n = newEvents(prev, body.log);
          if (!n && body.log.length === prev.length) return prev;
          arrived.current = n ? body.log.slice(-n) : [];
          setDropped((d) => d + Math.max(0, prev.length + n - body.log.length));
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

  // New events (a tool step folded into the last chip counts too): follow them if you're at the
  // bottom, otherwise count them; and read new answers aloud in the agent's voice when that's on.
  useLayoutEffect(() => {
    const fresh = arrived.current;
    if (!fresh.length) return;
    arrived.current = [];
    if (nearBottom.current) requestAnimationFrame(() => bottom.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "end" }));
    else setBelow((b) => b + fresh.length);
    if (readAloud) {
      fresh.forEach((e, k) => {
        if (e.kind === "result" && e.ok !== false && e.text?.trim()) void speak(e.text, agent, `${job.id}:${dropped + log.length - fresh.length + k}`);
      });
    }
  }, [log, readAloud, agent, job.id, dropped]);

  useEffect(() => () => stopSpeaking(), []);

  async function post(payload: Record<string, unknown>) {
    const res = await fetch(`/api/jobs/${job.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  }

  const running = job.status === "running" || job.status === "queued";
  const preparing = job.status === "preparing";
  const lastStep = [...log].reverse().find((e) => e.kind === "tool")?.text;

  return (
    <div className="chat-skin chat-page mx-auto max-w-3xl pb-56" data-agent={agent} style={{ ["--agent" as string]: `var(--chat-accent, ${AGENT_HEX[agent]})` }}>
      <header className="chat-header pt-2 pb-5 lg:pt-6">
        <ChatIdentity agent={agent} state={job.status === "running" ? "working" : job.status === "closed" ? "idle" : "ready"}>
          <button
            onClick={() => {
              unlockAudio();
              const next = !readAloud;
              setReadAloud(next);
              if (!next) stopSpeaking();
              try {
                localStorage.setItem(readAloudKey, next ? "1" : "0");
              } catch {}
            }}
            role="switch"
            aria-label="Read aloud"
            aria-checked={readAloud}
            className={cn(
              "chat-read-aloud flex h-11 shrink-0 items-center gap-2 rounded-[10px] border px-3 text-xs transition-colors",
              readAloud ? "border-[color-mix(in_oklab,var(--agent),transparent_55%)] text-text" : "border-line text-muted hover:text-text",
            )}
          >
            {readAloud ? <Volume2 className="h-4 w-4" style={{ color: "var(--agent)" }} aria-hidden /> : <VolumeX className="h-4 w-4" aria-hidden />}
            <span className="hidden sm:inline">Read aloud</span>
          </button>
        </ChatIdentity>
        <h1 className="text-[1.7rem] leading-tight font-semibold tracking-[-0.03em] text-balance">{job.title}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-muted">
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
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <StatusPill tone={job.status === "failed" ? "bad" : running || preparing ? "live" : job.status === "waiting" ? "ok" : "neutral"} pulse={job.status === "running"}>
            {job.status === "queued" ? "Waiting for a slot" : job.status === "running" ? `${agentName} is ${AGENT_PERSONA[agent].verb}` : preparing ? "Preparing context" : job.status === "waiting" ? "Your turn" : job.status}
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
        {/* The agent's line: lit in its colour, with a light running along it while it works. */}
        <div className={cn("mt-5", running ? "live-trace" : "h-px")} style={running ? undefined : { background: "linear-gradient(90deg, color-mix(in oklab, var(--agent), transparent 55%), transparent 70%)" }} aria-hidden />
      </header>

      {job.imported && tab === "context" && <ContextPanel jobId={job.id} dossierState={job.imported.dossier} />}
      {job.imported && tab === "earlier" && <EarlierOnPc jobId={job.id} Tools={Tools} />}

      <div className={cn("chat-thread flex flex-col gap-6 text-[15px] leading-relaxed", job.imported && tab !== "chat" && "hidden")}>
        {blocks.length === 0 && !running && !preparing && <ChatEmpty agent={agent} />}
        {blocks.map((b, i) => {
          const fresh = dropped + b.at >= initialLog.length ? "msg-in" : undefined; // arrived while you watched
          const prev = blocks[i - 1];
          // A new agent turn starts after your message or a turn marker.
          const opensTurn = (b.kind === "agent" || b.kind === "result" || b.kind === "tools") && (!prev || prev.kind === "you" || prev.kind === "start");
          const head = opensTurn ? <Speaker agent={agent} /> : null;
          if (b.kind === "tools")
            return (
              <div key={dropped + b.at} className={cn("chat-agent-turn flex flex-col gap-3", fresh)}>
                {head}
                <Tools items={b.items} />
              </div>
            );
          if (b.kind === "start") return <p key={dropped + b.at} className={cn("hud-label pt-2 text-center !text-[9.5px]", fresh)}>{b.text}</p>;
          if (b.kind === "you")
            return (
              <div key={dropped + b.at} className={cn("chat-user max-w-[85%] self-end rounded-[20px] rounded-br-md bg-white/[0.08] px-4 py-2.5 whitespace-pre-wrap shadow-[0_1px_0_rgb(255_255_255/0.05)_inset]", fresh)}>
                <HighlightSkills text={b.text} />
              </div>
            );
          if (b.kind === "error")
            return (
              <p key={dropped + b.at} className={cn("rounded-2xl border border-bad/30 bg-bad/5 px-4 py-3 text-sm whitespace-pre-wrap text-bad", fresh)}>
                {b.text}
              </p>
            );
          if (b.kind === "result")
            return (
              <div key={dropped + b.at} className={cn("chat-agent-turn flex flex-col gap-3", fresh)}>
                {head}
                <div className="chat-answer panel relative px-4 pt-3.5 pb-1.5">
                  <span className="chat-answer-rule absolute inset-x-0 top-0 h-px" style={{ background: "linear-gradient(90deg, transparent, color-mix(in oklab, var(--agent), transparent 30%), transparent)" }} aria-hidden />
                  <Md text={b.text} />
                  <div className="chat-answer-actions -mx-1.5 mt-2 flex items-center gap-0.5 border-t border-line pt-1.5">
                    <Listen text={b.text} agent={agent} id={`${job.id}:${dropped + b.at}`} />
                    <CopyText text={b.text} />
                    {typeof b.cost === "number" && b.cost > 0 && <span className="tnum ml-auto pr-1.5 font-mono text-[10.5px] text-faint">${b.cost.toFixed(2)}</span>}
                  </div>
                </div>
              </div>
            );
          return (
            <div key={dropped + b.at} className={cn("chat-agent-turn chat-prose flex flex-col gap-3 text-text/90", fresh)}>
              {head}
              <Md text={b.text} />
            </div>
          );
        })}
        {(running || preparing) && (
          <div className="msg-in flex items-center gap-3 py-1" role="status">
            <AgentLogo agent={agent} size="sm" state="working" />
            <div className="min-w-0 flex-1">
              <p className="text-sm">
                {preparing ? "Getting the code, the chat and the project dossier ready" : job.status === "queued" ? "Waiting for a free slot" : `${agentName} is ${AGENT_PERSONA[agent].verb}`}
                <span className="text-faint">…</span>
              </p>
              {job.status === "running" && lastStep && <p className="truncate font-mono text-[11px] text-faint">{lastStep}</p>}
            </div>
          </div>
        )}
        {/* Scrolling to it keeps the newest message clear of the composer and the tab bar. */}
        <div ref={bottom} className="scroll-mb-[calc(240px+env(safe-area-inset-bottom))] lg:scroll-mb-48" />
      </div>

      {below > 0 && (
        <button
          onClick={() => bottom.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "end" })}
          className="msg-in fixed bottom-[calc(208px+env(safe-area-inset-bottom))] left-1/2 z-20 flex h-9 -translate-x-1/2 items-center gap-1.5 rounded-full border border-[color-mix(in_oklab,var(--agent),transparent_55%)] bg-bg-raised/95 px-3.5 text-xs shadow-[0_10px_30px_-12px_rgb(0_0_0/0.9)] backdrop-blur lg:bottom-40 lg:left-[calc(50%+124px)]"
        >
          <ArrowDown className="h-3.5 w-3.5" style={{ color: "var(--agent)" }} aria-hidden /> New from {agentName}
        </button>
      )}

      <ReplyBar
        identity={agent}
        placeholder={
          job.owner === "pc" ? "Back on the PC" : job.owner === "returning" ? "Returning to the PC" : job.status === "closed" ? (job.issueId ? "Issue is closed in Linear" : "Chat archived") : `Message ${agentName}…`
        }
        disabled={job.status === "closed" || job.owner === "returning" || job.owner === "pc"}
        agent={job.agent === "claude" || job.agent === "codex" || job.agent === "opencode" || job.agent === "hermes" ? job.agent : undefined}
        onSend={async (prompt, skills) => {
          await post({ action: "reply", prompt, skills });
          return job.status === "running" ? `Queued — ${agentName} gets it when this turn ends.` : `Sent — ${agentName} is picking it up.`;
        }}
      />
    </div>
  );
}
