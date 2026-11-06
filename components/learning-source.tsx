"use client";

import { ArrowLeft, ArrowUpRight, ChevronDown, RotateCw, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { LearningDigest, QuestionKind } from "@/lib/learning";
import type { LibraryItem } from "@/lib/library";
import { cn } from "@/lib/utils";
import { formatTimestamp } from "@/lib/video-transcript";
import { canWatch, VideoPlayer } from "./video-player";

// A source's own page (v6): everything read out of it. The parts in order, every concept with its
// example, and the question bank, answers hidden until he asks.

const KIND: Record<QuestionKind, string> = { recall: "Recall", explain: "Explain", apply: "Apply", code: "Code", interview: "Interview" };
const where = (x: { at?: number; page?: number }) => (x.page ? `p. ${x.page}` : x.at !== undefined ? formatTimestamp(x.at) : "");

export function LearningSource({ item, digest }: { item: Omit<LibraryItem, "transcript"> & { transcript?: undefined }; digest: LearningDigest | undefined }) {
  const router = useRouter();
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState<QuestionKind | "all">("all");
  const d = digest;
  const f = filter.trim().toLowerCase();
  const concepts = (d?.concepts ?? []).filter((c) => !f || `${c.term} ${c.explanation}`.toLowerCase().includes(f));
  const questions = (d?.questions ?? []).filter((q) => (kind === "all" || q.kind === kind) && (!f || `${q.q} ${q.a}`.toLowerCase().includes(f)));
  const kinds = [...new Set((d?.questions ?? []).map((q) => q.kind))];

  async function reread() {
    setBusy(true);
    await fetch("/api/learning/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: item.id }) }).catch(() => null);
    setBusy(false);
    router.refresh();
  }

  return (
    <article className="mx-auto max-w-3xl pb-28">
      <Link href="/learning?tab=sources" className="-ml-1 inline-flex min-h-11 items-center gap-1.5 text-[14px] text-muted hover:text-text">
        <ArrowLeft className="h-4 w-4" /> Sources
      </Link>
      <h1 className="mt-1 text-[2rem] leading-[1.05] font-semibold tracking-[-0.035em] text-balance">{item.title || item.kind}</h1>
      {d?.thesis && <p className="mt-3 max-w-prose text-[16px] leading-relaxed text-text/90">{d.thesis}</p>}

      <p className="tnum mt-3 text-[13px] text-faint">
        {d?.concepts.length ?? 0} concepts · {d?.questions.length ?? 0} questions
        {d?.depth === 2 ? " · read in full" : d?.reading ? ` · reading part ${Math.min(d.reading.next + 1, d.reading.total)} of ${d.reading.total}` : " · a full read is queued"}
      </p>
      {d?.error && <p className="mt-1 text-[13px] text-warn">{d.error}</p>}

      {canWatch(item) && (
        <div className="mt-4 overflow-hidden rounded-[var(--radius-panel)] border border-line">
          <VideoPlayer item={item as LibraryItem} />
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-4 text-[13.5px]">
        {item.url && (
          <a href={item.url} target="_blank" rel="noreferrer" className="flex min-h-11 items-center gap-1.5 text-muted hover:text-text">
            <ArrowUpRight className="h-3.5 w-3.5" /> Open the original
          </a>
        )}
        <Link href={`/memory?item=${item.id}`} className="flex min-h-11 items-center text-muted hover:text-text">
          Open in Memory
        </Link>
        <button onClick={() => void reread()} disabled={busy} className="flex min-h-11 items-center gap-1.5 text-muted hover:text-text disabled:opacity-50">
          <RotateCw className={cn("h-3.5 w-3.5", busy && "animate-spin")} /> {busy ? "Queuing…" : "Read it again"}
        </button>
      </div>

      {!!d?.sections?.length && (
        <section aria-labelledby="parts" className="mt-8">
          <h2 id="parts" className="text-xl font-semibold tracking-[-0.02em]">
            Part by part
          </h2>
          <ol className="mt-3 flex flex-col gap-4">
            {d.sections.map((s, i) => (
              <li key={i} className="grid grid-cols-[64px_1fr] gap-3">
                <span className="tnum pt-0.5 font-mono text-[12px] text-faint">{s.page ? `p. ${s.page}` : s.at !== undefined ? formatTimestamp(s.at) : i + 1}</span>
                <div className="min-w-0">
                  <h3 className="text-[15px] leading-snug font-semibold">{s.title}</h3>
                  <p className="mt-1 max-w-prose text-[14.5px] leading-relaxed text-muted">{s.summary}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      {!!d?.keyPoints.length && (
        <section aria-labelledby="points" className="mt-8">
          <h2 id="points" className="text-xl font-semibold tracking-[-0.02em]">
            Key points
          </h2>
          <ul className="mt-3 flex max-w-prose list-disc flex-col gap-1.5 pl-5 text-[15px] leading-relaxed text-text/90">
            {d.keyPoints.map((k) => (
              <li key={k}>{k}</li>
            ))}
          </ul>
        </section>
      )}

      {!!d?.concepts.length && (
        <div className="relative mt-8">
          <Search className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-faint" aria-hidden />
          <input type="search" name="source-filter" autoComplete="off" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Find a term or question…" aria-label="Find in this source" className="h-11 w-full rounded-[12px] border border-line bg-black/30 pr-3 pl-10 text-[16px] placeholder:text-faint focus:border-line-hi focus:outline-none" />
        </div>
      )}

      {concepts.length > 0 && (
        <section aria-labelledby="concepts" className="mt-6">
          <h2 id="concepts" className="text-xl font-semibold tracking-[-0.02em]">
            Concepts
          </h2>
          <dl className="mt-3 flex flex-col divide-y divide-line">
            {concepts.map((c) => (
              <div key={c.term} className="py-3.5">
                <dt className="flex items-baseline justify-between gap-3 text-[15.5px] leading-snug font-semibold">
                  {c.term}
                  {where(c) && <span className="tnum shrink-0 font-mono text-[12px] font-normal text-faint">{where(c)}</span>}
                </dt>
                <dd className="mt-1 max-w-prose text-[15px] leading-relaxed text-text/85">{c.explanation}</dd>
                {c.example && <dd className="mt-1.5 max-w-prose text-[14.5px] leading-relaxed text-muted">Example: {c.example}</dd>}
              </div>
            ))}
          </dl>
        </section>
      )}

      {questions.length + kinds.length > 0 && (
        <section aria-labelledby="questions" className="mt-8">
          <h2 id="questions" className="text-xl font-semibold tracking-[-0.02em]">
            Questions
          </h2>
          {kinds.length > 1 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {(["all", ...kinds] as const).map((k) => (
                <button key={k} onClick={() => setKind(k)} aria-pressed={kind === k} className={cn("h-9 rounded-full px-3.5 text-[13px] transition-colors duration-150", kind === k ? "bg-text font-medium text-bg" : "border border-line text-muted")}>
                  {k === "all" ? "All" : KIND[k]}
                </button>
              ))}
            </div>
          )}
          <ul className="mt-3 flex flex-col gap-2">
            {questions.map((q) => (
              <li key={q.q}>
                <details className="group panel">
                  <summary className="flex cursor-pointer list-none items-start gap-3 p-4">
                    <span className="min-w-0 flex-1 text-[15px] leading-snug font-medium">{q.q}</span>
                    <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-faint transition-transform duration-200 group-open:rotate-180" />
                  </summary>
                  <p className="max-w-prose border-t border-line px-4 py-3 text-[15px] leading-relaxed text-text/85">{q.a}</p>
                  <p className="tnum px-4 pb-3 text-[12.5px] text-faint">
                    {KIND[q.kind]}
                    {where(q) && ` · ${where(q)}`}
                  </p>
                </details>
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}
