import { autopilotEnabled, readAutopilot, runEvening, runMidday, runMorning, type Step, type StepLog } from "../lib/autopilot";
import { coachNow } from "../lib/coach";
import { notify } from "./notify";

// Autopilot, runner side (v5.1): runs each step once a day at its time (or up to 3 hours later if the
// runner was down or Sol failed — 3 tries, 15 minutes apart), in the background, and pushes what it did
// with a link to undo it. The Day assistant's briefing for that slot waits until the step is done.

const log = (...a: unknown[]) => console.log(new Date().toISOString(), "autopilot:", ...a);
const AT: Record<Step, () => string> = {
  morning: () => process.env.AUTOPILOT_MORNING_AT ?? process.env.BRIEF_MORNING_AT ?? "07:30",
  midday: () => process.env.AUTOPILOT_MIDDAY_AT ?? process.env.BRIEF_MIDDAY_AT ?? "13:00",
  evening: () => process.env.AUTOPILOT_EVENING_AT ?? "21:20",
};
const RUN: Record<Step, () => Promise<StepLog> | StepLog> = { morning: runMorning, midday: runMidday, evening: runEvening };
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const tries = new Map<string, { n: number; last: number }>();
let running = false;

const PUSH: Record<Step, (l: StepLog) => { title: string; body: string } | null> = {
  morning: (l) => (l.skipped ? null : { title: `Your day is planned: ${l.blocks ?? 0} blocks`, body: `${l.summary.slice(0, 120)} — tap to see it or undo.` }),
  midday: (l) => (l.skipped ? null : { title: `Afternoon re-planned: ${l.blocks ?? 0} blocks`, body: `${l.summary.slice(0, 120)} — tap to see it or undo.` }),
  evening: (l) => (l.moved ? { title: `${l.moved} task${l.moved > 1 ? "s" : ""} moved to tomorrow`, body: "Tap to see them or undo." } : null),
};

export function autopilotTick(minute: string) {
  if (running || !autopilotEnabled()) return;
  const day = coachNow().day;
  const done = readAutopilot(day).steps;
  for (const step of ["morning", "midday", "evening"] as Step[]) {
    const late = toMin(minute) - toMin(AT[step]());
    if (late < 0 || late > 180 || done[step]) continue;
    const key = `${day}:${step}`;
    const t = tries.get(key) ?? { n: 0, last: 0 };
    if (t.n >= 3 || Date.now() - t.last < 15 * 60_000) continue;
    tries.set(key, { n: t.n + 1, last: Date.now() });
    running = true;
    void Promise.resolve(RUN[step]())
      .then(async (l) => {
        log(step, l.skipped ? `skipped (${l.skipped})` : l.error ? `error: ${l.error}` : l.summary);
        const p = l.error && !l.blocks ? null : PUSH[step](l);
        if (p)
          await notify({
            key: `coach:autopilot:${day}:${step}`,
            kind: "coach",
            title: p.title,
            body: p.body,
            push: p,
            href: `/calendar?autopilot=${step}#autopilot`,
            priority: 2,
            expiresAt: new Date(Date.now() + 6 * 3600_000).toISOString(),
          });
      })
      .catch((e) => log(step, e instanceof Error ? e.message : e))
      .finally(() => (running = false));
    return;
  }
}

// The briefing for a slot waits for that slot's Autopilot step (when Autopilot is on).
export const stepSettled = (day: string, step: Step) => !autopilotEnabled() || !!readAutopilot(day).steps[step];
