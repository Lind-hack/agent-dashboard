import fs from "node:fs";
import path from "node:path";
import { addDays } from "./calendar";
import { goalProgress } from "./coach";
import { DATA_DIR } from "./config";
import { readGoals, type Goal } from "./goals";
import { groqJSON } from "./groq";
import { readProfile } from "./buddy";
import { recallMemory, recallText } from "./memory";
import { solEnabled, solJSON, solLabel } from "./sol";
import { addTodo, listTodos } from "./todos";

// The Mentor (v5.4, Lind: "guide me every day on what to do and how to do it to achieve those goals").
// Each goal gets a plan: the number it ends at and by when, dated milestones, and the handful of
// leading indicators he controls (outreach sent, offers made, videos posted…) with a weekly target.
// He logs the numbers (voice, or the + on the scorecard). Every morning, before Autopilot plans the
// day, the Mentor reads the plans, the week's scorecard, yesterday's orders and what got done, and
// gives 1–3 orders for today — each with how to do it — that land on Today as top-priority tasks
// tied to the goal, so the planner books them first. An original voice that works the way Hormozi
// and Bezos teach (volume, offers, constraints; work back from the goal); never their words.
// data/mentor/plans/<goalId>.json · data/mentor/log.json · data/mentor/days/<day>.json

export type Indicator = { key: string; label: string; unit: string; weekly: number };
export type Milestone = { by: string; label: string; value?: number };
export type GoalPlan = {
  goalId: string;
  goalTitle: string;
  outcome: { label: string; unit: string; target: number; by: string; baseline: number };
  milestones: Milestone[];
  indicators: Indicator[];
  strategy: string; // the mentor's read: the path, the constraint, what to ignore
  model: string;
  createdAt: string;
};
export type MetricEntry = { goalId: string; key: string; value: number; day: string; at: string };
export type Order = { goalId: string; title: string; how: string; minutes: number; indicator?: string; todoId?: string };
export type MentorDay = { day: string; note: string; orders: Order[]; model: string; createdAt: string };

export const OUTCOME = "outcome"; // the key the goal's end number is logged under

