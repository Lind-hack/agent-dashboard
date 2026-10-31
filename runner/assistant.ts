import { BRIEF_PROMPT, BRIEF_SYSTEM, dayContext, latestBrief, parseBrief, readBrief, saveBrief, takeBriefRequest, type BriefSlot } from "../lib/assistant";
import { agenda, calendarConnected, type CalEvent } from "../lib/calendar";
import { clockNow, coachNow, coachTz, dayProgress, zonedMs } from "../lib/coach";
import { solJSON, solLabel } from "../lib/sol";
import { todosFor, remainingMin } from "../lib/todos";
import { notify } from "./notify";

// The Day assistant, runner side (v5):
// - Sol briefings: morning 07:30, midday 13:00, evening 21:25 (the 21:30 recap reads it) — plus any
//   "Ask Sol" request from the page. Sol runs in the background; the minute tick never waits on it.
// - Reminders to every subscribed device (iPhone + PC): calendar events 10 minutes before, tasks 30
//   minutes before their deadline and when it passes, and the day's progress at 16:00 and 19:00.

const log = (...a: unknown[]) => console.log(new Date().toISOString(), "assistant:", ...a);
const AT: Record<BriefSlot, () => string> = {
  morning: () => process.env.BRIEF_MORNING_AT ?? "07:30",
  midday: () => process.env.BRIEF_MIDDAY_AT ?? "13:00",
  evening: () => process.env.BRIEF_EVENING_AT ?? "21:25",
};
const PROGRESS_AT = () => (process.env.PROGRESS_AT ?? "16:00,19:00").split(",").map((s) => s.trim());
const fmt = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}` : `${m}m`);

let briefing = false;
let events: { at: number; list: CalEvent[] } = { at: 0, list: [] };

async function writeBrief(slot: BriefSlot, push: boolean) {
  const day = coachNow().day;
  const context = await dayContext();
  const raw = await solJSON<{ headline: string; body: string; focus: unknown[]; actions: unknown[] }>(`${BRIEF_SYSTEM}\n\n${BRIEF_PROMPT[slot]}`, context, 8 * 60_000);
  const brief = parseBrief(day, slot, raw, solLabel());
  if (!brief) {
    log(slot, "Sol gave no usable briefing");
    return;
  }
  saveBrief(brief);
  log(slot, brief.headline);
  if (push)
    await notify({
      key: `coach:brief:${day}:${slot}:${brief.createdAt}`,
      kind: "coach",
      title: brief.headline,
      body: brief.focus.length ? `Focus: ${brief.focus.join(" · ")}` : brief.body.slice(0, 160),
      push: { title: brief.headline, body: brief.focus.length ? brief.focus.join(" · ") : brief.body.replace(/[#*_>`]/g, "").slice(0, 140) },
      href: "/calendar#assistant",
      priority: slot === "morning" ? 3 : 2,
      expiresAt: new Date(Date.now() + 8 * 3600_000).toISOString(),
    });
}

function startBrief(slot: BriefSlot, push: boolean) {
  if (briefing) return false;
  briefing = true;
  void writeBrief(slot, push)
    .catch((e) => log(slot, e instanceof Error ? e.message : e))
    .finally(() => (briefing = false));
  return true;
}

async function todaysEvents(): Promise<CalEvent[]> {
  if (!calendarConnected()) return [];
  if (Date.now() - events.at > 5 * 60_000) {
    const a = await agenda(1).catch(() => null);
    if (a) events = { at: Date.now(), list: a.events.filter((e) => !e.allDay && !e.planned) };
  }
  return events.list;
}

