import { coachNow, clockNow, coachTz } from "../lib/coach";
import { addDays } from "../lib/calendar";
import { sortTopics, studiedTerms } from "../lib/learning-topics";
import { readRun, sessionHref, startSunday, sundayOf } from "../lib/learning-sunday";
import { listItems } from "../lib/library";
import { addTodo, listTodos } from "../lib/todos";
import { askJSON } from "./dump";
import { notify as realNotify } from "./notify";
import { perTenant } from "../lib/tenant";

// The Sunday blurt, runner side (v6). At 10:00 on Sunday the week's session opens, with a push and a task
// on Today. If it's still open on Monday at 10:00, one more push. Between times, topics get sorted.

const log = (...a: unknown[]) => console.log(new Date().toISOString(), "sunday:", ...a);
const AT = () => process.env.LEARNING_SUNDAY_AT ?? "10:00";
const MINUTES_PER_ROUND = 5;
type Notify = (n: { key: string; kind: "coach"; title: string; body: string; push: { title: string; body: string }; href: string; priority: 3; expiresAt: string }) => Promise<unknown>;

const notice = (key: string, title: string, body: string, now: Date) => ({ key, kind: "coach" as const, title, body, push: { title, body }, href: sessionHref, priority: 3 as const, expiresAt: new Date(now.getTime() + 24 * 3600_000).toISOString() });

export async function sundayTick({ day, minute, notify, now }: { day: string; minute: string; notify: Notify; now: Date }) {
  const sunday = sundayOf(day);
  const open = readRun(`sunday-${sunday}`);
  if (day === addDays(sunday, 1) && minute === AT() && open?.state === "open") {
    await notify(notice(`learning:sunday-again:${sunday}`, "Your Sunday blurt is still open", "Pick up where you left off. Nothing's lost.", now));
    return;
  }
  if (day !== sunday || minute < AT() || open) return;
  const items = listItems();
  if (!studiedTerms(items).length) return;
  const s = startSunday(day, now);
  const terms = s.rounds.reduce((n, r) => n + r.terms.length, 0);
  const minutes = s.rounds.length * MINUTES_PER_ROUND;
  if (!listTodos().some((t) => t.day === day && t.link === sessionHref)) addTodo({ title: "Sunday blurting session", notes: `${s.rounds.length} rounds, ${terms} terms.`, day, priority: 3, estimateMin: minutes, link: sessionHref });
  await notify(notice(`learning:sunday:${day}`, "Sunday blurt", `${s.rounds.length} rounds, ${terms} terms, everything you've learned. About ${minutes} minutes.`, now));
  log("opened", day, s.rounds.length, terms);
}

// One copy per account (the runner runs every user's jobs in turn).
const st = perTenant(() => ({ sorting: false, lastSort: 0 }));
const SORT_EVERY = 10 * 60_000;

export function learningSundayTick() {
  void sundayTick({ day: coachNow().day, minute: clockNow(coachTz()), notify: realNotify as Notify, now: new Date() }).catch((e) => log(e instanceof Error ? e.message : e));
  if (st().sorting || Date.now() - st().lastSort < SORT_EVERY) return;
  st().sorting = true;
  st().lastSort = Date.now();
  void sortTopics(listItems(), (system, user, tokens) => askJSON(system, user, tokens))
    .then((n) => n && log("sorted", n))
    .catch((e) => log("topics", e instanceof Error ? e.message : e))
    .finally(() => (st().sorting = false));
}
