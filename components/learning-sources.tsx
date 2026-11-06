"use client";

import { Check, LoaderCircle, Minus, Plus, RotateCw, Search } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { LearningItem, SourceHit } from "@/lib/learning";
import { cn } from "@/lib/utils";

// Sources (v6): search everything saved, by title, topic or the words inside it, and add what you're
// studying. Only these count for review and Sunday. An empty search shows what's in Study. Ticking
// sources lets him blurt or practise on just those.

const KIND: Record<string, string> = { video: "Video", link: "Link", text: "Note", voice: "Voice", audio: "Audio", image: "Image", file: "File" };

export function Sources({ items, picked, onPick, onChange, onBlurt, onPractice }: { items: LearningItem[]; picked: string[]; onPick: (ids: string[]) => void; onChange: () => Promise<void>; onBlurt: (ids: string[]) => void; onPractice: () => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SourceHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const seq = useRef(0);

  useEffect(() => {
    const term = q.trim();
    if (!term) {
      setHits(null);
      return;
    }
    const mine = ++seq.current;
    setSearching(true);
    const t = setTimeout(() => {
      void fetch(`/api/learning/search?q=${encodeURIComponent(term)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((b) => {
          if (mine === seq.current) setHits(b?.hits ?? []);
        })
        .catch(() => setError("Search didn't work. Try again."))
        .finally(() => mine === seq.current && setSearching(false));
    }, 220);
    return () => clearTimeout(t);
  }, [q]);

  const byId = new Map(items.map((i) => [i.id, i]));
  const study = items.filter((i) => i.studying);
  // Live state wins over the search result, which may be seconds old.
  const shown: SourceHit[] = hits
    ? hits.map((h) => {
        const it = byId.get(h.id);
        return it ? { ...h, studying: it.studying, state: it.learning?.state, concepts: it.conceptCount } : h;
      })
    : study.map((i) => ({ id: i.id, title: i.title || i.kind, kind: i.kind, createdAt: i.createdAt, snippet: i.learning?.thesis ?? i.summary, studying: true, state: i.learning?.state, concepts: i.conceptCount }));

  async function toggle(id: string, on: boolean) {
    setBusy(id);
    setError("");
    try {
      const res = await fetch("/api/learning/study", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, on }) });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "That didn't work.");
      await onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work.");
    } finally {
      setBusy("");
    }
  }
  async function retry(id: string) {
    setBusy(id);
    await fetch("/api/learning/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) }).catch(() => null);
    await onChange();
    setBusy("");
  }

  return (
    <section aria-label="Sources" className="mx-auto max-w-3xl">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-4 h-4 w-4 -translate-y-1/2 text-faint" aria-hidden />
        <input
          type="search"
          name="source-search"
          autoComplete="off"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search everything you've saved…"
          aria-label="Search your sources"
          className="h-12 w-full rounded-[14px] border border-line bg-black/30 pr-10 pl-10 text-[16px] placeholder:text-faint focus:border-line-hi focus:outline-none"
        />
        {searching && <LoaderCircle className="absolute top-1/2 right-4 h-4 w-4 -translate-y-1/2 animate-spin text-faint" aria-hidden />}
      </div>
      <p className="mt-2 px-1 text-[13px] text-muted" aria-live="polite">
        {hits ? `${hits.length} ${hits.length === 1 ? "result" : "results"}${hits.length === 60 ? " (showing the first 60)" : ""}` : `${study.length} in Study. Search to add more, inside videos and documents too.`}
      </p>
      {error && <p role="alert" className="mt-1 px-1 text-[13px] text-bad">{error}</p>}

      {shown.length === 0 ? (
        <p className="panel mt-3 px-5 py-8 text-[15px] text-muted">{hits ? "Nothing saved matches that." : "Nothing in Study yet. Search above and add the first source."}</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {shown.map((h) => {
            const it = byId.get(h.id);
            const reading = it?.learning?.reading;
            const ready = h.state === "ready";
            const on = picked.includes(h.id);
            return (
              <li key={h.id} className="panel flex items-start gap-3 p-3.5">
                <button
                  onClick={() => onPick(on ? picked.filter((x) => x !== h.id) : [...picked, h.id])}
                  disabled={!ready}
                  aria-pressed={on}
                  aria-label={on ? `Unpick ${h.title}` : `Pick ${h.title}`}
                  className={cn("-m-1 grid h-11 w-11 shrink-0 place-items-center disabled:opacity-25")}
                >
                  <span className={cn("grid h-6 w-6 place-items-center rounded-[7px] border transition-colors duration-150", on ? "border-hermes bg-hermes/20 text-hermes" : "border-line-hi text-transparent")}>
                    <Check className="h-3.5 w-3.5" strokeWidth={3} />
                  </span>
                </button>
                <div className="min-w-0 flex-1">
                  <Link href={`/learning/${h.id}`} className="block text-[15px] leading-snug font-medium hover:underline">
                    {h.title}
                  </Link>
                  <p className="mt-0.5 text-[13px] text-faint">
                    {KIND[h.kind] ?? h.kind}
                    {h.concepts > 0 && <span className="tnum"> · {h.concepts} concepts</span>}
                    {it && it.questionCount > 0 && <span className="tnum"> · {it.questionCount} questions</span>}
                  </p>
                  {h.snippet && <p className="mt-1 line-clamp-2 max-w-prose text-[14px] leading-snug text-muted">{h.snippet}</p>}
                  {reading && (
                    <p className="tnum mt-1.5 flex items-center gap-1.5 text-[13px] text-muted">
                      <LoaderCircle className="h-3 w-3 animate-spin text-hermes" /> Reading part {Math.min(reading.next + 1, reading.total)} of {reading.total}
                      {reading.nextAt && " · waiting to retry"}
                    </p>
                  )}
                  {!reading && h.studying && (h.state === "queued" || h.state === "analyzing") && (
                    <p className="mt-1.5 flex items-center gap-1.5 text-[13px] text-muted">
                      <LoaderCircle className="h-3 w-3 animate-spin text-hermes" /> Waiting to be read
                    </p>
                  )}
                  {h.state === "failed" && (
                    <button onClick={() => void retry(h.id)} disabled={!!busy} className="mt-1 flex min-h-9 items-center gap-1.5 text-[13px] text-bad">
                      <RotateCw className="h-3 w-3" /> {it?.learning?.error ?? "Couldn't read this one."} Try again
                    </button>
                  )}
                </div>
                <button
                  onClick={() => void toggle(h.id, !h.studying)}
                  disabled={busy === h.id}
                  aria-label={h.studying ? `Remove ${h.title} from Study` : `Add ${h.title} to Study`}
                  className={cn("press flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-[11px] text-[13px]", h.studying ? "w-11 border border-line text-muted sm:w-auto sm:px-3" : "bg-text px-3 font-semibold text-bg")}
                >
                  {busy === h.id ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : h.studying ? <Minus className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                  <span className={cn(h.studying && "hidden sm:inline")}>{h.studying ? "Remove" : "Add"}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {picked.length > 0 && (
        <div className="sticky bottom-24 z-10 mt-3 flex items-center gap-2 rounded-[14px] border border-line-hi bg-bg-raised/95 p-2 pl-4 backdrop-blur lg:bottom-4">
          <span className="tnum min-w-0 flex-1 text-[14px]">{picked.length} picked</span>
          <button onClick={onPractice} className="press h-10 rounded-[11px] border border-line-hi px-3.5 text-[13.5px]">
            Practise
          </button>
          <button onClick={() => onBlurt(picked)} className="press h-10 rounded-[11px] bg-text px-3.5 text-[13.5px] font-semibold text-bg">
            Blurt these
          </button>
        </div>
      )}
    </section>
  );
}
