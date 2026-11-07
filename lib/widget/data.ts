import fs from "node:fs";
import path from "node:path";

import { addDays, dayString, type CalEvent } from "../calendar";
import { coachNow, coachTz, dayProgress, goalProgress, zonedMs } from "../coach";
import { activeBlocks, readPlan } from "../plan-store";
import { habitsFor } from "../habits";
import { readJob, type Job } from "../store";
import { todosFor } from "../todos";
import { dataDir } from "../tenant";

// Reads only: no planner generation, task imports, sync, goal mirrors, or calendar writes.
// Calendar uses the same real primary-calendar snapshot the runner syncs hourly for Memory.
export async function readWidgetData(at = new Date()) {
  const tz = coachTz();
  const day = dayString(tz, at);
  let calendar: { at: string; items: CalEvent[] } | null = null;
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(dataDir(), "sources", "calendar.json"), "utf8"));
    if (Array.isArray(raw.items) && Number.isFinite(Date.parse(raw.at))) calendar = raw;
  } catch { /* An unavailable source is labelled, never replaced with demo data. */ }
  const dayStart = zonedMs(day, "00:00", tz);
  const dayEnd = zonedMs(addDays(day, 1), "00:00", tz);
  const events = (calendar?.items ?? []).filter((e) => {
    if (!e.start || !e.end || e.planned) return false; // Planner reservations already appear in the plan.
    if (e.allDay) return e.start <= day && e.end > day; // all-day end is exclusive
    return Date.parse(e.start) < dayEnd && Date.parse(e.end) > dayStart;
  }).sort((a, b) => a.start.localeCompare(b.start));
  // Read actual runner records without listJobs(), which creates directories on read.
  const jobsDir = path.join(dataDir(), "jobs");
  const jobs = fs.existsSync(jobsDir) ? fs.readdirSync(jobsDir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => readJob(file.slice(0, -5)))
    .filter((job): job is Job => job !== null)
    .filter((job) => ["running", "preparing", "queued", "failed"].includes(job.status))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) : [];
  const minutes = (iso: string) => {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso)).split(":").map(Number);
    return parts[0] * 60 + parts[1];
  };
  const busy = events.filter((e) => !e.allDay).map((e): [number, number] => [
    Date.parse(e.start) <= dayStart ? 0 : minutes(e.start),
    Date.parse(e.end) >= dayEnd ? 1440 : minutes(e.end),
  ]);
  const progress = await dayProgress(at, busy);
  return {
    progress,
    agents: jobs.map((job) => ({ id: job.id, agent: job.agent, status: job.status, title: job.title })),
    at: at.toISOString(), tz, day,
    blocks: activeBlocks(readPlan(day)),
    tasks: todosFor(day),
    goals: goalProgress(at),
    focus: coachNow(at),
    habits: habitsFor(day),
    calendar: { syncedAt: calendar?.at ?? null, events },
  };
}
export type WidgetData = Awaited<ReturnType<typeof readWidgetData>>;
