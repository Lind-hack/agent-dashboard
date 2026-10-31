import { keptStreak, mirror, mirrorText } from "../lib/accountability";
import { syncCalendar } from "../lib/autopilot";
import { addDays } from "../lib/calendar";
import { buildRecap, calendarBusy, clockNow, coachNow, coachTz, goalProgress, nextFreeSlot, readRecap, saveRecap, zonedMs } from "../lib/coach";
import { coachMoments } from "../lib/coach-moments";
import { groqJSON } from "../lib/groq";
import { readPush, writePush } from "../lib/goggins";
import { activeBlocks, readPlan, rescheduleBlock } from "../lib/plan-store";
import { assistantTick, eveningNote } from "./assistant";
import { autopilotTick, stepSettled } from "./autopilot";
import { buddyTick } from "./buddy";
import { notify, sweepNotices } from "./notify";

// The Coach, runner side (Lind chose "Coach", 2026-10-31): a push when a block starts, a nudge when
// it hasn't been started 10 minutes in, a halfway check-in on long blocks, "done?" at the end, a
// plan reminder at 07:30 when there's no plan, and the 21:30 recap scored against his goals.
// Every push opens /focus on that block, where one tap starts, finishes, shrinks or moves it.
// Goggins mode (v5.2, Lind's pick): the wording has no cushion; a block that comes and goes without
// being started is put into the next free slot today (once) and he's told so; the recap is the
// "accountability mirror" — said vs did, block by block — with the kept-days streak; and at 07:40
// (after Autopilot's morning plan) a long push in the spirit of David Goggins, written from his record.

const log = (...a: unknown[]) => console.log(new Date().toISOString(), "coach:", ...a);
// The morning briefing goes out at 07:30; this nudge only comes if there's still no plan after it.
const PLAN_REMINDER = () => process.env.COACH_PLAN_AT ?? "08:15";
const RECAP_AT = () => process.env.COACH_RECAP_AT ?? "21:30";
const PUSH_AT = () => process.env.GOGGINS_AT ?? "07:40";
const pushTried = new Map<string, number>(); // day → tries
let lastMinute = "";
let busy = false;

