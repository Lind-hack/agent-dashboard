"use client";

import { ArrowLeft, ChevronDown, Flame, Gavel, LoaderCircle, Play, Square, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AgentLogo } from "@/components/agent-logo";
import { Md } from "@/components/md";
import { AGENT_LABELS, AGENT_META, type AgentKey } from "@/lib/agents";
import type { JudgeRound, Room, RoomAnswer, Verdict } from "@/lib/rooms";
import { cn } from "@/lib/utils";

// A Roast room, live: agreement meter, each round's answers per agent (position, confidence, who they
// agree with, what they roasted), the judge's notes, and the verdict with "Run it".

const ACTIVE = new Set(["queued", "evidence", "debating", "judging"]);
const label = (a: string) => AGENT_LABELS[a as AgentKey] ?? a;
const isAgent = (a: string): a is AgentKey => a in AGENT_META && a !== "codex-cloud";
const stripJSON = (t: string) => t.replace(/```json[\s\S]*?```\s*$/, "").trim();

function Segments({ value, n = 30, className }: { value: number; n?: number; className?: string }) {
  const lit = Math.round((value / 100) * n);
  return (
    <div className={cn("flex h-3 gap-[3px]", className)} aria-hidden>
      {Array.from({ length: n }, (_, i) => (
        <span
          key={i}
          className="flex-1 rounded-[2px]"
          style={i < lit ? { background: value >= 80 ? "var(--color-ok)" : "var(--color-hud)", opacity: 0.45 + (i / n) * 0.55, boxShadow: `0 0 8px -2px ${value >= 80 ? "var(--color-ok)" : "var(--color-hud)"}` } : { background: "rgb(255 255 255 / 0.06)" }}
        />
      ))}
    </div>
  );
}

