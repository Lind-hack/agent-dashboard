import { ArrowRight, Check } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

// Today's first-run card, for an account that hasn't finished setup: the three things that make the
// day work, each ticked off from real state (a key saved, a calendar readable, a goal written).
export type FirstRunStep = { id: string; title: string; why: string; href: string; done: boolean };

export function FirstRun({ steps }: { steps: FirstRunStep[] }) {
  const left = steps.filter((s) => !s.done).length;
  if (left === 0) return null;
  const next = steps.find((s) => !s.done);
  return (
    <section className="panel rise mb-6 overflow-hidden" aria-labelledby="first-run-title">
      <div className="flex items-end justify-between gap-4 border-b border-line px-5 pt-5 pb-4">
        <div className="min-w-0">
          <h2 id="first-run-title" className="text-[1.2rem] leading-tight font-semibold tracking-[-0.025em]">
            {left === steps.length ? "Three steps to set up your day" : left === 1 ? "One thing left" : `${left} things left`}
          </h2>
          <p className="mt-1 text-[13.5px] text-muted">Each takes a minute or two. Nothing here is shared with anyone.</p>
        </div>
        <span className="tnum shrink-0 font-mono text-[12px] text-faint" aria-label={`${steps.length - left} of ${steps.length} done`}>
          {steps.length - left}/{steps.length}
        </span>
      </div>
      <ol>
        {steps.map((s, i) => (
          <li key={s.id} className="border-b border-line last:border-0">
            <Link
              href={s.href}
              aria-disabled={s.done}
              className={cn("group flex min-h-[64px] items-center gap-4 px-5 py-3 transition-colors hover:bg-white/[0.025] focus-visible:bg-white/[0.04]", s.done && "pointer-events-none")}
            >
              <span
                className={cn(
                  "grid h-7 w-7 shrink-0 place-items-center rounded-full border text-[12px]",
                  s.done ? "border-hud/50 bg-hud/10 text-hud" : s === next ? "border-text/70 text-text" : "border-line-hi text-faint",
                )}
                aria-hidden
              >
                {s.done ? <Check className="h-3.5 w-3.5" strokeWidth={2.5} /> : <span className="tnum font-mono">{i + 1}</span>}
              </span>
              <span className="min-w-0 flex-1">
                <span className={cn("block text-[15px] font-medium", s.done && "text-muted line-through decoration-white/20")}>{s.title}</span>
                {!s.done && <span className="block text-[13px] leading-snug text-muted">{s.why}</span>}
              </span>
              {s.done ? (
                <span className="sr-only">Done</span>
              ) : (
                <ArrowRight className={cn("h-4 w-4 shrink-0 transition-transform group-hover:translate-x-0.5", s === next ? "text-text" : "text-faint")} aria-hidden />
              )}
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
