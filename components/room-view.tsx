"use client";

import { ArrowLeft, CalendarPlus, Check, ChevronDown, Crown, Flame, Gavel, LoaderCircle, Play, ShieldAlert, Square, Swords, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AgentLogo } from "@/components/agent-logo";
import { Md } from "@/components/md";
import { AGENT_LABELS, AGENT_META, type AgentKey } from "@/lib/agents";
import type { Seat } from "@/lib/council";
import type { JudgeRound, Room, RoomAnswer, Verdict } from "@/lib/rooms";
import { cn } from "@/lib/utils";
import { CountUp } from "./motion";
import { SeatBadge } from "./seat-badge";

// A Roast room, live: who's at the table (agents and council seats), each round's answers, the judge's
// agreement and rubric scores, and the decision memo — decision, why, the strongest objection and its
// answer, risks, and up to three actions that go to an agent or today's plan in one tap.

const ACTIVE = new Set(["queued", "evidence", "debating", "judging"]);
const stripJSON = (t: string) => t.replace(/```json[\s\S]*?```\s*$/, "").trim();
const isSeatKey = (d: string) => d.startsWith("seat:");
const isAgent = (a: string): a is AgentKey => a in AGENT_META && a !== "codex-cloud";

type Roster = Record<string, Seat>;
const everyone = (r: Room) => [...r.agents, ...(r.seats ?? []).map((k) => `seat:${k}`)];
const nameOf = (d: string, roster: Roster) => (isSeatKey(d) ? (roster[d.slice(5)]?.name ?? d.slice(5)) : (AGENT_LABELS[d as AgentKey] ?? d));
const colorOf = (d: string, roster: Roster) => (isSeatKey(d) ? (roster[d.slice(5)]?.color ?? "#b392f0") : (AGENT_META[d as AgentKey]?.color ?? "#b392f0"));

