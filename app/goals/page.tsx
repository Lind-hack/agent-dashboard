import { GoalsView } from "@/components/goals-view";
import { PageHeader } from "@/components/kit";
import { activeGoals, readGoals } from "@/lib/goals";
import { goalMomentum } from "@/lib/plan-store";

export const dynamic = "force-dynamic";

// Goals: the vault file the daily planner reads. Short horizons feed today's focus blocks; long
// horizons stay visible so the short ones don't drift.
export default async function GoalsPage() {
  const goals = readGoals();
  const active = activeGoals().length;
  const done = goals.filter((g) => g.done).length;
  const long = goals.filter((g) => !g.done && g.horizon === "long").length;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Belgrade" }).format(new Date());
  const weeks = goalMomentum(today, goals.map((g) => g.id));
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Goals"
        sub="What you're actually chasing, and the next action for each. The planner gives the active ones a focus block before anything else."
        readout={[goals.length ? `${active}/3 active` : "no goals yet", long > 0 && `${long} long-term`, done > 0 && `${done} done`]}
      />
      <GoalsView goals={goals} weeks={weeks} today={today} />
    </div>
  );
}
