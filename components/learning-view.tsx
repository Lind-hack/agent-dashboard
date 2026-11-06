"use client";

import { ArrowUpRight, Brain, Check, ChevronLeft, ChevronRight, Clock3, Film, GraduationCap, LoaderCircle, Play, RefreshCw, RotateCw, Target, Users } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { LearningItem, LearningOverview, LearningSession, ReviewCard, ReviewGrade } from "@/lib/learning";
import type { Section } from "@/lib/library";
import { cn } from "@/lib/utils";
import { formatTimestamp } from "@/lib/video-transcript";
import { Panel, SectionTitle } from "./kit";
import { CountUp, SectionHero } from "./motion";
import { canWatch, VideoPlayer } from "./video-player";

// Learning: everything captured in Memory, the core concepts read out of each video or note, a
// spaced-repetition review ("blurt it, then check"), and three on-demand sessions — a goal plan, a
// code review and a mock interview. The runner does the reading; this page does the practising.

const MODES = [
  { key: "library", label: "Library", icon: Film },
  { key: "review", label: "Review", icon: RefreshCw },
  { key: "goal", label: "Goal", icon: Target },
  { key: "code-review", label: "Code review", icon: Brain },
  { key: "interview-me", label: "Interview me", icon: Users },
] as const;
type Mode = (typeof MODES)[number]["key"];

const KIND_LABEL: Record<string, string> = { video: "Video", link: "Link", text: "Note", voice: "Voice", audio: "Audio", image: "Image", file: "File" };
const when = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(new Date(iso));

