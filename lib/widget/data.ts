import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "../config";
import { addDays, dayString, type CalEvent } from "../calendar";
import { coachNow, coachTz, goalProgress, zonedMs } from "../coach";
import { activeBlocks, readPlan } from "../plan-store";
import { habitsFor } from "../habits";
import { todosFor } from "../todos";

// Reads only: no planner generation, task imports, sync, goal mirrors, or calendar writes.
// Calendar uses the same real primary-calendar snapshot the runner syncs hourly for Memory.
export function readWidgetData(at = new Date()) {
  const tz = coachTz();
  const day = dayString(tz, at);
  let calendar: { at: string; items: CalEvent[] } | null = null;
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "sources", "calendar.json"), "utf8"));
    if (Array.isArray(raw.items) && Number.isFinite(Date.parse(raw.at))) calendar = raw;
  } catch { /* An unavailable source is labelled, never replaced with demo data. */ }
  const dayStart = zonedMs(day, "00:00", tz);
  const dayEnd = zonedMs(addDays(day, 1), "00:00", tz);
  const events = (calendar?.items ?? []).filter((e) => {
    if (!e.start || !e.end || e.planned) return false; // Planner reservations already appear in the plan.
    if (e.allDay) return e.start <= day && e.end > day; // all-day end is exclusive
    return Date.parse(e.start) < dayEnd && Date.parse(e.end) > dayStart;
  }).sort((a, b) => a.start.localeCompare(b.start));
  return {
    at: at.toISOString(), tz, day,
    blocks: activeBlocks(readPlan(day)),
    tasks: todosFor(day),
    goals: goalProgress(at),
    focus: coachNow(at),
    habits: habitsFor(day),
    calendar: { syncedAt: calendar?.at ?? null, events },
  };
}
export type WidgetData = ReturnType<typeof readWidgetData>;
