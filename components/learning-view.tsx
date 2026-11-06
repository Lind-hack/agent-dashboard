"use client";

import { ArrowUpRight, Brain, CalendarDays, Check, ChevronLeft, ChevronRight, Film, GraduationCap, LoaderCircle, Map as MapIcon, Play, RefreshCw, Search, Target, Users } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { LearningItem, LearningOverview, LearningSession, ReviewCard, ReviewGrade } from "@/lib/learning";
import type { LearningRun } from "@/lib/learning-sunday";
import type { TopicView } from "@/lib/learning-topics";
import { cn } from "@/lib/utils";
import { formatTimestamp } from "@/lib/video-transcript";
import { Sources } from "./learning-sources";
import { SundaySession } from "./learning-sunday";
import { TopicMap } from "./learning-topics";
import { Panel } from "./kit";
import { CountUp, SectionHero } from "./motion";
import { VoiceBox } from "./plan-together";
import { canWatch, VideoPlayer } from "./video-player";

// Learning (v6): the sources he's chosen, read in full; a Sunday blurt across everything he has ever
// studied; a daily review of terms and questions; a map of what's holding and what's fading; and
// practice sessions on what he picks. The runner does the reading; this page does the practising.

const TABS = [
  { key: "sunday", label: "Sunday", icon: CalendarDays },
  { key: "review", label: "Review", icon: RefreshCw },
  { key: "sources", label: "Sources", icon: Search },
  { key: "topics", label: "Topics", icon: MapIcon },
  { key: "practice", label: "Practice", icon: Target },
] as const;
export type LearningTab = (typeof TABS)[number]["key"];

const KIND_LABEL: Record<string, string> = { video: "Video", link: "Link", text: "Note", voice: "Voice", audio: "Audio", image: "Image", file: "File" };
const when = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(new Date(iso));