export function LearningView({ overview: initial, sections }: { overview: LearningOverview; sections: Section[] }) {
  const [items, setItems] = useState(initial.items);
  const [cards, setCards] = useState(initial.cards);
  const [counts, setCounts] = useState(initial.counts);
  const [mode, setMode] = useState<Mode>("library");
  const [filter, setFilter] = useState<"all" | "study" | "video">("all");
  const [busy, setBusy] = useState("");
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

  const pending = counts.pending > 0 || items.some((i) => i.learning?.state === "queued" || i.learning?.state === "analyzing");
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(() => void load(), 4000);
    return () => clearInterval(t);
  }, [pending, load]);

  async function analyze(id?: string) {
    setBusy(id ?? "all");
    const b = await fetch("/api/learning/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(id ? { id } : {}) })
      .then((r) => r.json())
      .catch(() => null);
    if (b?.items) {
      setItems(b.items);
      setCards(b.cards);
      setCounts(b.counts);
    }
    setBusy("");
  }

  const study = useMemo(() => items.filter((i) => i.study), [items]);
  const unanalyzed = study.filter((i) => !i.learning || i.learning.state === "failed");
  const shown = items.filter((i) => (filter === "study" ? i.study : filter === "video" ? i.kind === "video" || (i.kind === "link" && canWatch(i)) : true));

  return (
    <>
      <SectionHero
        clip="memory"
        eyebrow="Core concepts · learning"
        title="Learning"
        sub="Every video and note you saved, read into its core ideas. Blurt them back, review what's fading, or turn the material into a goal plan, a code review or a mock interview."
        right={
          <dl className="flex gap-6 text-right">
            {[
              ["due", counts.due],
              ["concepts", counts.concepts],
              ["studied", counts.analyzed],
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

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap rounded-[12px] border border-line p-0.5 text-[12.5px]" role="tablist" aria-label="Learning mode">
          {MODES.map((m) => {
            const Icon = m.icon;
            return (
              <button key={m.key} role="tab" aria-selected={mode === m.key} onClick={() => setMode(m.key)} className={cn("flex h-8 items-center gap-1.5 rounded-[9px] px-3 transition-colors", mode === m.key ? "bg-text font-medium text-bg" : "text-muted hover:text-text")}>
                <Icon className="h-3.5 w-3.5" /> {m.label}
                {m.key === "review" && counts.due > 0 && <span className={cn("tnum font-mono text-[10.5px]", mode === m.key ? "text-bg/60" : "text-faint")}>{counts.due}</span>}
              </button>
            );
          })}
        </div>
        <span className="ml-auto flex items-center gap-2 text-xs text-faint">
          {counts.pending > 0 && (
            <>
              <LoaderCircle className="h-3.5 w-3.5 animate-spin text-hermes" /> Reading {counts.pending} {counts.pending === 1 ? "item" : "items"} into concepts…
            </>
          )}
          <Link href="/memory" className="flex items-center gap-1 text-muted hover:text-text">
            <GraduationCap className="h-3.5 w-3.5" /> Add to memory
          </Link>
        </span>
      </div>

      {mode === "library" && (
        <Library
          items={shown}
          all={items.length}
          filter={filter}
          onFilter={setFilter}
          sections={sections}
          busy={busy}
          unanalyzed={unanalyzed.length}
          onAnalyze={analyze}
          onWatch={setWatch}
        />
      )}
      {mode === "review" && <Review cards={cards} sections={sections} onCards={setCards} onCounts={setCounts} onWatch={setWatch} items={items} />}
      {(mode === "goal" || mode === "code-review" || mode === "interview-me") && <Session key={mode} mode={mode} items={items} sections={sections} onWatch={setWatch} />}

      {watch && (
        <div className="fixed inset-0 z-50 flex items-end justify-center lg:items-center" role="dialog" aria-modal="true" aria-label={watch.title || "Video"}>
          <button aria-label="Close" onClick={() => setWatch(null)} className="palette-scrim absolute inset-0 bg-black/75 backdrop-blur-sm" />
          <div className="palette-in panel relative max-h-[92dvh] w-full max-w-3xl overflow-y-auto rounded-b-none bg-bg-raised/95 lg:rounded-[var(--radius-panel)]">
            <div className="flex items-start gap-3 p-4">
              <div className="min-w-0 flex-1">
                <p className="hud-label !text-[9.5px]">{KIND_LABEL[watch.kind] ?? watch.kind} · {when(watch.createdAt)}</p>
                <h2 className="mt-1 truncate text-lg font-semibold tracking-[-0.02em]">{watch.title || "Video"}</h2>
              </div>
              <button onClick={() => setWatch(null)} className="h-9 shrink-0 rounded-[10px] px-3 text-sm text-muted hover:bg-white/5 hover:text-text">
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
              <Link href={`/memory?item=${watch.id}`} className="text-muted hover:text-text">
                Open in Memory
              </Link>
              {watch.learning?.state === "ready" && <span className="ml-auto text-xs text-faint">{watch.learning.concepts.length} concepts · {watch.learning.questions.length} questions</span>}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ---- the library ---------------------------------------------------------------------------------

function Library({
  items,
  all,
  filter,
  onFilter,
  sections,
  busy,
  unanalyzed,
  onAnalyze,
  onWatch,
}: {
  items: LearningItem[];
  all: number;
  filter: "all" | "study" | "video";
  onFilter: (f: "all" | "study" | "video") => void;
  sections: Section[];
  busy: string;
  unanalyzed: number;
  onAnalyze: (id?: string) => void;
  onWatch: (it: LearningItem) => void;
}) {
  return (
    <section aria-labelledby="learning-library">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3 px-1">
        <div>
          <h2 id="learning-library" className="text-xl font-semibold tracking-[-0.02em]">
            Captured material
          </h2>
          <p className="text-xs text-muted">Videos, links and long notes, with the concepts already read out of them.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-[10px] border border-line p-0.5 text-[12.5px]">
            {(
              [
                ["all", `All ${all}`],
                ["study", "Study"],
                ["video", "Videos"],
              ] as const
            ).map(([k, l]) => (
              <button key={k} onClick={() => onFilter(k)} aria-pressed={filter === k} className={cn("h-7 rounded-[8px] px-2.5 transition-colors", filter === k ? "bg-white/[0.09] text-text" : "text-muted hover:text-text")}>
                {l}
              </button>
            ))}
          </div>
          {unanalyzed > 0 && (
            <button onClick={() => onAnalyze()} disabled={!!busy} className="press flex h-8 items-center gap-1.5 rounded-[10px] border border-line px-3 text-xs text-muted hover:text-text disabled:opacity-40">
              {busy === "all" ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <SparkleIcon />} Analyze {unanalyzed}
            </button>
          )}
        </div>
      </div>

      {items.length === 0 ? (
        <Panel className="px-5 py-8 text-sm text-muted">
          {all === 0 ? (
            <>
              Nothing captured yet. Add a video or note on <Link href="/memory" className="text-codex hover:underline">Memory</Link> — it lands here once the runner has read it.
            </>
          ) : (
            "Nothing matches that filter."
          )}
        </Panel>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((it) => (
            <Card key={it.id} it={it} section={sections.find((s) => s.id === it.section)} busy={busy} onAnalyze={onAnalyze} onWatch={onWatch} />
          ))}
        </ul>
      )}
    </section>
  );
}

function SparkleIcon() {
  return <GraduationCap className="h-3.5 w-3.5" />;
}

function Card({ it, section, busy, onAnalyze, onWatch }: { it: LearningItem; section?: Section; busy: string; onAnalyze: (id?: string) => void; onWatch: (it: LearningItem) => void }) {
  const l = it.learning;
  const ready = l?.state === "ready";
  const working = l?.state === "queued" || l?.state === "analyzing" || busy === it.id;
  return (
    <li className="panel lift flex flex-col p-4">
      <div className="flex items-start gap-2">
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="hud-label !text-[9px] !text-faint">{KIND_LABEL[it.kind] ?? it.kind}</span>
            {section && (
              <span className="flex items-center gap-1 text-[10.5px] text-faint">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: `hsl(${section.hue} 78% 70%)` }} /> {section.name}
              </span>
            )}
          </span>
          <span className="mt-0.5 block text-[15px] leading-snug font-medium">{it.title || it.kind}</span>
        </span>
        {canWatch(it) && (
          <button onClick={() => onWatch(it)} aria-label={`Watch ${it.title || "video"}`} className="press grid h-8 w-8 shrink-0 place-items-center rounded-full border border-line text-muted hover:text-text">
            <Play className="h-3.5 w-3.5 fill-current" />
          </button>
        )}
      </div>

      {it.summary && <p className="mt-2 line-clamp-2 text-[12.5px] leading-snug text-muted">{it.summary}</p>}

      {working && (
        <p className="mt-3 flex items-center gap-2 text-[12.5px] text-muted">
          <LoaderCircle className="h-3.5 w-3.5 animate-spin text-hermes" /> {l?.state === "queued" ? "Queued for analysis…" : "Reading the core concepts…"}
        </p>
      )}

      {l?.state === "failed" && (
        <p className="mt-3 rounded-[10px] border border-bad/30 bg-bad/10 px-2.5 py-2 text-[12px] text-bad">{l.error || "Couldn't analyse this one."}</p>
      )}

      {ready && (
        <>
          {l.thesis && <p className="mt-2 text-[13px] leading-relaxed text-muted">{l.thesis}</p>}
          {l.concepts.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-1.5">
              {l.concepts.slice(0, 6).map((c, i) => (
                <li key={`${c.term}-${i}`} className="max-w-full truncate rounded-md bg-white/[0.05] px-2 py-0.5 text-[11px] text-muted" title={c.explanation}>
                  {c.term}
                  {c.at !== undefined && <span className="ml-1 font-mono text-[10px] text-faint">{formatTimestamp(c.at)}</span>}
                </li>
              ))}
              {l.concepts.length > 6 && <li className="px-1 py-0.5 text-[11px] text-faint">+{l.concepts.length - 6}</li>}
            </ul>
          )}
          {l.keyPoints.length > 0 && (
            <details className="mt-3 text-[12.5px] text-muted">
              <summary className="cursor-pointer text-faint select-none">Key points ({l.keyPoints.length})</summary>
              <ul className="mt-1.5 list-disc space-y-1 pl-4">
                {l.keyPoints.map((k, i) => (
                  <li key={i}>{k}</li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}

      {!l && it.study && !working && <p className="mt-3 text-[12.5px] text-faint">Not analysed yet — tap Analyze to read its core concepts.</p>}

      <div className="mt-auto flex flex-wrap items-center gap-2 pt-4">
        {(it.study || ready) && (
          <button onClick={() => onAnalyze(it.id)} disabled={!!busy || working} className="press flex h-8 items-center gap-1.5 rounded-[9px] border border-line px-2.5 text-[12px] text-muted hover:text-text disabled:opacity-40">
            {working || busy === it.id ? <LoaderCircle className="h-3 w-3 animate-spin" /> : <RotateCw className="h-3 w-3" />} {ready ? "Re-analyze" : "Analyze"}
          </button>
        )}
        <Link href={`/memory?item=${it.id}`} className="text-[12px] text-faint hover:text-text">
          Memory
        </Link>
        {ready && (
          <span className="ml-auto flex items-center gap-1 font-mono text-[10.5px] text-faint">
            <Clock3 className="h-3 w-3" /> {when(l.at ?? it.createdAt)}
          </span>
        )}
      </div>
    </li>
  );
}

// ---- review --------------------------------------------------------------------------------------

function Review({
  cards,
  items,
  sections,
  onCards,
  onCounts,
  onWatch,
}: {
  cards: ReviewCard[];
  items: LearningItem[];
  sections: Section[];
  onCards: (c: ReviewCard[]) => void;
  onCounts: (c: LearningOverview["counts"]) => void;
  onWatch: (it: LearningItem) => void;
}) {
  // The queue is a snapshot for this sitting; grading advances through it and a tab change rebuilds it.
  const [queue, setQueue] = useState<ReviewCard[]>(() => cards.filter((c) => Date.parse(c.due) <= Date.now()));
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [blurt, setBlurt] = useState("");
  const [grading, setGrading] = useState(false);

  const due = useMemo(() => cards.filter((c) => Date.parse(c.due) <= Date.now()), [cards]);
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
        Nothing to review yet. Analyse a video or note in the Library — its core concepts become review cards here.
      </Panel>
    );
  }

  if (!card) {
    return (
      <Panel className="px-5 py-8">
        <p className="text-lg font-medium">That&apos;s this review done.</p>
        <p className="mt-1 text-sm text-muted">Everything due has been graded. Come back when the next cards are due — or practise the whole list now.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button onClick={() => restart(due)} disabled={!due.length} className="press flex h-10 items-center gap-2 rounded-[11px] bg-text px-4 text-sm font-medium text-bg disabled:opacity-30">
            <RefreshCw className="h-4 w-4" /> Review due {due.length ? `(${due.length})` : ""}
          </button>
          <button onClick={() => restart(cards)} className="press flex h-10 items-center gap-2 rounded-[11px] border border-line px-4 text-sm text-muted hover:text-text">
            Practise all {cards.length}
          </button>
        </div>
      </Panel>
    );
  }

  const source = items.find((i) => i.id === card.itemId);
  const section = sections.find((s) => s.id === source?.section);
  const progress = Math.min(100, (index / Math.max(1, queue.length)) * 100);

  return (
    <section className="mx-auto max-w-2xl" aria-label="Review">
      <div className="mb-3 flex items-center justify-between gap-3 px-1 text-xs text-faint">
        <span className="tnum font-mono">
          {index + 1} / {queue.length}
        </span>
        <span className="flex items-center gap-1.5 truncate">
          {section && <span className="h-1.5 w-1.5 rounded-full" style={{ background: `hsl(${section.hue} 78% 70%)` }} />}
          {card.itemTitle}
          {card.at !== undefined && <span className="font-mono text-[11px]">· {formatTimestamp(card.at)}</span>}
        </span>
      </div>
      <div className="mb-4 h-1 overflow-hidden rounded-full bg-white/[0.06]">
        <div className="h-full rounded-full bg-hermes transition-[width] duration-300" style={{ width: `${progress}%` }} />
      </div>

      <Panel className="p-5 sm:p-6">
        <p className="hud-label !text-[9.5px]">Blurt it</p>
        <h2 className="mt-1 text-[1.5rem] leading-tight font-semibold tracking-[-0.03em]">{card.term}</h2>
        <p className="mt-1.5 text-[13px] text-muted">Say or type everything you remember about it, then reveal the answer.</p>
        <textarea
          value={blurt}
          onChange={(e) => setBlurt(e.target.value)}
          rows={4}
          placeholder="In your own words…"
          className="bare-field mt-4 block w-full resize-none rounded-[12px] border border-line bg-black/30 px-3.5 py-3 text-[14px] leading-relaxed placeholder:text-faint focus:border-line-hi focus:outline-none"
        />
        {!revealed ? (
          <button onClick={() => setRevealed(true)} className="press mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-[12px] bg-text text-sm font-medium text-bg">
            Reveal the answer
          </button>
        ) : (
          <div className="mt-3">
            <div className="rounded-[12px] border border-line bg-white/[0.03] px-3.5 py-3 text-[14px] leading-relaxed">
              {card.explanation}
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
                <button key={g} onClick={() => void grade(g)} disabled={grading} className={cn("press flex h-10 items-center justify-center gap-1.5 rounded-[10px] border text-sm disabled:opacity-40", tone)}>
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
          <Link href={`/memory?item=${card.itemId}`} className="ml-auto text-[12.5px] text-faint hover:text-text">
            Open source
          </Link>
        </div>
      </Panel>
    </section>
  );
}

// ---- goal / code review / interview --------------------------------------------------------------

function Session({ mode, items, sections, onWatch }: { mode: Exclude<Mode, "library" | "review">; items: LearningItem[]; sections: Section[]; onWatch: (it: LearningItem) => void }) {
  const analysed = items.filter((i) => i.learning?.state === "ready");
  const [selected, setSelected] = useState<string[]>(() => analysed.map((i) => i.id));
  const [goal, setGoal] = useState("");
  const [session, setSession] = useState<LearningSession | null>(null);
  const [step, setStep] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");

  const active = session?.steps[step];

  async function generate() {
    setGenerating(true);
    setError("");
    setSession(null);
    try {
      const res = await fetch("/api/learning/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode, itemIds: selected, goal }) });
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

  const label = mode === "goal" ? "Goal" : mode === "code-review" ? "Code review" : "Interview me";
  const blurb =
    mode === "goal"
      ? "Name what you want to understand. The coach turns the material you pick into an active study plan."
      : mode === "code-review"
        ? "Practise defending and critiquing the implementation ideas in your material."
        : "A mock interview drawn from your own material, one question at a time.";

  return (
    <section className="mx-auto max-w-3xl" aria-label={label}>
      <Panel className="p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold tracking-[-0.02em]">{label}</h2>
            <p className="mt-1 text-[13px] text-muted">{blurb}</p>
          </div>
          <span className="rounded-full border border-line px-2.5 py-1 font-mono text-[10.5px] text-faint">{selected.length} of {analysed.length} items</span>
        </div>

        {mode === "goal" && (
          <input
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="e.g. Understand how transformer attention works well enough to explain it"
            aria-label="Learning goal"
            className="bare-field mt-4 h-11 w-full rounded-[11px] border border-line bg-black/30 px-3.5 text-[14px] placeholder:text-faint focus:border-line-hi focus:outline-none"
          />
        )}

        <details className="mt-4 rounded-[11px] border border-line bg-black/20 px-3.5 py-2.5">
          <summary className="cursor-pointer text-[13px] text-muted select-none">Material ({analysed.length} analysed)</summary>
          {analysed.length === 0 ? (
            <p className="mt-2 text-[12.5px] text-faint">Nothing analysed yet — open the Library tab and analyze a video or note first.</p>
          ) : (
            <ul className="mt-2 flex max-h-64 flex-col gap-1 overflow-y-auto">
              {analysed.map((it) => {
                const s = sections.find((x) => x.id === it.section);
                const on = selected.includes(it.id);
                return (
                  <li key={it.id}>
                    <label className="flex cursor-pointer items-center gap-2.5 rounded-[8px] px-1.5 py-1.5 text-[12.5px] hover:bg-white/[0.04]">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => setSelected((x) => (on ? x.filter((id) => id !== it.id) : [...x, it.id]))}
                        className="h-3.5 w-3.5 accent-[var(--color-hermes)]"
                      />
                      {s && <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: `hsl(${s.hue} 78% 70%)` }} />}
                      <span className="min-w-0 flex-1 truncate">{it.title || it.kind}</span>
                      <span className="shrink-0 font-mono text-[10.5px] text-faint">{it.learning?.concepts.length ?? 0}c</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </details>

        <button onClick={() => void generate()} disabled={generating || !selected.length} className="press mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-[12px] bg-text text-sm font-medium text-bg disabled:opacity-30">
          {generating ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ArrowRightIcon />} {session ? "Build a new session" : "Build the session"}
        </button>
        {error && <p className="mt-2 text-[12.5px] text-bad">{error}</p>}
      </Panel>

      {session && active && (
        <div className="mt-4">
          <div className="mb-3 flex items-end justify-between gap-3 px-1">
            <div>
              <p className="hud-label !text-[9.5px]">{session.generated ? "Built from your material" : "From your saved questions"}</p>
              <h3 className="text-lg font-semibold tracking-[-0.02em]">{session.title}</h3>
            </div>
            <span className="tnum shrink-0 font-mono text-[11px] text-faint">
              {step + 1} / {session.steps.length}
            </span>
          </div>
          <Panel className="p-5">
            <p className="text-[13px] text-muted">{session.intro}</p>
            <p className="mt-4 whitespace-pre-wrap text-[16px] leading-relaxed font-medium">{active.prompt}</p>
            {active.at !== undefined && <p className="mt-1 font-mono text-[11px] text-faint">In the video at {formatTimestamp(active.at)}</p>}
            {!revealed ? (
              <button onClick={() => setRevealed(true)} className="press mt-4 flex h-10 w-full items-center justify-center gap-2 rounded-[11px] border border-line text-sm text-muted hover:text-text sm:w-auto sm:px-5">
                <Check className="h-4 w-4" /> Show what a good answer covers
              </button>
            ) : (
              <div className="rise mt-4 rounded-[12px] border border-line bg-white/[0.03] px-3.5 py-3 text-[14px] leading-relaxed whitespace-pre-wrap">{active.answer}</div>
            )}
            <div className="mt-5 flex items-center gap-2">
              <button onClick={() => (setStep((s) => Math.max(0, s - 1)), setRevealed(false))} disabled={step === 0} className="press flex h-9 items-center gap-1.5 rounded-[10px] border border-line px-3 text-[13px] text-muted hover:text-text disabled:opacity-30">
                <ChevronLeft className="h-4 w-4" /> Back
              </button>
              <button onClick={() => (setStep((s) => Math.min(session.steps.length - 1, s + 1)), setRevealed(false))} disabled={step >= session.steps.length - 1} className="press flex h-9 items-center gap-1.5 rounded-[10px] border border-line px-3 text-[13px] text-muted hover:text-text disabled:opacity-30">
                Next <ChevronRight className="h-4 w-4" />
              </button>
              {active.at !== undefined && session.sources.length > 0 && (
                <span className="ml-auto font-mono text-[10.5px] text-faint">from {session.sources[0]}</span>
              )}
            </div>
          </Panel>
        </div>
      )}
    </section>
  );
}

function ArrowRightIcon() {
  return <ChevronRight className="h-4 w-4" />;
}
