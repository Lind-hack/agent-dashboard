import { clockNow, coachNow, coachTz } from "../lib/coach";
import { readMentorDay, writeMentorDay } from "../lib/mentor";
import { notify } from "./notify";

// The Mentor, runner side (v5.4): at 07:00, before Autopilot plans the day at 07:30, today's orders —
// written with Sol (Groq if Sol is out) — land on Today as top-priority tasks, so the plan books them
// first. Runs beside the Coach, not inside it: a slow Sol call must never hold up a block's push.

const log = (...a: unknown[]) => console.log(new Date().toISOString(), "mentor:", ...a);
const AT = () => process.env.MENTOR_AT ?? "07:00";
const tried = new Map<string, number>(); // day → tries
let busy = false;

export function mentorTick() {
  if (busy || process.env.MENTOR_ENABLED === "0") return;
  const minute = clockNow(coachTz());
  const day = coachNow().day;
  if (minute < AT() || minute >= "12:00" || readMentorDay(day)) return;
  const n = tried.get(day) ?? 0;
  // Three tries, ten minutes apart.
  if (n >= 3 || (n > 0 && !minute.endsWith("0"))) return;
  tried.set(day, n + 1);
  busy = true;
  void writeMentorDay(day, { useSol: n === 0 })
    .then(async (d) => {
      log("orders", day, d.orders.length, d.model);
      await notify({
        key: `mentor:${day}`,
        kind: "coach",
        title: `Today's orders: ${d.orders.length}`,
        body: d.orders.map((o) => `• ${o.title}`).join("\n").slice(0, 280),
        push: { title: "Your mentor's orders for today", body: d.orders.map((o) => o.title).join(" · ").slice(0, 150) },
        href: "/goals#orders",
        priority: 3,
        expiresAt: new Date(Date.now() + 12 * 3600_000).toISOString(),
      });
    })
    .catch((e) => {
      // "No goal has a plan yet" isn't worth retrying today.
      if (/no goal has a plan/i.test(String(e?.message))) tried.set(day, 3);
      log("failed", e instanceof Error ? e.message : e);
    })
    .finally(() => (busy = false));
}