export function LearningView({ overview: initial, topics, session, terms, tab }: { overview: LearningOverview; topics: TopicView[]; session: LearningRun | null; terms: number; tab?: LearningTab }) {
  const [items, setItems] = useState(initial.items);
  const [cards, setCards] = useState(initial.cards);
  const [counts, setCounts] = useState(initial.counts);
  const [mode, setMode] = useState<LearningTab>(tab ?? (session?.state === "open" ? "sunday" : initial.counts.study ? "review" : "sources"));
  const [run, setRun] = useState(session);
  const [picked, setPicked] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [watch, setWatch] = useState<LearningItem | null>(null);

  const load = useCallback(async () => {
    const b = await fetch("/api/learning", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    if (!b?.items) return;
    setItems(b.items);
    setCards(b.cards);
    setCounts(b.counts);
  }, []);

  const pending = counts.pending > 0 || items.some((i) => i.learning?.reading);
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(() => void load(), 5000);
    return () => clearInterval(t);
  }, [pending, load]);

  async function blurtPicked(ids: string[]) {
    setError("");
    const res = await fetch("/api/learning/sunday", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "custom", itemIds: ids }) });
    const b = await res.json().catch(() => null);
    if (!res.ok || !b?.session) return setError(b?.error ?? "Couldn't start that.");
    setRun(b.session);
    setPicked([]);
    setMode("sunday");
  }

  return (
    <>
      <SectionHero
        clip="memory"
        eyebrow="Study · recall · revise"
        title="Learning"
        sub="Choose what you're studying. It's read in full, you recall it from memory, and every Sunday you go back over everything, from the first thing you learned."
        right={
          <dl className="flex gap-6 text-right">
            {[
              ["due today", counts.due],
              ["concepts", counts.concepts],
              ["in study", counts.study],
            ].map(([k, v]) => (
              <div key={k as string}>
                <dd className="text-2xl font-semibold tracking-[-0.03em]">
                  <CountUp value={v as number} />
                </dd>
                <dt className="hud-label !text-[9.5px]">{k}</dt>
              </div>
            ))}
          </dl>
        }
      />

      <div className="mb-5" role="tablist" aria-label="Learning">
        <div className="grid grid-cols-5 gap-0.5 rounded-[14px] border border-line p-1 sm:flex sm:w-max sm:gap-1">
          {TABS.map((m) => {
            const Icon = m.icon;
            return (
              <button key={m.key} role="tab" aria-selected={mode === m.key} onClick={() => setMode(m.key)} className={cn("press relative flex h-11 items-center justify-center gap-1.5 rounded-[10px] px-1 text-[13px] transition-colors duration-150 sm:px-3 sm:text-[13.5px]", mode === m.key ? "bg-text font-medium text-bg" : "text-muted hover:text-text")}>
                <Icon className="hidden h-4 w-4 sm:block" /> {m.label}
                {m.key === "review" && counts.due > 0 && <span className={cn("tnum absolute top-0.5 right-1 font-mono text-[10px] sm:static sm:text-[11px]", mode === m.key ? "text-bg/60" : "text-faint")}>{counts.due}</span>}
                {m.key === "sunday" && run?.state === "open" && <span className={cn("h-1.5 w-1.5 rounded-full", mode === m.key ? "bg-bg/60" : "bg-hermes")} aria-label="open" />}
              </button>
            );
          })}
        </div>
      </div>
      {error && <p className="mb-3 px-1 text-[13px] text-bad">{error}</p>}

      {mode === "sunday" && <SundaySession key={run?.id ?? "none"} initial={run} terms={terms} topics={topics.length} />}
      {mode === "review" && <Review cards={cards} onCards={setCards} onCounts={setCounts} onWatch={setWatch} items={items} />}
      {mode === "sources" && <Sources items={items} picked={picked} onPick={setPicked} onChange={load} onBlurt={(ids) => void blurtPicked(ids)} onPractice={() => setMode("practice")} />}
      {mode === "topics" && <TopicMap topics={topics} />}
      {mode === "practice" && <Practice items={items} picked={picked} onSources={() => setMode("sources")} />}

      {watch && (
        <div className="fixed inset-0 z-50 flex items-end justify-center lg:items-center" role="dialog" aria-modal="true" aria-label={watch.title || "Video"}>
          <button aria-label="Close" onClick={() => setWatch(null)} className="palette-scrim absolute inset-0 bg-black/75 backdrop-blur-sm" />
          <div className="palette-in panel relative max-h-[92dvh] w-full max-w-3xl overflow-y-auto rounded-b-none bg-bg-raised/95 lg:rounded-[var(--radius-panel)]">
            <div className="flex items-start gap-3 p-4">
              <div className="min-w-0 flex-1">
                <p className="text-[13px] text-faint">
                  {KIND_LABEL[watch.kind] ?? watch.kind} · {when(watch.createdAt)}
                </p>
                <h2 className="mt-1 truncate text-lg font-semibold tracking-[-0.02em]">{watch.title || "Video"}</h2>
              </div>
              <button onClick={() => setWatch(null)} className="h-10 shrink-0 rounded-[10px] px-3 text-sm text-muted hover:bg-white/5 hover:text-text">
                Close
              </button>
            </div>
            <VideoPlayer item={watch} />
            <div className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
              {watch.url && (
                <a href={watch.url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-codex hover:underline">
                  <ArrowUpRight className="h-3.5 w-3.5" /> Open original
                </a>
              )}
              <Link href={`/learning/${watch.id}`} className="text-muted hover:text-text">
                Open the notes
              </Link>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ---- review --------------------------------------------------------------------------------------

function Review({
  cards,
  items,
  onCards,
  onCounts,
  onWatch,
}: {
  cards: ReviewCard[];
  items: LearningItem[];
  onCards: (c: ReviewCard[]) => void;
  onCounts: (c: LearningOverview["counts"]) => void;
  onWatch: (it: LearningItem) => void;
}) {
  // The queue is a snapshot for this sitting; grading advances through it and a tab change rebuilds it.
  const [queue, setQueue] = useState<ReviewCard[]>(() => cards);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [blurt, setBlurt] = useState("");
  const [grading, setGrading] = useState(false);

  const due = useMemo(() => cards, [cards]);
  const card = queue[index];

  async function grade(g: ReviewGrade) {
    if (!card || grading) return;
    setGrading(true);
    const b = await fetch("/api/learning/review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: card.key, grade: g }) })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    if (b?.cards) onCards(b.cards);
    if (b?.counts) onCounts(b.counts);
    setGrading(false);
    setIndex((i) => i + 1);
    setRevealed(false);
    setBlurt("");
  }

  function restart(list: ReviewCard[]) {
    setQueue(list);
    setIndex(0);
    setRevealed(false);
    setBlurt("");
  }

  if (!cards.length) {
    return (
      <Panel className="px-5 py-8 text-sm text-muted">
        Nothing due. Sources you add to Study turn into review cards here, a few each day.
      </Panel>
    );
  }

  if (!card) {
    return (
      <Panel className="px-5 py-8">
        <p className="text-lg font-medium">That&apos;s this review done.</p>
        <p className="mt-1 text-sm text-muted">Everything due today has been graded. New cards join tomorrow.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button onClick={() => restart(due)} disabled={!due.length} className="press flex h-10 items-center gap-2 rounded-[11px] bg-text px-4 text-sm font-medium text-bg disabled:opacity-30">
            <RefreshCw className="h-4 w-4" /> Review due {due.length ? `(${due.length})` : ""}
          </button>
        </div>
      </Panel>
    );
  }

  const source = items.find((i) => i.id === card.itemId);
  const progress = Math.min(100, (index / Math.max(1, queue.length)) * 100);

  return (
    <section className="mx-auto max-w-2xl" aria-label="Review">
      <div className="mb-3 flex items-center justify-between gap-3 px-1 text-xs text-faint">
        <span className="tnum font-mono">
          {index + 1} / {queue.length}
        </span>
        <span className="flex items-center gap-1.5 truncate">
          {card.itemTitle}
          {card.page ? <span className="font-mono text-[11px]">· p. {card.page}</span> : card.at !== undefined && <span className="font-mono text-[11px]">· {formatTimestamp(card.at)}</span>}
        </span>
      </div>
      <div className="mb-4 h-1 overflow-hidden rounded-full bg-white/[0.06]">
        <div className="h-full rounded-full bg-hermes transition-[width] duration-300" style={{ width: `${progress}%` }} />
      </div>

      <Panel className="p-5 sm:p-6">
        <h2 className={cn("font-semibold tracking-[-0.03em]", card.type === "question" ? "text-[1.2rem] leading-snug" : "text-[1.5rem] leading-tight")}>{card.term}</h2>
        <p className="mt-1.5 text-[14px] text-muted">{card.type === "question" ? "Answer it from memory, then check." : "Say or type everything you remember, then check."}</p>
        <div className="mt-4">
          <VoiceBox key={card.key} value={blurt} onChange={setBlurt} label="Your answer" placeholder="In your own words…" rows={4} />
        </div>
        {!revealed ? (
          <button onClick={() => setRevealed(true)} className="press mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-[12px] bg-text text-sm font-medium text-bg">
            Reveal the answer
          </button>
        ) : (
          <div className="mt-3">
            <div className="rounded-[12px] border border-line bg-white/[0.03] px-3.5 py-3 text-[14px] leading-relaxed">
              {card.explanation}
              {card.example && <p className="mt-2 text-[14px] text-muted">Example: {card.example}</p>}
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {(
                [
                  ["again", "Again", "border-bad/40 text-bad hover:bg-bad/10"],
                  ["hard", "Hard", "border-warn/40 text-warn hover:bg-warn/10"],
                  ["good", "Good", "border-ok/40 text-ok hover:bg-ok/10"],
                  ["easy", "Easy", "border-hud/40 text-hud hover:bg-hud/10"],
                ] as const
              ).map(([g, label, tone]) => (
                <button key={g} onClick={() => void grade(g)} disabled={grading} className={cn("press flex h-11 items-center justify-center gap-1.5 rounded-[10px] border text-sm disabled:opacity-40", tone)}>
                  {grading ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} {label}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="mt-4 flex items-center gap-3">
          {source && canWatch(source) && (
            <button onClick={() => onWatch(source)} className="flex items-center gap-1.5 text-[12.5px] text-muted hover:text-text">
              <Play className="h-3.5 w-3.5" /> See it in the video
            </button>
          )}
          <Link href={`/learning/${card.itemId}`} className="ml-auto flex min-h-11 items-center text-[13px] text-faint hover:text-text">
            Open the notes
          </Link>
        </div>
      </Panel>
    </section>
  );
}

// ---- practice: goal / code review / interview on the sources he picks ------------------------------

const PRACTICE = [
  { key: "goal", label: "Study plan", icon: Target, blurb: "Name what you want to understand. The coach turns the material into an active study plan." },
  { key: "code-review", label: "Code review", icon: Brain, blurb: "Practise defending and critiquing the implementation ideas in the material." },
  { key: "interview-me", label: "Mock interview", icon: Users, blurb: "An interview drawn from your own material, one question at a time." },
] as const;

function Practice({ items, picked, onSources }: { items: LearningItem[]; picked: string[]; onSources: () => void }) {
  const study = items.filter((i) => i.studying && i.learning?.state === "ready");
  const ids = picked.length ? picked : study.map((i) => i.id);
  const [mode, setMode] = useState<(typeof PRACTICE)[number]["key"]>("goal");
  const [goal, setGoal] = useState("");
  const [session, setSession] = useState<LearningSession | null>(null);
  const [step, setStep] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const active = session?.steps[step];
  const about = PRACTICE.find((p) => p.key === mode)!;

  async function generate() {
    setGenerating(true);
    setError("");
    setSession(null);
    try {
      const res = await fetch("/api/learning/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode, itemIds: ids, goal }) });
      const b = await res.json().catch(() => null);
      if (!res.ok || !b?.session) throw new Error(b?.error ?? `error ${res.status}`);
      setSession(b.session);
      setStep(0);
      setRevealed(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't build that session.");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <section className="mx-auto max-w-3xl" aria-label="Practice">
      <Panel className="p-4 sm:p-5">
        <div className="flex flex-wrap gap-1.5">
          {PRACTICE.map((p) => {
            const Icon = p.icon;
            return (
              <button key={p.key} onClick={() => setMode(p.key)} aria-pressed={mode === p.key} className={cn("flex h-10 items-center gap-1.5 rounded-full px-3.5 text-[13.5px] transition-colors duration-150", mode === p.key ? "bg-text font-medium text-bg" : "border border-line text-muted")}>
                <Icon className="h-4 w-4" /> {p.label}
              </button>
            );
          })}
        </div>
        <p className="mt-3 max-w-prose text-[14.5px] text-muted">{about.blurb}</p>
        {mode === "goal" && <input value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="e.g. Explain transformer attention from scratch" aria-label="Learning goal" className="bare-field mt-3 h-11 w-full rounded-[11px] border border-line bg-black/30 px-3.5 text-[16px] placeholder:text-faint focus:border-line-hi focus:outline-none" />}
        <p className="tnum mt-3 text-[13.5px] text-muted">
          {picked.length ? `${picked.length} picked sources` : `All ${study.length} sources in Study`} ·{" "}
          <button onClick={onSources} className="min-h-9 underline underline-offset-2 hover:text-text">
            change
          </button>
        </p>
        <button onClick={() => void generate()} disabled={generating || !ids.length} className="press mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-[12px] bg-text text-[14px] font-semibold text-bg disabled:opacity-40">
          {generating ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ChevronRight className="h-4 w-4" />} {session ? "Build a new session" : "Build the session"}
        </button>
        {error && <p className="mt-2 text-[13px] text-bad">{error}</p>}
      </Panel>

      {session && active && (
        <div className="mt-4">
          <div className="mb-3 flex items-end justify-between gap-3 px-1">
            <h3 className="text-lg font-semibold tracking-[-0.02em]">{session.title}</h3>
            <span className="tnum shrink-0 font-mono text-[12px] text-faint">
              {step + 1} / {session.steps.length}
            </span>
          </div>
          <Panel className="p-5">
            <p className="text-[14px] text-muted">{session.intro}</p>
            <p className="mt-4 whitespace-pre-wrap text-[16px] leading-relaxed font-medium">{active.prompt}</p>
            {active.at !== undefined && <p className="mt-1 font-mono text-[12px] text-faint">In the video at {formatTimestamp(active.at)}</p>}
            {!revealed ? (
              <button onClick={() => setRevealed(true)} className="press mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-[12px] border border-line text-[14px] text-muted hover:text-text sm:w-auto sm:px-5">
                <Check className="h-4 w-4" /> Show what a good answer covers
              </button>
            ) : (
              <div className="mt-4 rounded-[12px] border border-line bg-white/[0.03] px-3.5 py-3 text-[15px] leading-relaxed whitespace-pre-wrap">{active.answer}</div>
            )}
            <div className="mt-5 flex items-center gap-2">
              <button onClick={() => (setStep((s) => Math.max(0, s - 1)), setRevealed(false))} disabled={step === 0} className="press flex h-10 items-center gap-1.5 rounded-[10px] border border-line px-3 text-[13.5px] text-muted hover:text-text disabled:opacity-30">
                <ChevronLeft className="h-4 w-4" /> Back
              </button>
              <button onClick={() => (setStep((s) => Math.min(session.steps.length - 1, s + 1)), setRevealed(false))} disabled={step >= session.steps.length - 1} className="press flex h-10 items-center gap-1.5 rounded-[10px] border border-line px-3 text-[13.5px] text-muted hover:text-text disabled:opacity-30">
                Next <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </Panel>
        </div>
      )}
    </section>
  );
}