const dir = () => path.join(DATA_DIR, "mentor");
const planFile = (goalId: string) => path.join(dir(), "plans", `${goalId.replace(/[^a-z0-9-]/gi, "")}.json`);
const logFile = () => path.join(dir(), "log.json");
const dayFile = (day: string) => path.join(dir(), "days", `${day}.json`);
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function readJSON<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}
function writeJSON(file: string, data: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.${process.pid}.tmp`, JSON.stringify(data, null, 2));
  fs.renameSync(`${file}.${process.pid}.tmp`, file);
}

const keyOf = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32) || "metric";
const num = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : d);

// ---- plans ------------------------------------------------------------------------------------

export function readPlanFor(goalId: string): GoalPlan | null {
  const p = readJSON<GoalPlan>(planFile(goalId));
  return p?.goalId ? { ...p, milestones: p.milestones ?? [], indicators: p.indicators ?? [] } : null;
}

// Whatever a model (or the editor) hands back, made safe to store: numbers are numbers, dates are
// dates, indicator keys are unique slugs, at most 5 indicators and 6 milestones.
export function cleanPlan(goal: Goal, raw: Partial<GoalPlan> | null | undefined, model: string, today: string): GoalPlan | null {
  const o = raw?.outcome;
  const target = num(o?.target, NaN);
  if (!o || !Number.isFinite(target)) return null;
  const by = DAY.test(String(o.by ?? "")) ? String(o.by) : (goal.due ?? addDays(today, 365));
  const seen = new Set<string>([OUTCOME]);
  const indicators = (Array.isArray(raw?.indicators) ? raw.indicators : [])
    .map((i) => ({ key: keyOf(String(i?.key || i?.label || "")), label: String(i?.label ?? "").trim().slice(0, 60), unit: String(i?.unit ?? "").trim().slice(0, 16), weekly: Math.max(0, Math.round(num(i?.weekly))) }))
    .filter((i) => i.label && i.weekly > 0 && !seen.has(i.key) && seen.add(i.key))
    .slice(0, 5);
  const milestones = (Array.isArray(raw?.milestones) ? raw.milestones : [])
    .filter((m) => DAY.test(String(m?.by ?? "")) && String(m?.label ?? "").trim())
    .map((m) => ({ by: String(m.by), label: String(m.label).trim().slice(0, 120), ...(Number.isFinite(num(m.value, NaN)) ? { value: num(m.value) } : {}) }))
    .sort((a, z) => a.by.localeCompare(z.by))
    .slice(0, 6);
  return {
    goalId: goal.id,
    goalTitle: goal.title,
    outcome: { label: String(o.label || goal.title).slice(0, 80), unit: String(o.unit ?? "").slice(0, 16), target, by, baseline: num(o.baseline) },
    milestones,
    indicators,
    strategy: String(raw?.strategy ?? "").trim().slice(0, 1500),
    model,
    createdAt: new Date().toISOString(),
  };
}

export function savePlan(p: GoalPlan) {
  writeJSON(planFile(p.goalId), p);
}

const MENTOR = `You are Lind's mentor: an operator who has built and scaled businesses, and who thinks the way Alex Hormozi and Jeff Bezos teach — work backwards from the goal; find the one constraint; volume beats talent (more outreach, more offers, more reps); make offers so good people feel stupid saying no; one-way-door decisions slowly, two-way-door decisions fast; measure inputs you control, not just outcomes. You are NOT them and never quote them or put words in their mouths; your lines are your own. Blunt, specific, numbers-first, zero fluff. Lind is a first-year CS student in Pristina, Kosovo: he runs @building.ai on TikTok (200k followers, ~400M views, tech/AI), an AI agency, and the 383 news site, and he's building toward passive income.`;

const PLAN_SYSTEM = `${MENTOR}
Turn one of Lind's goals into a plan he can execute and measure.
Return JSON: {"outcome": {"label": string, "unit": string, "target": number, "by": "YYYY-MM-DD", "baseline": number}, "milestones": [{"by": "YYYY-MM-DD", "label": string, "value": number|null}], "indicators": [{"key": string, "label": string, "unit": string, "weekly": number}], "strategy": string}
- outcome: the single number the goal ends at (e.g. monthly revenue in EUR → target 10000, unit "€/month"). by = the goal's due date, or a realistic one if none. baseline = where he is now if the context says, else 0.
- milestones: 3–6 dated checkpoints working BACKWARDS from the outcome to the next 30 days; each one a number or an unmistakable event ("first paying client", "€2k month"). The first lands within 30 days.
- indicators: 2–5 leading indicators he controls and can count every week (e.g. "cold DMs sent", "sales calls booked", "offers pitched", "short videos posted", "hours on the product"). weekly = a number that is demanding but doable alongside university. key = short snake_case.
- strategy: 4–8 short lines in plain text: the path (which engine gets him there — given his audience and skills), the current constraint, what he must stop doing, the one-way doors to think hard about. Concrete to Lind; no generic advice.`;

export async function buildPlan(goal: Goal, today: string, note = "", useSol = false): Promise<GoalPlan> {
  const notes = await recallMemory(`${goal.title} ${goal.next} ${goal.why}`, 4).catch(() => []);
  const input = [
    `Today: ${today}.`,
    `Goal: ${goal.title}${goal.due ? ` (due ${goal.due})` : ""}${goal.why ? `\nWhy: ${goal.why}` : ""}${goal.next ? `\nHis next step: ${goal.next}` : ""}`,
    ...(note ? [`What Lind adds: ${note}`] : []),
    `What the Buddy knows about him:\n${readProfile().text.slice(0, 1200) || "(nothing yet)"}`,
    ...(notes.length ? [`From his own notes:\n${recallText(notes)}`] : []),
  ].join("\n\n");
  let model = "groq";
  let out: Partial<GoalPlan> | null = null;
  if (useSol && solEnabled()) {
    out = await solJSON<GoalPlan>(PLAN_SYSTEM, input, 5 * 60_000).catch(() => null);
    model = solLabel();
  }
  if (!out?.outcome) {
    out = await groqJSON<GoalPlan>(PLAN_SYSTEM, input, 0.3, { maxTokens: 1800, timeoutMs: 60_000 });
    model = "groq";
  }
  const plan = cleanPlan(goal, out, model, today);
  if (!plan) throw new Error("The mentor couldn't build a plan — try again.");
  savePlan(plan);
  return plan;
}

// ---- the numbers ------------------------------------------------------------------------------

export function readLog(): MetricEntry[] {
  const l = readJSON<MetricEntry[]>(logFile());
  return Array.isArray(l) ? l.filter((e) => e?.goalId && e?.key && Number.isFinite(e?.value)) : [];
}

// Indicators add up (+3 DMs); the outcome is a level (revenue this month is now 1,200), so the newest wins.
export function logMetric(goalId: string, key: string, value: number, day: string): MetricEntry | null {
  if (!goalId || !key || !Number.isFinite(value) || !DAY.test(day)) return null;
  const e: MetricEntry = { goalId, key: key === OUTCOME ? OUTCOME : keyOf(key), value, day, at: new Date().toISOString() };
  writeJSON(logFile(), [...readLog(), e].slice(-5000));
  return e;
}

// Monday-first week containing `day`.
export function weekOf(day: string): string[] {
  const back = (new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7;
  return Array.from({ length: 7 }, (_, i) => addDays(day, i - back));
}

export type Scorecard = {
  plan: GoalPlan;
  current: number; // latest outcome logged (or the baseline)
  currentAt?: string;
  expected: number; // where a straight line from baseline to target says he should be today
  nextMilestone?: Milestone;
  week: (Indicator & { done: number })[];
  unlogged: string[]; // indicators with nothing logged this week
};

export function scorecard(plan: GoalPlan, today: string, log = readLog()): Scorecard {
  const mine = log.filter((e) => e.goalId === plan.goalId);
  const last = mine.filter((e) => e.key === OUTCOME).sort((a, z) => a.at.localeCompare(z.at)).pop();
  const start = plan.createdAt.slice(0, 10);
  const span = Math.max(1, Date.parse(`${plan.outcome.by}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`));
  const gone = Math.min(1, Math.max(0, (Date.parse(`${today}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) / span));
  const week = new Set(weekOf(today));
  const rows = plan.indicators.map((i) => ({ ...i, done: mine.filter((e) => e.key === i.key && week.has(e.day)).reduce((s, e) => s + e.value, 0) }));
  return {
    plan,
    current: last?.value ?? plan.outcome.baseline,
    currentAt: last?.day,
    expected: Math.round(plan.outcome.baseline + (plan.outcome.target - plan.outcome.baseline) * gone),
    nextMilestone: plan.milestones.find((m) => m.by >= today),
    week: rows,
    unlogged: rows.filter((r) => r.done === 0).map((r) => r.label),
  };
}

