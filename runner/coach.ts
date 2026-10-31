import { addDays } from "../lib/calendar";
import { buildRecap, clockNow, coachNow, coachTz, goalProgress, readRecap, saveRecap, zonedMs } from "../lib/coach";
import { coachMoments } from "../lib/coach-moments";
import { groqJSON } from "../lib/groq";
import { activeBlocks, readPlan } from "../lib/plan-store";
import { assistantTick, eveningNote } from "./assistant";
import { notify, sweepNotices } from "./notify";

// The Coach, runner side (Lind chose "Coach", 2026-10-31): a push when a block starts, a nudge when
// it hasn't been started 10 minutes in, a halfway check-in on long blocks, "done?" at the end, a
// plan reminder at 07:30 when there's no plan, and the 21:30 recap scored against his goals.
// Every push opens /focus on that block, where one tap starts, finishes, shrinks or moves it.

const log = (...a: unknown[]) => console.log(new Date().toISOString(), "coach:", ...a);
// The morning briefing goes out at 07:30; this nudge only comes if there's still no plan after it.
const PLAN_REMINDER = () => process.env.COACH_PLAN_AT ?? "08:15";
const RECAP_AT = () => process.env.COACH_RECAP_AT ?? "21:30";
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
      start: { title: `Now: ${b.title}`, body: g ? `Serves "${g.goal.title}" — ${fmtMin(g.weekMin)} of ${fmtMin(g.targetMin)} this week. Tap to start.` : `${b.start}–${b.end}. Tap to start.` },
      nudge: { title: `Still not started: ${b.title}`, body: "Start it, shrink it to 25 minutes, or move it — tap to choose." },
      checkin: { title: `Halfway${serves}`, body: `How's "${b.title}" going? On track, stuck, or distracted?` },
      end: { title: `Time's up: ${b.title}`, body: "Done? Tap to tick it — or keep going 15 more minutes." },
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

  await assistantTick(minute).catch((e) => log("assistant", e instanceof Error ? e.message : e));

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
    const r = buildRecap(day);
    r.note = old.note;
    saveRecap(r);
  }

  // 21:30: the recap, once.
  if (minute >= RECAP_AT() && !old && now.planned) {
    const r = buildRecap(day);
    const tomorrow = activeBlocks(readPlan(addDays(day, 1))).length;
    // Sol's evening review (written at 21:25) is the note when it's there; Groq writes a short one if not.
    const sol = eveningNote(day);
    const out = sol ? { note: sol } : await groqJSON<{ note: string }>(
      `You are Lind's coach. Write his evening recap: 2-3 short sentences, direct and warm, no fluff. Name what moved, the one thing that slipped and why it matters for his goals, and one concrete move for tomorrow morning. Return JSON {"note": string}.`,
      JSON.stringify({ score: r.score, done: `${r.done}/${r.total}`, focus: `${r.focusMin} of ${r.plannedMin} planned minutes`, goals: r.goals, skipped: r.skipped.slice(0, 6), checkins: r.moods, tomorrowPlanned: tomorrow }),
      0.4,
      { maxTokens: 300 },
    ).catch(() => null);
    r.note = out?.note?.trim() || undefined;
    saveRecap(r);
    await notify({
      key: `coach:recap:${day}`,
      kind: "coach",
      title: `Today: ${r.score}/100`,
      body: r.note ?? `${r.done} of ${r.total} blocks, ${fmtMin(r.focusMin)} focused.`,
      push: { title: `Your day: ${r.score}/100`, body: `${r.done}/${r.total} blocks · ${fmtMin(r.focusMin)} focused. Tap for the recap.` },
      href: `/goals?recap=${day}`,
      priority: 3,
      expiresAt: new Date(Date.now() + 14 * 3600_000).toISOString(),
    });
    log("recap", day, r.score);
  }
}

