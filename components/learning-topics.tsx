"use client";

import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import type { Memory, TopicView } from "@/lib/learning-topics";
import { cn } from "@/lib/utils";

// The topic map (v6): one cell for each term, coloured by how well it's held, so what's fading is
// visible at a glance. Weakest topics first.

const CELL: Record<Memory, string> = { strong: "bg-ok", fading: "bg-warn", weak: "bg-bad", new: "bg-white/[0.14]" };
const WORD: Record<Memory, string> = { strong: "Solid", fading: "Fading", weak: "Weak", new: "Not tested yet" };
const ALL: Memory[] = ["weak", "fading", "strong", "new"];

export function TopicMap({ topics }: { topics: TopicView[] }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!topics.length) return <p className="panel mx-auto max-w-3xl px-5 py-8 text-[15px] text-muted">Your topics appear here once a source in Study has been read.</p>;
  const terms = topics.flatMap((t) => t.terms);
  const sorted = [...topics].sort((a, z) => a.score - z.score);
  return (
    <section aria-label="Topics" className="mx-auto max-w-3xl">
      <dl className="mb-4 grid grid-cols-4 gap-2 px-1">
        {ALL.map((m) => (
          <div key={m}>
            <dd className="tnum text-[1.5rem] leading-none font-semibold tracking-[-0.03em]">{terms.filter((t) => t.memory === m).length}</dd>
            <dt className="mt-1 flex items-center gap-1.5 text-[12.5px] text-muted">
              <span className={cn("h-2 w-2 rounded-[3px]", CELL[m])} aria-hidden /> {WORD[m]}
            </dt>
          </div>
        ))}
      </dl>
      <ul className="flex flex-col gap-2">
        {sorted.map((t) => {
          const isOpen = open === t.id;
          const weak = t.terms.filter((x) => x.memory === "weak").length;
          return (
            <li key={t.id} className="panel overflow-hidden">
              <button onClick={() => setOpen(isOpen ? null : t.id)} aria-expanded={isOpen} className="flex w-full items-center gap-3 p-4 text-left">
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] leading-snug font-medium">{t.name}</span>
                  <span className="mt-2 flex flex-wrap gap-[3px]" aria-hidden>
                    {t.terms.map((x) => (
                      <span key={x.key} className={cn("h-2.5 w-2.5 rounded-[3px]", CELL[x.memory])} />
                    ))}
                  </span>
                  <span className="sr-only">
                    {t.terms.length} terms, {weak} weak
                  </span>
                </span>
                <span className="tnum shrink-0 font-mono text-[12px] text-faint">{t.terms.length}</span>
                <ChevronDown className={cn("h-4 w-4 shrink-0 text-faint transition-transform duration-200", isOpen && "rotate-180")} />
              </button>
              {isOpen && (
                <ul className="border-t border-line px-4 py-2">
                  {t.terms.map((x) => (
                    <li key={x.key} className="flex min-h-11 items-center gap-2.5">
                      <span className={cn("h-2.5 w-2.5 shrink-0 rounded-[3px]", CELL[x.memory])} aria-hidden />
                      <Link href={`/learning/${x.itemId}`} className="min-w-0 flex-1 text-[14.5px] hover:underline">
                        {x.term}
                      </Link>
                      <span className="shrink-0 text-[12.5px] text-faint">{WORD[x.memory]}</span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