function Elapsed({ since }: { since?: string }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);
  if (!since) return null;
  const s = Math.max(0, Math.round((Date.now() - new Date(since).getTime()) / 1000));
  return <span className="tnum font-mono">{s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`}</span>;
}

function AnswerCard({ agent, ans, model, round }: { agent: AgentKey; ans?: RoomAnswer; model?: string; round: number }) {
  const [open, setOpen] = useState(false);
  const j = ans?.json;
  const conf = typeof j?.confidence === "number" ? Math.round(Math.max(0, Math.min(1, j.confidence)) * 100) : null;
  return (
    <article className="panel flex min-w-0 snap-start flex-col gap-3 p-4 max-lg:w-[86vw] max-lg:max-w-[420px] max-lg:shrink-0">
      <header className="flex items-center gap-3">
        <AgentLogo agent={agent} size="md" state={ans?.status === "running" ? "working" : ans?.status === "failed" ? "off" : "ready"} />
        <div className="min-w-0 flex-1 leading-tight">
          <p className="text-[15px] font-medium">{AGENT_LABELS[agent]}</p>
          <p className="truncate font-mono text-[10.5px] text-faint">{model}</p>
        </div>
        {conf !== null && (
          <p className="tnum text-right leading-none">
            <span className="text-[1.5rem] font-semibold tracking-[-0.04em]">{conf}</span>
            <span className="text-xs text-muted">%</span>
            <span className="hud-label block !text-[9px]">sure</span>
          </p>
        )}
      </header>

      {ans?.status === "running" || ans?.status === "waiting" || !ans ? (
        <p className="flex items-center gap-2 text-sm text-muted">
          <LoaderCircle className="h-4 w-4 animate-spin text-hud" />
          {ans?.status === "running" ? (
            <>
              {round === 1 ? "Thinking" : "Reading the others and roasting"} · <Elapsed since={ans.startedAt} />
            </>
          ) : (
            "Waiting for its turn"
          )}
        </p>
      ) : ans.status === "failed" ? (
        <p className="text-sm text-bad">{ans.error ?? "No answer."}</p>
      ) : (
        <>
          <p className="text-[15px] leading-snug font-medium text-balance">{j?.position ?? "No structured answer — read the full reply."}</p>
          {(j?.agrees_with?.filter(isAgent).length ?? 0) > 0 && (
            <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
              Agrees with
              {j!.agrees_with!.filter(isAgent).map((a) => (
                <span key={a} className="flex items-center gap-1 rounded-md bg-white/[0.04] py-0.5 pr-1.5 pl-0.5 text-text/90">
                  <AgentLogo agent={a} size="xs" /> {AGENT_LABELS[a]}
                </span>
              ))}
            </p>
          )}
          {(j?.weakest_claims?.length ?? 0) > 0 && (
            <ul className="flex flex-col gap-2 border-t border-line pt-3">
              {j!.weakest_claims!.slice(0, 4).map((w, i) => (
                <li key={i} className="flex gap-2 text-[13px] leading-snug">
                  <Flame className="mt-0.5 h-3.5 w-3.5 shrink-0 text-claude" />
                  <span className="min-w-0">
                    <span className="font-medium">{label(w.agent ?? "")}:</span> <span className="text-text/85">{w.claim}</span>
                    {w.why && <span className="text-muted"> — {w.why}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <button onClick={() => setOpen(!open)} aria-expanded={open} className="flex items-center gap-1.5 self-start text-xs text-muted hover:text-text">
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} /> {open ? "Hide" : "Full answer"}
          </button>
          {open && (
            <div className="border-t border-line pt-3 text-[14px] leading-relaxed">
              <Md text={stripJSON(ans.text ?? "")} />
              {(j?.evidence?.length ?? 0) > 0 && (
                <p className="mt-3 font-mono text-[11px] text-faint">Evidence: {j!.evidence!.map((e) => e.ref).filter(Boolean).join(" · ")}</p>
              )}
            </div>
          )}
        </>
      )}
    </article>
  );
}

function JudgeStrip({ judge, error }: { judge?: JudgeRound | null; error?: string }) {
  if (!judge) return error ? <p className="px-1 text-xs text-warn">{error}</p> : null;
  return (
    <div className="panel flex flex-col gap-3 p-4 text-sm">
      <div className="flex items-center gap-3">
        <Gavel className="h-4 w-4 shrink-0 text-hud" />
        <p className="hud-label !text-muted">Judge · {judge.model}</p>
        <p className="tnum ml-auto font-mono text-xs">{judge.agreement}% agree</p>
      </div>
      {judge.open_disagreements.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {judge.open_disagreements.map((d, i) => (
            <span key={i} className={cn("rounded-md border px-2 py-1 text-xs", d.blocking ? "border-bad/40 text-bad" : "border-line text-muted")} title={d.sides}>
              {d.blocking && "Blocking · "}
              {d.topic}
            </span>
          ))}
        </div>
      )}
      {judge.per_agent.some((p) => p.changed) && (
        <p className="text-xs text-muted">
          Changed position:{" "}
          {judge.per_agent
            .filter((p) => p.changed)
            .map((p) => `${label(p.agent)}${p.why ? ` (${p.why})` : ""}`)
            .join("; ")}
        </p>
      )}
      {judge.unverified_claims.length > 0 && (
        <details className="text-xs text-muted">
          <summary className="cursor-pointer hover:text-text">{judge.unverified_claims.length} unverified claim{judge.unverified_claims.length > 1 ? "s" : ""}</summary>
          <ul className="mt-2 flex flex-col gap-1">
            {judge.unverified_claims.map((u, i) => (
              <li key={i}>
                <span className="text-text/80">{label(u.agent)}:</span> {u.claim}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

const OUTCOME: Record<Verdict["outcome"], { text: string; tone: string }> = {
  consensus: { text: "Consensus", tone: "text-ok border-ok/40" },
  split: { text: "Split decision", tone: "text-warn border-warn/40" },
  incomplete: { text: "Incomplete", tone: "text-warn border-warn/40" },
  "no-verdict": { text: "No verdict", tone: "text-bad border-bad/40" },
};

function VerdictCard({ room, onRun, running, repos }: { room: Room; onRun: (a: AgentKey, repo: string) => void; running: AgentKey | null; repos: string[] }) {
  const v = room.verdict!;
  const [repo, setRepo] = useState("");
  const order = [...room.agents].sort((a, b) => (a === v.best_agent ? -1 : b === v.best_agent ? 1 : (v.support[b] ?? 0) - (v.support[a] ?? 0)));
  return (
    <section className="panel brackets flex flex-col gap-5 p-4 sm:p-5" aria-label="Verdict">
      <div className="flex flex-wrap items-center gap-3">
        <Gavel className="h-5 w-5 text-hud" />
        <h2 className="text-lg font-semibold tracking-[-0.02em]">Verdict</h2>
        <span className={cn("rounded-md border px-2 py-0.5 text-xs", OUTCOME[v.outcome].tone)}>{OUTCOME[v.outcome].text}</span>
        <span className="font-mono text-[11px] text-faint">judged by {v.model} · a recommendation, not proof</span>
      </div>

      {Object.keys(v.support).length > 0 && (
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          {order.map((a) => {
            const pct = v.support[a] ?? 0;
            const best = a === v.best_agent;
            return (
              <div
                key={a}
                className={cn("flex flex-col gap-2 rounded-[14px] border p-3", best ? "border-transparent bg-white/[0.05]" : "border-line")}
                style={best ? { boxShadow: `0 0 0 1px ${AGENT_META[a].color} inset, 0 14px 34px -18px ${AGENT_META[a].color}` } : undefined}
              >
                <div className="flex items-center gap-2">
                  <AgentLogo agent={a} size="sm" />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{AGENT_LABELS[a]}</span>
                  {best && <span className="hud-label !text-[9px] !text-text">picked</span>}
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                  <div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${pct}%`, background: AGENT_META[a].color }} />
                </div>
                <p className="tnum font-mono text-xs text-muted">{pct}% support</p>
              </div>
            );
          })}
        </div>
      )}

      <div className="text-[15px] leading-relaxed">
        <Md text={v.recommendation} />
      </div>
      {v.next_step && (
        <p className="rounded-[12px] border border-line bg-white/[0.02] px-3 py-2.5 text-sm">
          <span className="hud-label mr-2">Next step</span>
          {v.next_step}
        </p>
      )}
      {v.dissent.length > 0 && (
        <div>
          <p className="hud-label mb-1.5">Dissent</p>
          <ul className="flex flex-col gap-1 text-sm text-muted">
            {v.dissent.map((d, i) => (
              <li key={i} className="flex gap-2">
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" /> {d}
              </li>
            ))}
          </ul>
        </div>
      )}

      {v.outcome !== "no-verdict" && !room.repo && (
        <label className="flex flex-col gap-1.5 border-t border-line pt-4 text-xs text-muted">
          This debate had no repo — pick where the work should happen (Hermes doesn&apos;t need one):
          <select value={repo} onChange={(e) => setRepo(e.target.value)} className="min-h-10 rounded-[10px] border border-line bg-white/[0.02] px-3 text-sm text-text outline-none focus:border-line-hi">
            <option value="">Choose a repo…</option>
            {repos.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
      )}
      {v.outcome !== "no-verdict" && (
        <div className={cn("flex flex-wrap gap-2", room.repo && "border-t border-line pt-4")}>
          {order.map((a, i) => (
            <button
              key={a}
              onClick={() => onRun(a, repo)}
              disabled={running !== null || (!room.repo && !repo && AGENT_META[a].repo)}
              className={cn(
                "flex min-h-10 items-center gap-2 rounded-[12px] px-3.5 text-sm disabled:opacity-40",
                i === 0 ? "bg-text font-medium text-bg" : "border border-line text-muted hover:border-line-hi hover:text-text",
              )}
            >
              {running === a ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Play className="h-3.5 w-3.5" />} Run it with {AGENT_LABELS[a]}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

const STATUS_LINE: Record<Room["status"], string> = {
  queued: "Waiting to start",
  evidence: "Reading the repo for evidence",
  debating: "Debating",
  judging: "The judge is scoring this round",
  done: "Done",
  cancelled: "Stopped",
  refused: "Refused",
};

export function RoomView({ initial, repos = [] }: { initial: Room; repos?: string[] }) {
  const router = useRouter();
  const [room, setRoom] = useState(initial);
  const [running, setRunning] = useState<AgentKey | null>(null);
  const [error, setError] = useState("");
  const live = ACTIVE.has(room.status);

  useEffect(() => {
    if (!live) return;
    let stop = false;
    const t = setInterval(async () => {
      const res = await fetch(`/api/rooms/${initial.id}`, { cache: "no-store" }).catch(() => null);
      const b = (await res?.json().catch(() => null)) as { room?: Room } | null;
      if (!stop && b?.room) setRoom(b.room);
    }, 3000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [initial.id, live]);

  async function act(body: Record<string, string>) {
    setError("");
    const res = await fetch(`/api/rooms/${room.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    const b = await res?.json().catch(() => null);
    if (!res?.ok) {
      setRunning(null);
      return setError(b?.error ?? "Couldn't reach the dashboard.");
    }
    if (b?.href) router.push(b.href);
  }

  const scores = room.rounds.map((r) => r.judge?.agreement).filter((x): x is number => typeof x === "number");
  const latest = scores.at(-1) ?? null;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 pb-10">
      <header className="pt-2 lg:pt-5">
        <Link href="/room" className="mb-3 inline-flex items-center gap-1.5 text-xs text-muted hover:text-text">
          <ArrowLeft className="h-3.5 w-3.5" /> Room
        </Link>
        <div className="flex flex-wrap items-start gap-4">
          <h1 className="min-w-0 flex-1 text-[1.6rem] leading-tight font-semibold tracking-[-0.03em] text-balance lg:text-[2rem]">{room.task.split("\n")[0]}</h1>
          {live && (
            <button onClick={() => act({ action: "cancel" })} className="flex min-h-9 items-center gap-1.5 rounded-[10px] border border-bad/40 px-3 text-xs text-bad">
              <Square className="h-3 w-3 fill-current" /> Stop
            </button>
          )}
        </div>
        <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-faint">
          <span className={cn("flex items-center gap-1.5", live ? "text-hud" : "")}>
            {live && <LoaderCircle className="h-3 w-3 animate-spin" />}
            {STATUS_LINE[room.status]}
            {room.reason && ` — ${room.reason}`}
          </span>
          {room.repo && <span>{room.repo}</span>}
          {room.evidence && <span>{room.evidence.files.length ? `evidence: ${room.evidence.files.length} files · ${Math.round(room.evidence.bytes / 1024)} KB` : (room.evidence.note ?? "no evidence")}</span>}
          <span className="tnum">
            calls {room.budget.used}/{room.budget.calls}
          </span>
        </p>
      </header>

      <section className="panel flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:gap-6">
        <div className="flex items-baseline gap-3 sm:w-48 sm:shrink-0">
          <p className="tnum text-[2.6rem] leading-none font-semibold tracking-[-0.05em]">{latest ?? "—"}</p>
          <p className="hud-label">% agreement</p>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <Segments value={latest ?? 0} />
          <p className="tnum font-mono text-[11px] text-faint">
            {scores.length ? scores.map((s, i) => `R${i + 1} ${s}`).join("  →  ") : "Scored by the judge after each round · consensus at 80"}
          </p>
        </div>
      </section>

      {room.verdict && <VerdictCard room={room} repos={repos} running={running} onRun={(a, repo) => (setRunning(a), void act({ action: "run", agent: a, repo }))} />}
      {error && <p className="rounded-[12px] border border-bad/30 bg-bad/5 px-3 py-2 text-sm text-bad">{error}</p>}

      {[...room.rounds].reverse().map((round) => (
        <section key={round.n} className="flex flex-col gap-3" aria-label={`Round ${round.n}`}>
          <h2 className="hud-label px-1 !text-[11px] !text-muted">
            Round {round.n} · {round.n === 1 ? "independent answers" : "roast and revise"}
          </h2>
          <div className={cn("-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 lg:mx-0 lg:grid lg:overflow-visible lg:px-0", room.agents.length >= 4 ? "lg:grid-cols-4" : room.agents.length === 3 ? "lg:grid-cols-3" : "lg:grid-cols-2")}>
            {room.agents.map((a) => (
              <AnswerCard key={a} agent={a} ans={round.answers[a]} model={room.models[a]} round={round.n} />
            ))}
          </div>
          <JudgeStrip judge={round.judge} error={round.judgeError} />
        </section>
      ))}

      {room.rounds.length === 0 && live && (
        <p className="panel flex items-center gap-2 p-4 text-sm text-muted">
          <LoaderCircle className="h-4 w-4 animate-spin text-hud" /> {STATUS_LINE[room.status]}…
        </p>
      )}
    </div>
  );
}