const scoreText = (s: Scorecard, today: string) => {
  const p = s.plan;
  const share = weekOf(today).indexOf(today) + 1;
  return [
    `Goal ${p.goalId}: ${p.goalTitle}`,
    `Outcome: ${p.outcome.label} — now ${s.current}${p.outcome.unit ? ` ${p.outcome.unit}` : ""}${s.currentAt ? ` (logged ${s.currentAt})` : " (never logged)"}, target ${p.outcome.target} by ${p.outcome.by}; a straight line says ${s.expected} by today.`,
    s.nextMilestone ? `Next milestone: ${s.nextMilestone.label}${s.nextMilestone.value !== undefined ? ` (${s.nextMilestone.value})` : ""} by ${s.nextMilestone.by}.` : "No milestone left before the deadline.",
    `This week (day ${share} of 7): ${s.week.map((w) => `${w.label} ${w.done}/${w.weekly}${w.unit ? ` ${w.unit}` : ""}`).join("; ") || "no indicators"}.`,
    ...(s.unlogged.length ? [`Nothing logged this week for: ${s.unlogged.join(", ")}.`] : []),
    ...(p.strategy ? [`The plan's strategy:\n${p.strategy}`] : []),
  ].join("\n");
};

// ---- the day's orders -------------------------------------------------------------------------

export function readMentorDay(day: string): MentorDay | null {
  const d = readJSON<MentorDay>(dayFile(day));
  return d?.day ? { ...d, orders: Array.isArray(d.orders) ? d.orders : [] } : null;
}

const DAY_SYSTEM = `${MENTOR}
Every morning you give Lind today's orders for his goals.
Return JSON: {"note": string, "orders": [{"goalId": string, "title": string, "how": string, "minutes": number, "indicator": string|null}]}
- 1 to 3 orders in total, across his goals — the moves that push the numbers furthest today. Prefer the goal furthest behind its line and the indicators furthest behind this week. Never more than he can do next to university.
- title: an imperative a stranger could execute, with a number in it ("Send 20 cold DMs to Kosovo restaurants offering an AI booking bot"), ≤ 90 chars. Never vague ("work on business").
- how: 2–5 short lines on exactly how: where, to whom, the script or structure, what "done" looks like.
- minutes: 15–150, honest.
- indicator: the key of the indicator this order moves, or null. goalId: from the list; never invent one.
- If yesterday's orders weren't done, today's first order is the smallest version of the one he dodged — name that.
- note: 60–120 words, second person, mentor voice: where he stands against the line (use the numbers given exactly — never compute new ones), the constraint, why these orders. If indicators went unlogged, tell him to log them tonight. No quotes, no emojis, no sign-off.`;