// Called once a minute from the coach tick.
export async function assistantTick(minute: string) {
  const tz = coachTz();
  const day = coachNow().day;

  // Briefings: the scheduled ones, else an "Ask Sol" from the page.
  for (const slot of ["morning", "midday", "evening"] as BriefSlot[]) {
    if (minute === AT[slot]() && !readBrief(day, slot)) startBrief(slot, slot !== "evening");
  }
  if (!briefing) {
    const req = takeBriefRequest();
    if (req) startBrief(req.slot, false);
  }

  const now = Date.now();
  // Calendar events: 10 minutes before.
  for (const e of await todaysEvents()) {
    const start = Date.parse(e.start);
    if (start - now <= 10 * 60_000 && start - now > 0)
      await notify({
        key: `coach:event:${e.id}:${e.start}`,
        kind: "coach",
        title: `In ${Math.max(1, Math.round((start - now) / 60_000))} min: ${e.title}`,
        body: `${clockNow(tz, new Date(start))}–${clockNow(tz, new Date(e.end))}${e.location ? ` · ${e.location}` : ""}`,
        push: { title: `${clockNow(tz, new Date(start))} · ${e.title}`, body: e.location ? `In 10 minutes · ${e.location}` : "In 10 minutes." },
        href: "/calendar",
        priority: 2,
        expiresAt: new Date(start + 30 * 60_000).toISOString(),
      });
  }

  // Task deadlines with a time: 30 minutes before, and when they pass.
  const t = todosFor(day);
  for (const x of [...t.overdue, ...t.today]) {
    if (!x.due?.includes("T") || x.due.slice(0, 10) !== day) continue;
    const due = zonedMs(day, x.due.slice(11, 16), tz);
    const left = remainingMin(x);
    if (due - now <= 30 * 60_000 && due - now > 0)
      await notify({
        key: `coach:due30:${x.id}:${x.due}`,
        kind: "coach",
        title: `Due at ${x.due.slice(11, 16)}: ${x.title}`,
        body: `About ${fmt(left)} of work left. Tap to start it now.`,
        push: { title: `Due ${x.due.slice(11, 16)}: ${x.title}`, body: `~${fmt(left)} left — start now.` },
        href: "/calendar#tasks",
        priority: 3,
        expiresAt: new Date(due + 2 * 3600_000).toISOString(),
      });
    if (now >= due && now - due < 15 * 60_000)
      await notify({
        key: `coach:due0:${x.id}:${x.due}`,
        kind: "coach",
        title: `Past due: ${x.title}`,
        body: "Finish it, shrink it, or give it a new time.",
        push: { title: `Past due: ${x.title}`, body: "Finish, shrink, or reschedule — tap." },
        href: "/calendar#tasks",
        priority: 3,
        expiresAt: new Date(due + 6 * 3600_000).toISOString(),
      });
  }

  // How the day is going, at fixed times (no AI): only when there's something on today.
  if (PROGRESS_AT().includes(minute)) {
    const p = await dayProgress();
    if (p.tasksTotal || p.blocksTotal) {
      const head = p.pace === "behind" ? `Behind: ${p.percent}% done (aim ~${p.expected}%)` : `${p.percent}% done — ${p.pace === "ahead" ? "ahead of pace" : "on pace"}`;
      const body = [`${p.tasksDone}/${p.tasksTotal} tasks`, `${fmt(p.workLeftMin)} of work left`, `${fmt(p.untilEndMin)} in the day`, p.overloadMin ? `${fmt(p.overloadMin)} won't fit — cut or move something` : "", p.next ? `Next: ${p.next.title}` : ""].filter(Boolean).join(" · ");
      await notify({
        key: `coach:progress:${day}:${minute}`,
        kind: "coach",
        title: head,
        body,
        push: { title: head, body },
        href: "/calendar#assistant",
        priority: p.pace === "behind" ? 3 : 2,
        expiresAt: new Date(now + 3 * 3600_000).toISOString(),
      });
    }
  }
}

// The evening review Sol wrote, for the 21:30 recap's note.
export const eveningNote = (day: string) => {
  const b = readBrief(day, "evening") ?? latestBrief(day);
  return b?.slot === "evening" ? `${b.headline}\n\n${b.body}` : undefined;
};
