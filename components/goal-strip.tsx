import { ArrowRight, Target } from "lucide-react";
import Link from "next/link";
import type { Goal } from "@/lib/goals";
import type { GoalWeek } from "@/lib/plan-store";
import { GoalMomentum } from "./goal-momentum";

const horizonLabel: Record<Goal["horizon"], string> = {
  now: "Now",
  short: "Short term",
  long: "Long term",
};

export function GoalStrip({ goals, weeks, today }: { goals: Goal[]; weeks: Record<string, GoalWeek>; today: string }) {
  return (
    <div>
      {goals.map((g) => {
        const week = weeks[g.id] ?? { done: 0, total: 0, days: [] };
        return (
          <Link
            key={g.id}
            href="/goals"
            className="group flex min-h-[84px] items-start gap-3 border-b border-line px-4 py-3 transition-colors last:border-0 hover:bg-white/[0.025]"
          >
            <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-[10px] border border-hud/20 bg-hud/[0.05]">
              <Target className="h-4 w-4 text-hud" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="min-w-0 flex-1 text-[15px] leading-snug">{g.title}</span>
                <span className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-faint">{horizonLabel[g.horizon]}</span>
              </span>
              <span className="mt-0.5 block truncate text-[12px] text-muted">
                {g.next ? `Next: ${g.next}` : "Next action not set"}
              </span>
              <span className="mt-2 flex items-center justify-between gap-3">
                <GoalMomentum week={week} today={today} />
                <span className="font-mono text-[10px] text-faint">
                  {week.total ? `${week.done}/${week.total} this week` : "no blocks yet"}
                </span>
              </span>
            </span>
            <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-faint opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
          </Link>
        );
      })}
    </div>
  );
}

export function GoalEmpty() {
  return (
    <div className="flex flex-col items-start gap-4 px-5 py-6">
      <span className="grid h-10 w-10 place-items-center rounded-[12px] border border-hud/20 bg-hud/[0.05]">
        <Target className="h-5 w-5 text-hud" aria-hidden />
      </span>
      <div>
        <p className="text-[16px] font-medium">Nothing to aim at yet.</p>
        <p className="mt-1 max-w-[46ch] text-sm leading-relaxed text-muted">
          Write down what you&apos;re actually chasing and the next action that moves it. The planner gives each active goal a focus block before anything else.
        </p>
      </div>
      <Link
        href="/goals"
        className="flex h-10 items-center gap-2 rounded-[12px] bg-text px-4 text-sm font-medium text-bg transition-colors hover:bg-white"
      >
        Set your goals <ArrowRight className="h-4 w-4" aria-hidden />
      </Link>
    </div>
  );
}
