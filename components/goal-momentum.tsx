import type { GoalWeek } from "@/lib/plan-store";
import { cn } from "@/lib/utils";

const dayLabel = (day: string) =>
  new Intl.DateTimeFormat("en-GB", { weekday: "narrow", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`));

const dayName = (day: string) =>
  new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`));

export function GoalMomentum({
  week,
  today,
  labels = false,
  className,
}: {
  week: GoalWeek;
  today: string;
  labels?: boolean;
  className?: string;
}) {
  const peak = Math.max(1, ...week.days.map((d) => d.done));
  return (
    <div
      className={cn("flex items-end gap-1.5", className)}
      role="img"
      aria-label={`${week.done} of ${week.total} blocks done this week`}
    >
      {week.days.map((d) => {
        const isToday = d.day === today;
        const height = d.done ? Math.max(18, Math.round((d.done / peak) * 100)) : 0;
        return (
          <span key={d.day} className="flex flex-col items-center gap-1" title={`${dayName(d.day)} · ${d.done}/${d.total} done`}>
            <span
              className={cn(
                "relative flex h-6 w-[5px] items-end rounded-full bg-white/[0.055]",
                isToday && "ring-1 ring-hud/35 ring-offset-1 ring-offset-transparent",
              )}
            >
              {d.done > 0 && (
                <span
                  className={cn("w-full rounded-full", isToday ? "bg-hud" : "bg-ok/75")}
                  style={{ height: `${height}%` }}
                />
              )}
            </span>
            {labels && (
              <span className={cn("font-mono text-[8px] uppercase tracking-[0.08em]", isToday ? "text-hud" : "text-faint")}>
                {dayLabel(d.day)}
              </span>
            )}
          </span>
        );
      })}
    </div>
  );
}