function Mark({ d, roster, size = "md", state }: { d: string; roster: Roster; size?: "xs" | "sm" | "md" | "lg"; state?: "working" | "off" | "ready" | "idle" }) {
  if (isSeatKey(d)) {
    const s = roster[d.slice(5)];
    if (!s) return <span className="grid h-9 w-9 place-items-center rounded-[10px] bg-white/5 font-mono text-[10px]">?</span>;
    return <SeatBadge seat={s} size={size === "lg" ? "lg" : size === "md" ? "md" : "sm"} active={state === "working"} className={state === "working" ? "animate-pulse motion-reduce:animate-none" : undefined} />;
  }
  return isAgent(d) ? <AgentLogo agent={d} size={size} state={state} /> : null;
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

function AnswerCard({ d, ans, model, round, roster }: { d: string; ans?: RoomAnswer; model?: string; round: number; roster: Roster }) {
  const [open, setOpen] = useState(false);
  const j = ans?.json;
  const conf = typeof j?.confidence === "number" ? Math.round(Math.max(0, Math.min(1, j.confidence)) * 100) : null;
  const seat = isSeatKey(d) ? roster[d.slice(5)] : undefined;
  return (
    <article className="panel lift relative flex min-w-0 snap-start flex-col gap-3 overflow-hidden p-4 max-lg:w-[86vw] max-lg:max-w-[420px] max-lg:shrink-0">
      <span className="pointer-events-none absolute inset-x-0 top-0 h-[2px]" style={{ background: `linear-gradient(90deg, transparent, ${colorOf(d, roster)}, transparent)` }} aria-hidden />
      <header className="flex items-center gap-3">
        <Mark d={d} roster={roster} state={ans?.status === "running" ? "working" : ans?.status === "failed" ? "off" : "ready"} />
        <div className="min-w-0 flex-1 leading-tight">
          <p className="text-[15px] font-medium">{nameOf(d, roster)}</p>
          <p className="truncate font-mono text-[10.5px] text-faint">{seat ? seat.pillar : model}</p>
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
        <div className="flex flex-col gap-2">
          <p className="flex items-center gap-2 text-sm text-muted">
            <LoaderCircle className="h-4 w-4 animate-spin" style={{ color: colorOf(d, roster) }} />
            {ans?.status === "running" ? (
              <>
                {round === 1 ? (seat ? "Thinking it through in its lens" : "Thinking") : "Reading the others and roasting"} · <Elapsed since={ans.startedAt} />
              </>
            ) : (
              "Waiting for its turn"
            )}
          </p>
          {ans?.status === "running" && <span className="shimmer h-16 rounded-[10px] bg-white/[0.025]" aria-hidden />}
        </div>
      ) : ans.status === "failed" ? (
        <p className="text-sm text-bad">{ans.error ?? "No answer."}</p>
      ) : (
        <>
          <p className="text-[15px] leading-snug font-medium text-balance">{j?.position ?? "No structured answer — read the full reply."}</p>
          {(j?.agrees_with?.length ?? 0) > 0 && (
            <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
              Agrees with
              {j!.agrees_with!.map((a) => (
                <span key={a} className="flex items-center gap-1 rounded-md bg-white/[0.04] py-0.5 pr-1.5 pl-0.5 text-text/90">
                  <Mark d={a} roster={roster} size="xs" /> {nameOf(a, roster)}
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
                    <span className="font-medium">{nameOf(w.agent ?? "", roster)}:</span> <span className="text-text/85">{w.claim}</span>
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
              {(j?.evidence?.length ?? 0) > 0 && <p className="mt-3 font-mono text-[11px] text-faint">Evidence: {j!.evidence!.map((e) => e.ref).filter(Boolean).join(" · ")}</p>}
            </div>
          )}
        </>
      )}
    </article>
  );
}

function JudgeStrip({ judge, error, roster }: { judge?: JudgeRound | null; error?: string; roster: Roster }) {
  if (!judge) return error ? <p className="px-1 text-xs text-warn">{error}</p> : null;
  const scores = [...(judge.scores ?? [])].sort((a, z) => z.total - a.total);
  return (
    <div className="panel flex flex-col gap-3 p-4 text-sm">
      <div className="flex items-center gap-3">
        <Gavel className="h-4 w-4 shrink-0 text-hud" />
        <p className="hud-label !text-muted">Judge · {judge.model}</p>
        <p className="tnum ml-auto font-mono text-xs">{judge.agreement}% agree</p>
      </div>
      {scores.length > 0 && (
        <ul className="grid gap-2 sm:grid-cols-2">
          {scores.map((s) => (
            <li key={s.agent} className="flex items-center gap-2.5" title={s.note}>
              <Mark d={s.agent} roster={roster} size="xs" />
              <span className="w-24 shrink-0 truncate text-xs">{nameOf(s.agent, roster)}</span>
              <span className="flex h-2 flex-1 overflow-hidden rounded-full bg-white/[0.05]" aria-label={`evidence ${s.evidence}, reasoning ${s.reasoning}, practicality ${s.practicality}, responsiveness ${s.responsiveness}`}>
                {([
                  [s.evidence, "#7c98ff"],
                  [s.reasoning, "#b392f0"],
                  [s.practicality, "#5fd39a"],
                  [s.responsiveness, "#f2c14e"],
                ] as const).map(([v, c], i) => (
                  <span key={i} className="h-full transition-[width] duration-700" style={{ width: `${(v / 40) * 100}%`, background: c }} />
                ))}
              </span>
              <span className="tnum w-9 shrink-0 text-right font-mono text-[11px] text-muted">{s.total}/40</span>
            </li>
          ))}
        </ul>
      )}
      {scores.length > 0 && (
        <p className="flex flex-wrap gap-x-3 text-[10.5px] text-faint">
          <span><i className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-[#7c98ff]" />evidence</span>
          <span><i className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-[#b392f0]" />reasoning</span>
          <span><i className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-[#5fd39a]" />practicality</span>
          <span><i className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-[#f2c14e]" />responsiveness</span>
        </p>
      )}
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
            .map((p) => `${nameOf(p.agent, roster)}${p.why ? ` (${p.why})` : ""}`)
            .join("; ")}
        </p>
      )}
      {judge.unverified_claims.length > 0 && (
        <details className="text-xs text-muted">
          <summary className="cursor-pointer hover:text-text">
            {judge.unverified_claims.length} unverified claim{judge.unverified_claims.length > 1 ? "s" : ""}
          </summary>
          <ul className="mt-2 flex flex-col gap-1">
            {judge.unverified_claims.map((u, i) => (
              <li key={i}>
                <span className="text-text/80">{nameOf(u.agent, roster)}:</span> {u.claim}
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

// The decision memo (v4 rooms). Older rooms fall back to the recommendation text.
function MemoCard({ room, roster, repos, onRun, onPlan, busy }: { room: Room; roster: Roster; repos: string[]; onRun: (agent: AgentKey, repo: string, title?: string) => void; onPlan: (title: string) => Promise<boolean>; busy: string }) {
  const v = room.verdict!;
  const [repo, setRepo] = useState("");
  const [planned, setPlanned] = useState<Set<string>>(new Set());
  const runner: AgentKey | undefined = (v.best_agent && isAgent(v.best_agent) ? v.best_agent : undefined) ?? room.agents.find((a) => a !== "hermes") ?? "claude";
  const board = v.scoreboard ?? [];
  const top = Math.max(1, ...board.map((b) => b.score));
  const needsRepo = !room.repo && AGENT_META[runner]?.repo;
  const actions = v.actions?.length ? v.actions : v.next_step ? [{ title: v.next_step, who: "agent" as const }] : [];

  return (
    <section className="panel brackets land relative flex flex-col gap-6 overflow-hidden p-5 sm:p-6" aria-label="Decision memo">
      <span className="pointer-events-none absolute inset-0 bg-[radial-gradient(600px_220px_at_0%_0%,rgb(179_146_240/0.14),transparent_70%),radial-gradient(500px_200px_at_100%_100%,rgb(232_121_201/0.1),transparent_70%)]" aria-hidden />
      <div className="relative flex flex-wrap items-center gap-3">
        <Gavel className="h-5 w-5 text-hermes" />
        <h2 className="text-lg font-semibold tracking-[-0.02em]">Decision memo</h2>
        <span className={cn("rounded-md border px-2 py-0.5 text-xs", OUTCOME[v.outcome].tone)}>{OUTCOME[v.outcome].text}</span>
        <span className="font-mono text-[11px] text-faint">judged by {v.model}</span>
        {typeof v.confidence === "number" && (
          <span className="ml-auto flex items-baseline gap-1">
            <span className="text-2xl font-semibold tracking-[-0.04em]">
              <CountUp value={v.confidence} />
            </span>
            <span className="hud-label !text-[9px]">% confident</span>
          </span>
        )}
      </div>

      {v.decision ? (
        <p className="relative text-[1.45rem] leading-snug font-semibold tracking-[-0.025em] text-balance">{v.decision}</p>
      ) : (
        <div className="relative text-[15px] leading-relaxed">
          <Md text={v.recommendation} />
        </div>
      )}

      {v.why && (
        <div className="relative text-[15px] leading-relaxed text-text/90">
          <Md text={v.why} />
        </div>
      )}

      {v.objection && (
        <div className="relative grid gap-3 sm:grid-cols-2">
          <div className="rounded-[14px] border border-bad/25 bg-bad/[0.05] p-4">
            <p className="hud-label mb-1.5 flex items-center gap-1.5 !text-bad">
              <ShieldAlert className="h-3.5 w-3.5" /> Strongest objection
            </p>
            <p className="text-sm leading-relaxed">{v.objection.claim}</p>
          </div>
          <div className="rounded-[14px] border border-ok/25 bg-ok/[0.05] p-4">
            <p className="hud-label mb-1.5 flex items-center gap-1.5 !text-ok">
              <Check className="h-3.5 w-3.5" /> The answer
            </p>
            <p className="text-sm leading-relaxed">{v.objection.answer}</p>
          </div>
        </div>
      )}

      {(v.risks?.length ?? 0) > 0 && (
        <div className="relative">
          <p className="hud-label mb-2">Risks to watch</p>
          <ul className="flex flex-col gap-1.5 text-sm text-muted">
            {v.risks!.map((r, i) => (
              <li key={i} className="flex gap-2">
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" /> {r}
              </li>
            ))}
          </ul>
        </div>
      )}

      {actions.length > 0 && v.outcome !== "no-verdict" && (
        <div className="relative">
          <p className="hud-label mb-2">Next actions</p>
          {needsRepo && (
            <select value={repo} onChange={(e) => setRepo(e.target.value)} aria-label="Repo for agent work" className="mb-2 min-h-10 w-full rounded-[10px] border border-line bg-white/[0.02] px-3 text-sm text-text outline-none focus:border-line-hi sm:w-auto">
              <option value="">Repo for agent work…</option>
              {repos.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          )}
          <ol className="stagger flex flex-col gap-2">
            {actions.map((a, i) => (
              <li key={i} className="flex flex-wrap items-center gap-3 rounded-[14px] border border-line bg-black/20 p-3">
                <span className="tnum grid h-7 w-7 shrink-0 place-items-center rounded-full bg-white/[0.06] font-mono text-xs">{i + 1}</span>
                <span className="min-w-0 flex-1 text-[14px] leading-snug">{a.title}</span>
                <span className="flex shrink-0 gap-1.5">
                  <button
                    onClick={() => onRun(runner, repo, a.title)}
                    disabled={!!busy || (needsRepo && !repo)}
                    className={cn("press flex h-9 items-center gap-1.5 rounded-[10px] px-3 text-xs disabled:opacity-40", a.who === "agent" ? "bg-text font-medium text-bg" : "border border-line text-muted hover:text-text")}
                  >
                    {busy === `run:${a.title}` ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} {AGENT_LABELS[runner]}
                  </button>
                  <button
                    onClick={async () => {
                      if (await onPlan(a.title)) setPlanned((p) => new Set([...p, a.title]));
                    }}
                    disabled={!!busy || planned.has(a.title)}
                    className={cn("press flex h-9 items-center gap-1.5 rounded-[10px] px-3 text-xs disabled:opacity-60", a.who === "lind" ? "bg-text font-medium text-bg" : "border border-line text-muted hover:text-text")}
                  >
                    {planned.has(a.title) ? <Check className="h-3.5 w-3.5" /> : <CalendarPlus className="h-3.5 w-3.5" />} {planned.has(a.title) ? "On today" : "Today"}
                  </button>
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {board.length > 0 && (
        <div className="relative border-t border-line pt-5">
          <p className="hud-label mb-3">Who argued best · judge&apos;s rubric over every round</p>
          <ul className="flex flex-col gap-2.5">
            {board.map((b) => {
              const win = b.agent === v.winner;
              return (
                <li key={b.agent} className="flex items-center gap-3">
                  <Mark d={b.agent} roster={roster} size="sm" />
                  <span className="w-32 shrink-0 truncate text-sm">
                    {nameOf(b.agent, roster)} {win && <Crown className="inline h-3.5 w-3.5 text-warn" aria-label="winner" />}
                  </span>
                  <span className="h-2 flex-1 overflow-hidden rounded-full bg-white/[0.05]">
                    <span className="block h-full rounded-full transition-[width] duration-1000 ease-[var(--ease-out-expo)]" style={{ width: `${(b.score / top) * 100}%`, background: colorOf(b.agent, roster), boxShadow: win ? `0 0 12px ${colorOf(b.agent, roster)}` : undefined }} />
                  </span>
                  <span className="tnum w-10 text-right font-mono text-xs text-muted">{b.score}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {v.dissent.length > 0 && (
        <details className="relative text-sm text-muted">
          <summary className="cursor-pointer hover:text-text">Dissent ({v.dissent.length})</summary>
          <ul className="mt-2 flex flex-col gap-1">
            {v.dissent.map((d, i) => (
              <li key={i} className="flex gap-2">
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" /> {d}
              </li>
            ))}
          </ul>
        </details>
      )}
      {v.decision && (
        <details className="relative text-sm">
          <summary className="cursor-pointer text-muted hover:text-text">Full recommendation</summary>
          <div className="mt-2 leading-relaxed">
            <Md text={v.recommendation} />
          </div>
        </details>
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

export function RoomView({ initial, repos = [], seats = [] }: { initial: Room; repos?: string[]; seats?: Seat[] }) {
  const router = useRouter();
  const roster: Roster = Object.fromEntries(seats.map((s) => [s.key, s]));
  const [room, setRoom] = useState(initial);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const live = ACTIVE.has(room.status);
  const table = everyone(room);

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

  async function act(body: Record<string, string>, tag: string): Promise<boolean> {
    setError("");
    setNote("");
    setBusy(tag);
    const res = await fetch(`/api/rooms/${room.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    const b = await res?.json().catch(() => null);
    setBusy("");
    if (!res?.ok) {
      setError(b?.error ?? "Couldn't reach the dashboard.");
      return false;
    }
    if (b?.href) router.push(b.href);
    if (b?.block) setNote(`Added to today at ${b.block.start} — the Coach will remind you.`);
    return true;
  }

  const scores = room.rounds.map((r) => r.judge?.agreement).filter((x): x is number => typeof x === "number");
  const latest = scores.at(-1) ?? null;
  const current = room.rounds.at(-1);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 pb-10">
      <header className="pt-2 lg:pt-5">
        <Link href="/room" className="mb-3 inline-flex items-center gap-1.5 text-xs text-muted hover:text-text">
          <ArrowLeft className="h-3.5 w-3.5" /> Room
        </Link>
        <div className="flex flex-wrap items-start gap-4">
          <h1 className="min-w-0 flex-1 text-[1.6rem] leading-tight font-semibold tracking-[-0.03em] text-balance lg:text-[2rem]">{room.task.split("\n")[0]}</h1>
          {live && (
            <button onClick={() => void act({ action: "cancel" }, "cancel")} className="press flex min-h-9 items-center gap-1.5 rounded-[10px] border border-bad/40 px-3 text-xs text-bad">
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

      {/* The table: everyone seated, lit while they speak. */}
      <section className="panel relative overflow-hidden p-4 sm:p-5">
        <span className="pointer-events-none absolute inset-0 bg-[radial-gradient(500px_160px_at_50%_0%,rgb(240_108_108/0.08),transparent_70%)]" aria-hidden />
        <div className="relative flex flex-wrap items-center gap-6">
          <div className="flex items-center gap-2">
            <Swords className="h-4 w-4 text-claude" />
            <p className="hud-label">At the table · {table.length}</p>
          </div>
          <ul className="flex flex-1 flex-wrap gap-3">
            {table.map((d) => {
              const st = current?.answers[d]?.status;
              return (
                <li key={d} className={cn("flex items-center gap-2 rounded-[12px] border px-2.5 py-1.5 transition-colors", st === "running" ? "border-transparent bg-white/[0.06]" : "border-line")} style={st === "running" ? { boxShadow: `0 0 0 1px ${colorOf(d, roster)} inset, 0 0 22px -8px ${colorOf(d, roster)}` } : undefined}>
                  <Mark d={d} roster={roster} size="sm" state={st === "running" ? "working" : st === "failed" ? "off" : "ready"} />
                  <span className="text-[13px]">{nameOf(d, roster)}</span>
                  {st === "done" && <Check className="h-3.5 w-3.5 text-ok" />}
                </li>
              );
            })}
          </ul>
          <div className="flex items-baseline gap-2">
            <p className="tnum text-[2.2rem] leading-none font-semibold tracking-[-0.05em]">{latest ?? "—"}</p>
            <p className="hud-label">% agree</p>
          </div>
        </div>
        <div className="relative mt-4 flex items-center gap-2">
          {Array.from({ length: 3 }, (_, i) => {
            const r = room.rounds[i];
            const done = !!r?.judge;
            const now = r && !done && live;
            return (
              <span key={i} className="flex flex-1 flex-col gap-1">
                <span className={cn("h-1.5 rounded-full", done ? (r!.judge!.agreement >= 80 ? "bg-ok" : "bg-hermes") : now ? "shimmer bg-white/10" : "bg-white/[0.06]")} />
                <span className="font-mono text-[10px] text-faint">
                  R{i + 1}
                  {done ? ` · ${r!.judge!.agreement}%` : now ? " · live" : ""}
                </span>
              </span>
            );
          })}
        </div>
      </section>

      {room.verdict && <MemoCard room={room} roster={roster} repos={repos} busy={busy} onRun={(a, repo, title) => void act({ action: "run", agent: a, repo, title: title ?? "" }, `run:${title ?? ""}`)} onPlan={(title) => act({ action: "plan", title }, `plan:${title}`)} />}
      {note && <p className="rounded-[12px] border border-ok/30 bg-ok/5 px-3 py-2 text-sm text-ok">{note}</p>}
      {error && <p className="rounded-[12px] border border-bad/30 bg-bad/5 px-3 py-2 text-sm text-bad">{error}</p>}

      {[...room.rounds].reverse().map((round) => (
        <section key={round.n} className="flex flex-col gap-3" aria-label={`Round ${round.n}`}>
          <h2 className="hud-label px-1 !text-[11px] !text-muted">
            Round {round.n} · {round.n === 1 ? "independent answers" : "roast and revise"}
          </h2>
          <div className={cn("-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 lg:mx-0 lg:grid lg:overflow-visible lg:px-0", table.length >= 4 ? "lg:grid-cols-4" : table.length === 3 ? "lg:grid-cols-3" : "lg:grid-cols-2")}>
            {table.map((d) => (
              <AnswerCard key={d} d={d} ans={round.answers[d]} model={room.models[d]} round={round.n} roster={roster} />
            ))}
          </div>
          <JudgeStrip judge={round.judge} error={round.judgeError} roster={roster} />
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
