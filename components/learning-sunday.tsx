"use client";

import { ArrowRight, Check, LoaderCircle, Minus, RefreshCw, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { GradedTerm, LearningRun, Mark, Round } from "@/lib/learning-sunday";
import { cn } from "@/lib/utils";
import { CountUp } from "./motion";
import { VoiceBox } from "./plan-together";

// The blurting session (v6): one round at a time. The terms stay hidden until he has recited, because
// seeing them is the thing that stops it being recall. Then the marks, which he can overrule, then a
// drill on what he missed, then the next round. What he's typed survives leaving the page.

async function post(body: object): Promise<{ session: LearningRun | null; error?: string }> {
  const res = await fetch("/api/learning/sunday", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const out = await res.json().catch(() => null);
  if (!res.ok) throw Object.assign(new Error(out?.error ?? `error ${res.status}`), { session: out?.session ?? null });
  return out;
}

const MARKS: { key: Mark; label: string; icon: typeof Check; tone: string }[] = [
  { key: "recalled", label: "Recalled", icon: Check, tone: "border-ok/50 bg-ok/15 text-ok" },
  { key: "partial", label: "Partly", icon: Minus, tone: "border-warn/50 bg-warn/15 text-warn" },
  { key: "missed", label: "Missed", icon: X, tone: "border-bad/50 bg-bad/15 text-bad" },
];

export function SundaySession({ initial, terms, topics }: { initial: LearningRun | null; terms: number; topics: number }) {
  const [session, setSession] = useState(initial);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  async function run(key: string, body: object) {
    setBusy(key);
    setError("");
    try {
      const out = await post(body);
      if (out.session) setSession(out.session);
    } catch (e) {
      const failed = e as Error & { session?: LearningRun | null };
      if (failed.session) setSession(failed.session);
      setError(failed.message);
    } finally {
      setBusy("");
    }
  }

  if (!session) {
    return (
      <section aria-labelledby="sunday-title" className="panel mx-auto max-w-2xl p-5 sm:p-6">
        <h2 id="sunday-title" className="text-[1.5rem] leading-tight font-semibold tracking-[-0.03em]">
          Sunday, 10:00
        </h2>
        <p className="mt-2 max-w-prose text-[15px] leading-relaxed text-muted">Everything added this week in full, then every older topic, so nothing you learned months ago gets left behind. You recite from memory, your blurt gets marked term by term, and what you missed gets drilled on the spot.</p>
        <p className="tnum mt-3 font-mono text-[13px] text-faint">
          {terms} terms · {topics} topics so far
        </p>
        {error && <p role="alert" className="mt-2 text-[13px] text-bad">{error}</p>}
        <button onClick={() => void run("start", { action: "start" })} disabled={!!busy || !terms} className="press mt-4 flex h-11 items-center gap-2 rounded-[12px] bg-text px-4 text-[14px] font-semibold text-bg disabled:opacity-50">
          {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />} {terms ? "Start now" : "Add a source to Study first"}
        </button>
      </section>
    );
  }

  if (session.state === "done" && session.report) return <Report session={session} />;

  const current = session.rounds.find((r) => !r.confirmed || (r.drills ?? []).some((k) => !(r.fixed ?? []).includes(k) && !(r.skipped ?? []).includes(k)));
  const done = session.rounds.filter((r) => r.confirmed).length;

  return (
    <section aria-label="Blurting session" className="mx-auto max-w-2xl">
      <div className="mb-3 flex items-baseline justify-between gap-3 px-1">
        <p className="tnum font-mono text-[12px] text-muted">
          Round {current ? session.rounds.indexOf(current) + 1 : session.rounds.length} of {session.rounds.length}
        </p>
        <p className="tnum font-mono text-[12px] text-faint">{session.rounds.reduce((n, r) => n + r.terms.length, 0)} terms</p>
      </div>
      <div className="mb-4 flex gap-0.5" role="progressbar" aria-valuemin={0} aria-valuemax={session.rounds.length} aria-valuenow={done} aria-label="Rounds done">
        {session.rounds.map((r) => (
          <span key={r.id} className={cn("h-1 flex-1 rounded-full transition-colors duration-200", r.confirmed ? "bg-hermes" : r.id === current?.id ? "bg-white/30" : "bg-white/[0.08]")} />
        ))}
      </div>
      {error && <p role="alert" className="mb-3 px-1 text-[13px] text-bad">{error}</p>}
      {current ? (
        <RoundView key={current.id} session={session} round={current} busy={busy} run={run} />
      ) : (
        <div className="panel p-5 sm:p-6">
          <h2 className="text-[1.5rem] leading-tight font-semibold tracking-[-0.03em]">That&apos;s every round.</h2>
          <button onClick={() => void run("finish", { action: "finish", id: session.id })} disabled={!!busy} className="press mt-4 flex h-11 items-center gap-2 rounded-[12px] bg-text px-4 text-[14px] font-semibold text-bg disabled:opacity-50">
            {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} See your report
          </button>
        </div>
      )}
    </section>
  );
}

type Run = (key: string, body: object) => Promise<void>;

function RoundView({ session, round, busy, run }: { session: LearningRun; round: Round; busy: string; run: Run }) {
  if (round.confirmed) return <Drill session={session} round={round} busy={busy} run={run} />;
  if (round.graded) return <Marks session={session} round={round} busy={busy} run={run} />;
  return <Blurt session={session} round={round} busy={busy} run={run} />;
}

function Blurt({ session, round, busy, run }: { session: LearningRun; round: Round; busy: string; run: Run }) {
  const stored = `blurt:${round.id}`;
  const [text, setText] = useState(round.blurt ?? "");
  useEffect(() => {
    const had = localStorage.getItem(stored);
    if (had && !round.blurt) setText(had);
  }, [stored, round.blurt]);
  useEffect(() => {
    if (text) localStorage.setItem(stored, text);
  }, [stored, text]);

  return (
    <div className="panel p-5 sm:p-6">
      <p className="text-[13px] text-muted">{round.kind === "older" ? "From earlier" : round.kind === "week" ? "New this week" : "You picked this"}</p>
      <h2 className="mt-1 text-[1.5rem] leading-tight font-semibold tracking-[-0.03em]">{round.title}</h2>
      <p className="mt-2 max-w-prose text-[15px] leading-relaxed text-muted">Everything you remember, no notes. {round.terms.length} {round.terms.length === 1 ? "term" : "terms"} are in here. {round.kind === "older" ? "A minute of talking is enough." : "Take your time."}</p>
      <div className="mt-4">
        <VoiceBox value={text} onChange={setText} label={`Everything you remember about ${round.title}`} placeholder="Say it out loud or type it. Messy is fine." rows={7} disabled={!!busy} />
      </div>
      <button
        onClick={() => void run("blurt", { action: "blurt", id: session.id, round: round.id, text }).then(() => localStorage.removeItem(stored))}
        disabled={!!busy || !text.trim()}
        className="press mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-[12px] bg-text text-[14px] font-semibold text-bg disabled:opacity-50"
      >
        {busy === "blurt" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />} {busy === "blurt" ? "Reading what you said…" : "Mark it"}
      </button>
    </div>
  );
}

const ORDER: Record<Mark, number> = { missed: 0, partial: 1, recalled: 2 };

function Marks({ session, round, busy, run }: { session: LearningRun; round: Round; busy: string; run: Run }) {
  const graded = [...(round.graded ?? [])].sort((a, z) => ORDER[a.status] - ORDER[z.status]);
  const got = graded.filter((t) => t.status === "recalled").length;
  return (
    <div className="panel p-5 sm:p-6">
      <h2 className="text-[1.25rem] leading-tight font-semibold tracking-[-0.02em]">
        {round.title}: <span className="tnum">{got} of {graded.length}</span>
      </h2>
      {round.feedback && <p className="mt-2 max-w-prose text-[15px] leading-relaxed text-text/90">{round.feedback}</p>}
      <p className="mt-3 text-[13px] text-muted">If a mark is wrong, tap the right one.</p>
      <ul className="mt-2 flex flex-col divide-y divide-line">
        {graded.map((t) => (
          <TermMark key={t.key} t={t} disabled={!!busy} onMark={(status) => void run(`mark:${t.key}`, { action: "override", id: session.id, round: round.id, key: t.key, status })} />
        ))}
      </ul>
      <button onClick={() => void run("confirm", { action: "confirm", id: session.id, round: round.id })} disabled={!!busy} className="press mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-[12px] bg-text text-[14px] font-semibold text-bg disabled:opacity-50">
        {busy === "confirm" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Confirm these marks
      </button>
    </div>
  );
}

function TermMark({ t, disabled, onMark }: { t: GradedTerm; disabled: boolean; onMark: (m: Mark) => void }) {
  return (
    <li className="py-3">
      <div className="flex items-center gap-3">
        <span className="min-w-0 flex-1 text-[15px] leading-snug font-medium">{t.term}</span>
        <div className="flex shrink-0 gap-1" role="radiogroup" aria-label={`Mark for ${t.term}`}>
          {MARKS.map((m) => {
            const Icon = m.icon;
            const on = t.status === m.key;
            return (
              <button key={m.key} role="radio" aria-checked={on} aria-label={m.label} onClick={() => !on && onMark(m.key)} disabled={disabled} className={cn("press grid h-10 w-10 place-items-center rounded-[10px] border transition-colors duration-150", on ? m.tone : "border-line text-faint")}>
                <Icon className="h-4 w-4" />
              </button>
            );
          })}
        </div>
      </div>
      {t.note && t.status !== "recalled" && <p className="mt-1 max-w-prose text-[14px] leading-snug text-muted">{t.note}</p>}
    </li>
  );
}

// What he missed, one at a time: say it, then check it.
function Drill({ session, round, busy, run }: { session: LearningRun; round: Round; busy: string; run: Run }) {
  const left = (round.drills ?? []).filter((k) => !(round.fixed ?? []).includes(k) && !(round.skipped ?? []).includes(k));
  const t = round.graded?.find((x) => x.key === left[0]);
  const [shown, setShown] = useState(false);
  if (!t) return null;
  const answer = (got: boolean) => {
    setShown(false);
    void run(`drill:${t.key}`, { action: "drill", id: session.id, round: round.id, key: t.key, got });
  };
  return (
    <div className="panel p-5 sm:p-6">
      <p className="tnum text-[13px] text-muted">
        Missed in {round.title} · {left.length} left
      </p>
      <h2 className="mt-1 text-[1.5rem] leading-tight font-semibold tracking-[-0.03em]">{t.term}</h2>
      <p className="mt-2 text-[15px] text-muted">Say what this is, out loud, then check.</p>
      {shown ? (
        <>
          <p className="mt-3 max-w-prose text-[15px] leading-relaxed">{t.explanation}</p>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button onClick={() => answer(false)} disabled={!!busy} className="press flex h-11 items-center justify-center gap-2 rounded-[12px] border border-line-hi text-[14px]">
              <RefreshCw className="h-4 w-4" /> Still shaky
            </button>
            <button onClick={() => answer(true)} disabled={!!busy} className="press flex h-11 items-center justify-center gap-2 rounded-[12px] bg-text text-[14px] font-semibold text-bg">
              <Check className="h-4 w-4" /> Got it now
            </button>
          </div>
        </>
      ) : (
        <button onClick={() => setShown(true)} className="press mt-4 flex h-11 w-full items-center justify-center rounded-[12px] bg-text text-[14px] font-semibold text-bg">
          Check it
        </button>
      )}
    </div>
  );
}

function Report({ session }: { session: LearningRun }) {
  const r = session.report!;
  const total = r.recalled + r.partial + r.missed;
  return (
    <section aria-labelledby="report-title" className="panel mx-auto max-w-2xl p-5 sm:p-6">
      <h2 id="report-title" className="text-[1.5rem] leading-tight font-semibold tracking-[-0.03em]">
        This week&apos;s blurt is done.
      </h2>
      <p className="tnum mt-3 text-[3.4rem] leading-none font-semibold tracking-[-0.05em]">
        <CountUp value={total ? Math.round((r.recalled / total) * 100) : 0} suffix="%" />
      </p>
      <p className="tnum mt-1 text-[14px] text-muted">
        {r.recalled} of {total} terms recalled · {r.partial} partly · {r.missed} missed · {r.fixed} fixed in the drills
      </p>
      {r.slipping.length > 0 && (
        <div className="mt-5">
          <h3 className="text-[15px] font-semibold">Slipping</h3>
          <p className="mt-1 text-[14px] leading-relaxed text-muted">{r.slipping.join(" · ")}</p>
        </div>
      )}
      {r.strong.length > 0 && (
        <div className="mt-4">
          <h3 className="text-[15px] font-semibold">Solid</h3>
          <p className="mt-1 text-[14px] leading-relaxed text-muted">{r.strong.join(" · ")}</p>
        </div>
      )}
      <p className="mt-5 text-[13px] text-faint">Slipping terms come back in your daily review first. Next session: Sunday, 10:00.</p>
    </section>
  );
}