const fmtMin = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}` : `${m}m`);

export function coachTick() {
  if (busy || process.env.COACH_ENABLED === "0") return;
  const tz = coachTz();
  const minute = clockNow(tz);
  if (minute === lastMinute) return;
  lastMinute = minute;
  busy = true;
  void run(tz, minute)
    .catch((e) => log(e instanceof Error ? e.message : e))
    .finally(() => (busy = false));
}

async function run(tz: string, minute: string) {
  sweepNotices();
  const now = coachNow();
  const day = now.day;
  const plan = readPlan(day);
  const blocks = activeBlocks(plan).map((b) => ({ ...b, startMs: zonedMs(day, b.start, tz), endMs: zonedMs(day, b.end, tz) }));
  const goals = new Map(goalProgress().map((g) => [g.goal.id, g]));

  for (const m of coachMoments(blocks, Date.now())) {
    const b = m.block as (typeof blocks)[number];
    const g = b.goalId ? goals.get(b.goalId) : undefined;
    const serves = g ? ` · ${g.goal.title}` : "";
    const text = {
      start: { title: `Now: ${b.title}`, body: g ? `You said ${b.start}. "${g.goal.title}" is at ${fmtMin(g.weekMin)} of ${fmtMin(g.targetMin)} this week. Start — not in five minutes, now.` : `You said ${b.start}–${b.end}. The clock is running. Start now.` },
      nudge: { title: `10 minutes late: ${b.title}`, body: "Every minute you wait is one you lied to yourself about. Start it now, shrink it to 25, or move it — decide." },
      checkin: { title: `Halfway${serves}`, body: `"${b.title}" — honestly: on track, stuck, or distracted?` },
      end: { title: `Time's up: ${b.title}`, body: "Did you finish what you said you'd finish? Tick it — or take 15 more and earn it." },
    }[m.kind];
    const sent = await notify({
      key: m.key,
      kind: "coach",
      title: text.title,
      body: text.body,
      push: text,
      href: `/focus?block=${encodeURIComponent(b.id)}${m.kind === "checkin" ? "&checkin=1" : ""}`,
      priority: 2,
      expiresAt: new Date(b.endMs + 30 * 60_000).toISOString(),
    });
    if (sent) log(m.kind, b.id);
  }

  // A block that came and went without being started: back into free time today, once.
  for (const b of blocks) {
    if (b.kind === "break" || b.status !== "planned" || b.startedAt || b.rescheduledFrom || b.rescheduledTo) continue;
    if (Date.now() < b.endMs || Date.now() > b.endMs + 60 * 60_000) continue;
    const len = Math.round((b.endMs - b.startMs) / 60_000);
    const slot = nextFreeSlot(len, new Date(), await calendarBusy().catch(() => []));
    const moved = slot ? rescheduleBlock(day, b.id, slot) : null;
    if (moved) {
      const calErr = await syncCalendar(day);
      if (calErr) log("reschedule calendar", calErr);
    }
    await notify({
      key: `coach:missed:${b.id}`,
      kind: "coach",
      title: `Missed: ${b.title}`,
      body: moved ? `${b.start}–${b.end} came and went. It's back at ${moved.start}–${moved.end}. You don't get to skip it twice.` : `${b.start}–${b.end} came and went and there's no free time left today. That one's on the mirror tonight.`,
      push: { title: `Missed: ${b.title}`, body: moved ? `It's back at ${moved.start}. Don't skip it twice.` : "No time left today — it's on tonight's mirror." },
      href: moved ? `/focus?block=${encodeURIComponent(moved.id)}` : "/mirror",
      priority: 2,
      expiresAt: new Date(Date.now() + 4 * 3600_000).toISOString(),
    });
    log("missed", b.id, moved ? `→ ${moved.start}` : "no slot");
  }

  // The morning push, once Autopilot's morning step has settled (or by 09:00 regardless).
  if (minute >= PUSH_AT() && minute < "12:00" && !readPush(day) && (stepSettled(day, "morning") || minute >= "09:00")) {
    const tries = pushTried.get(day) ?? 0;
    if (tries < 3 && (tries === 0 || minute.endsWith("0"))) {
      pushTried.set(day, tries + 1);
      try {
        const p = await writePush(day);
        await notify({
          key: `coach:goggins:${day}`,
          kind: "coach",
          title: p.title,
          body: p.text.slice(0, 280),
          push: { title: p.title, body: `${p.text.replace(/\s+/g, " ").slice(0, 150)}…` },
          href: "/mirror#push",
          priority: 3,
          expiresAt: new Date(Date.now() + 10 * 3600_000).toISOString(),
        });
        log("push", day, p.model);
      } catch (e) {
        log("push failed", e instanceof Error ? e.message : e);
      }
    }
  }

  autopilotTick(minute);
  await assistantTick(minute).catch((e) => log("assistant", e instanceof Error ? e.message : e));
  await buddyTick(minute).catch((e) => log("buddy", e instanceof Error ? e.message : e));

  // Still nothing planned after the morning briefing: one reminder.
  if (minute === PLAN_REMINDER() && !now.planned) {
    const top = [...goals.values()].filter((g) => g.goal.horizon !== "long").slice(0, 2);
    await notify({
      key: `coach:plan:${day}`,
      kind: "coach",
      title: "Plan your day — 2 minutes",
      body: top.length ? `Goals waiting: ${top.map((g) => g.goal.title).join(", ")}.` : "Set a goal or two, then plan the day.",
      push: { title: "Plan your day", body: "Two minutes now saves the whole day. Tap to plan." },
      href: "/calendar",
      priority: 3,
      expiresAt: new Date(Date.now() + 6 * 3600_000).toISOString(),
    });
  }

  // Work ticked after the recap was written still counts: refresh it quietly until midnight.
  const old = readRecap(day);
  if (old && plan && plan.updatedAt > old.createdAt) {
    const r = withMirror(buildRecap(day));
    r.note = old.note;
    saveRecap(r);
  }

  // 21:30: the recap, once.
  if (minute >= RECAP_AT() && !old && now.planned) {
    const r = withMirror(buildRecap(day));
    const tomorrow = activeBlocks(readPlan(addDays(day, 1))).length;
    // Sol's evening review (written at 21:25) is the note when it's there; Groq writes a short one if not.
    const sol = eveningNote(day);
    const out = sol ? { note: sol } : await groqJSON<{ note: string }>(
      `You are Lind's coach in Goggins mode: the accountability mirror. Write his evening recap in 3-4 short sentences, no cushion and no cruelty: what he said he'd do vs what he did — name the missed and late blocks with their times — whether the streak lives, and the one thing he does differently tomorrow morning. Never quote anyone. Return JSON {"note": string}.`,
      `${mirrorText(mirror(day))}\n\n${JSON.stringify({ score: r.score, streak: r.streak, focus: `${r.focusMin} of ${r.plannedMin} planned minutes`, goals: r.goals, checkins: r.moods, tomorrowPlanned: tomorrow })}`,
      0.4,
      { maxTokens: 300 },
    ).catch(() => null);
    r.note = out?.note?.trim() || undefined;
    saveRecap(r);
    await notify({
      key: `coach:recap:${day}`,
      kind: "coach",
      title: `Mirror: ${r.kept ? "day kept" : "day not kept"} · ${r.score}/100`,
      body: r.note ?? `${r.done} of ${r.total} blocks, ${r.onTimeRate ?? 0}% on time, ${r.missed ?? 0} missed.`,
      push: { title: `Mirror: ${r.kept ? `kept — ${r.streak}-day streak` : `not kept — ${r.missed ?? 0} missed`}`, body: `${r.done}/${r.total} blocks · ${r.onTimeRate ?? 0}% on time · ${fmtMin(r.focusMin)} focused. Face it and answer for it.` },
      href: `/mirror`,
      priority: 3,
      expiresAt: new Date(Date.now() + 14 * 3600_000).toISOString(),
    });
    log("recap", day, r.score);
  }
}

// The recap with the mirror's numbers and the streak (kept days, today included once it's over).
function withMirror(r: ReturnType<typeof buildRecap>) {
  const m = mirror(r.day);
  const s = keptStreak(r.day);
  return { ...r, onTimeRate: m.onTimeRate, missed: m.missed + m.notStarted, kept: m.kept, streak: s.days };
}
