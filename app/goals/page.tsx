import { GoalsBoard } from "@/components/goals-board";
import { GoalsEditor } from "@/components/goals-editor";
import { SectionHero } from "@/components/motion";
import { addDays, dayString } from "@/lib/calendar";
import { buildRecap, coachTz, goalProgress, readRecap } from "@/lib/coach";
import { readGoals } from "@/lib/goals";

export const dynamic = "force-dynamic";

// Goals: what Lind is chasing, how much real focus each got this week, and one tap to put time on it.
// The vault file (100 - Me/Goals.md) stays the source; the editor below writes it.
export default async function GoalsPage({ searchParams }: { searchParams: Promise<{ recap?: string }> }) {
  const goals = readGoals();
  const progress = goalProgress();
  const today = dayString(coachTz());
  const asked = (await searchParams)?.recap;
  const day = asked && /^\d{4}-\d{2}-\d{2}$/.test(asked) ? asked : null;
  // The evening recap once it exists; otherwise yesterday's, so the morning starts with last night's score.
  const recap = day ? (readRecap(day) ?? buildRecap(day)) : (readRecap(today) ?? readRecap(addDays(today, -1)));
  const active = progress.filter((p) => p.goal.horizon !== "long").length;
  return (
    <div className="mx-auto max-w-5xl">
      <SectionHero
        clip="today"
        eyebrow={[goals.length ? `${active} active` : "no goals yet", `${goals.filter((g) => g.done).length} done`].join(" · ")}
        title="Goals"
        sub="What you're chasing and how much real focus each one got this week. One tap turns a goal into time on today's plan — the Coach keeps you on it."
      />
      <GoalsBoard progress={progress} recap={recap} today={today} />
      <section className="mt-10" aria-labelledby="edit-goals">
        <h2 id="edit-goals" className="mb-3 px-1 text-xl font-semibold tracking-[-0.02em]">
          Edit goals
        </h2>
        <GoalsEditor initial={goals} />
      </section>
    </div>
  );
}
