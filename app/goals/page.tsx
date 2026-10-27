import { PageHeader } from "@/components/kit";
import { GoalsEditor } from "@/components/goals-editor";
import { activeGoals, readGoals } from "@/lib/goals";

export const dynamic = "force-dynamic";

// Goals: the vault file the daily planner reads. Short horizons feed today's focus blocks; long
// horizons stay visible so the short ones don't drift.
export default async function GoalsPage() {
  const goals = readGoals();
  const active = activeGoals().length;
  const done = goals.filter((g) => g.done).length;
  const long = goals.filter((g) => !g.done && g.horizon === "long").length;
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Goals"
        sub="What you're actually chasing, and the next action for each. The planner gives the active ones a focus block before anything else."
        readout={[goals.length ? `${active}/3 active` : "no goals yet", long > 0 && `${long} long-term`, done > 0 && `${done} done`]}
      />
      <GoalsEditor initial={goals} />
    </div>
  );
}