export async function writeMentorDay(day: string, opts: { useSol?: boolean } = {}): Promise<MentorDay> {
  const goals = readGoals().filter((g) => !g.done);
  const plans = goals.map((g) => readPlanFor(g.id)).filter((p): p is GoalPlan => !!p);
  if (!plans.length) throw new Error("No goal has a plan yet — build one on Goals first.");
  const log = readLog();
  const y = addDays(day, -1);
  const yesterday = readMentorDay(y);
  const todos = new Map(listTodos().map((t) => [t.id, t]));
  const minutes = new Map(goalProgress().map((g) => [g.goal.id, g]));
  const notes = await recallMemory(plans.map((p) => p.goalTitle).join(" "), 3).catch(() => []);
  const input = [
    `Today: ${day}.`,
    ...plans.map((p) => {
      const g = minutes.get(p.goalId);
      return `${scoreText(scorecard(p, day, log), day)}${g ? `\nFocus time this week: ${g.weekMin} min (streak ${g.streak} days).` : ""}`;
    }),
    yesterday?.orders.length
      ? `Yesterday's orders:\n${yesterday.orders.map((o) => `- ${o.title}: ${o.todoId && todos.get(o.todoId)?.done ? "DONE" : "NOT DONE"}`).join("\n")}`
      : "No orders yesterday.",
    `What the Buddy knows about him:\n${readProfile().text.slice(0, 1200) || "(nothing yet)"}`,
    ...(notes.length ? [`From his own notes:\n${recallText(notes)}`] : []),
  ].join("\n\n");
  let model = "groq";
  let out: Partial<{ note: string; orders: Order[] }> | null = null;
  if (opts.useSol && solEnabled()) {
    out = await solJSON<{ note: string; orders: Order[] }>(DAY_SYSTEM, input, 5 * 60_000).catch(() => null);
    model = solLabel();
  }
  if (!out?.orders?.length) {
    out = await groqJSON<{ note: string; orders: Order[] }>(DAY_SYSTEM, input, 0.4, { maxTokens: 1500, timeoutMs: 60_000 });
    model = "groq";
  }
  const ids = new Set(plans.map((p) => p.goalId));
  const orders = cleanOrders(out?.orders, ids, plans);
  if (!orders.length) throw new Error("The mentor gave no orders — try again.");
  const result: MentorDay = { day, note: String(out?.note ?? "").trim().slice(0, 1200), orders: placeOrders(day, orders), model, createdAt: new Date().toISOString() };
  writeJSON(dayFile(day), result);
  return result;
}

export function cleanOrders(raw: unknown, goalIds: Set<string>, plans: GoalPlan[]): Order[] {
  const keys = new Map(plans.map((p) => [p.goalId, new Set(p.indicators.map((i) => i.key))]));
  return (Array.isArray(raw) ? raw : [])
    .filter((o) => o && goalIds.has(String(o.goalId)) && String(o.title ?? "").trim())
    .slice(0, 3)
    .map((o) => {
      const ind = o.indicator ? keyOf(String(o.indicator)) : undefined;
      return {
        goalId: String(o.goalId),
        title: String(o.title).trim().slice(0, 120),
        how: String(o.how ?? "").trim().slice(0, 800),
        minutes: Math.min(150, Math.max(15, Math.round(num(o.minutes, 45) / 5) * 5)),
        ...(ind && keys.get(String(o.goalId))?.has(ind) ? { indicator: ind } : {}),
      };
    });
}

// Each order becomes a top-priority task for today, tied to its goal, so the planner books it first.
// An order already on today's list (same goal, same title) isn't added twice.
function placeOrders(day: string, orders: Order[]): Order[] {
  const existing = listTodos().filter((t) => t.day === day && t.source === "mentor");
  return orders.map((o) => {
    const same = existing.find((t) => t.goalId === o.goalId && t.title.toLowerCase() === o.title.toLowerCase());
    const t = same ?? addTodo({ title: o.title, notes: o.how, goalId: o.goalId, priority: 3, estimateMin: o.minutes, day, source: "mentor" });
    return { ...o, todoId: t.id };
  });
}
