import { keptStreak, mirror, staleGoals } from "./accountability";
import { addDays } from "./calendar";
import { goalProgress } from "./coach";
import { habitsFor } from "./habits";
import { readJournal } from "./journal";

// How locked in Lind is (v5.4, Lind: "connect the Buddy with the today calendar … to get context of am
// I locked in, disciplined and motivated, and the same for the goals"). One number from the record,
// not from how he feels: the last 7 days of blocks (done vs due, on time), habits kept, the streak,
// goals left idle — plus his journal mood as the motivation half. The Buddy reads the lines; the
// Buddy page shows the label.

export type Discipline = { score: number; label: "locked in" | "steady" | "slipping" | "off"; lines: string[] };

export function scoreDiscipline(x: { blockRatio: number | null; onTimeRate: number | null; habitRatio: number | null; streak: number; idleGoals: number; goals: number }): number {
  // Weights: doing the blocks matters most; being on time, habits and goals after; a streak is a bonus.
  const parts: [number, number][] = [];
  if (x.blockRatio !== null) parts.push([x.blockRatio, 0.45]);
  if (x.onTimeRate !== null) parts.push([x.onTimeRate, 0.15]);
  if (x.habitRatio !== null) parts.push([x.habitRatio, 0.2]);
  if (x.goals > 0) parts.push([1 - x.idleGoals / x.goals, 0.2]);
  if (!parts.length) return 0;
  const w = parts.reduce((s, [, k]) => s + k, 0);
  const base = parts.reduce((s, [v, k]) => s + v * k, 0) / w;
  return Math.round(Math.min(100, base * 100 + Math.min(10, x.streak * 2)));
}

export const labelOf = (score: number): Discipline["label"] => (score >= 80 ? "locked in" : score >= 60 ? "steady" : score >= 35 ? "slipping" : "off");

export function discipline(today: string): Discipline {
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, -i - 1)); // the last 7 finished days
  const mirrors = days.map((d) => mirror(d, Number.MAX_SAFE_INTEGER));
  const due = mirrors.reduce((s, m) => s + m.due, 0);
  const done = mirrors.reduce((s, m) => s + m.done, 0);
  const started = mirrors.reduce((s, m) => s + m.onTime + m.late, 0);
  const onTime = mirrors.reduce((s, m) => s + m.onTime, 0);
  const habits = days.flatMap((d) => habitsFor(d));
  const streak = keptStreak(today).days;
  const goals = goalProgress().filter((g) => g.goal.horizon !== "long");
  const idle = staleGoals(today);
  const moods = days.flatMap((d) => readJournal(d).entries.map((e) => e.mood).filter((m): m is NonNullable<typeof m> => !!m));
  const todayM = mirror(today);
  const score = scoreDiscipline({
    blockRatio: due ? done / due : null,
    onTimeRate: started ? onTime / started : null,
    habitRatio: habits.length ? habits.filter((h) => h.done).length / habits.length : null,
    streak,
    idleGoals: idle.length,
    goals: goals.length,
  });
  const avgMood = moods.length ? moods.reduce((s, m) => s + m, 0) / moods.length : null;
  const lines = [
    `Discipline score (last 7 days, from the record): ${score}/100 — ${labelOf(score)}.`,
    due ? `Blocks: ${done} of ${due} due were done; ${started ? Math.round((100 * onTime) / started) : 0}% started on time. Kept days: ${mirrors.filter((m) => m.kept).length}/7.` : "Blocks: none planned in the last 7 days.",
    habits.length ? `Habits: ${habits.filter((h) => h.done).length}/${habits.length} kept.` : "Habits: none set.",
    `Kept-days streak: ${streak}.`,
    `Today so far: ${todayM.done} of ${todayM.due} due blocks done, ${todayM.missed + todayM.notStarted} missed${todayM.rows.length - todayM.due > 0 ? `, ${todayM.rows.length - todayM.due} still ahead` : ""}.`,
    goals.length ? `Goals this week: ${goals.map((g) => `${g.goal.title} ${g.weekMin}/${g.targetMin} min`).join("; ")}.` : "Goals: none active.",
    ...(idle.length ? [`Goals he's not touching: ${idle.map((g) => `${g.title} (${g.idleDays === null ? "never" : `${g.idleDays} days`})`).join("; ")}.`] : []),
    avgMood !== null ? `Motivation (journal mood, 1–5, last 7 days): ${avgMood.toFixed(1)} over ${moods.length} entries.` : "Motivation: no journal moods logged this week.",
  ];
  return { score, label: labelOf(score), lines };
}
