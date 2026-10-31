import fs from "node:fs";
import path from "node:path";
import { agenda, calendarConnected, type CalEvent, type PlanBlock } from "./calendar";
import { activeGoals, type Goal } from "./goals";
import { goalProgress } from "./coach";
import { groqJSON } from "./groq";
import { solJSON, solLabel } from "./sol";
import { blockId } from "./plan-store";
import { openTasks, ticktickConnected } from "./ticktick";
import { completeInTickTick } from "./todo-actions";
import { gmailLink, readMail } from "./gmail";
import { readActions } from "./mail-actions";
import { importEmailTasks, importTickTick, listTodos, remainingMin, todosFor, type Todo } from "./todos";

// "Plan my day": fixed calendar events + open dashboard tasks + the vault's Daily Agenda priorities +
// whatever Lind says → time blocks in the free gaps. Nothing is written until he applies the plan
// (Google Calendar blocks + a plan note in the Obsidian vault).

const vaultDir = () => process.env.MEMORY_VAULT_DIR ?? "/home/ubuntu/.hermes/syncthing-sync/lind-brain";
const DAY_START = () => process.env.PLAN_DAY_START ?? "08:00";
const DAY_END = () => process.env.PLAN_DAY_END ?? "23:00";

export type Today = {
  tz: string;
  today: string;
  events: CalEvent[]; // today only
  tomorrow: CalEvent[];
  todos: ReturnType<typeof todosFor>; // dashboard tasks (TickTick's open ones imported into them)
  priorities: string[];
  goals: Goal[];
  errors: string[];
};

const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const toHHMM = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const clock = (tz: string, d: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);

// "Top Priorities" from the nightly Daily Agenda note, as plain one-liners.
function vaultPriorities(): string[] {
  try {
    const md = fs.readFileSync(path.join(vaultDir(), "100 - Me", "Daily Agenda.md"), "utf8");
    const section = md.split(/^## /m).find((s) => /^Top Priorities/i.test(s)) ?? "";
    return section
      .split("\n")
      .filter((l) => /^\s*(\d+\.|[-*])\s+/.test(l))
      .map((l) => l.replace(/^\s*(\d+\.|[-*])\s+/, "").replace(/\*\*/g, "").replace(/\[\[([^\]|]+\|)?([^\]]+)\]\]/g, "$2").trim())
      .map((l) => (l.length > 160 ? `${l.slice(0, 157)}…` : l))
      .slice(0, 5);
  } catch {
    return [];
  }
}

export async function today(): Promise<Today> {
  const errors: string[] = [];
  let tz = "Europe/Belgrade";
  let day = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
  let events: CalEvent[] = [];
  let tomorrow: CalEvent[] = [];
  if (calendarConnected()) {
    try {
      const a = await agenda(2);
      tz = a.tz;
      day = a.today;
      const dayOf = (e: CalEvent) => (e.allDay ? e.start : new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(e.start)));
      events = a.events.filter((e) => dayOf(e) === day);
      tomorrow = a.events.filter((e) => dayOf(e) > day);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }
  if (ticktickConnected()) {
    try {
      const tt = await openTasks(tz, day);
      importTickTick([...tt.overdue, ...tt.today, ...tt.inbox], day, tz);
      // Tasks ticked here whose TickTick completion failed earlier: try again.
      for (const x of listTodos().filter((x) => x.done && x.ticktick?.pending).slice(0, 5)) await completeInTickTick(x);
    } catch (err) {
      errors.push(`TickTick: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  // Emails that ask Lind to do something become tasks (read by the runner, added here once each).
  try {
    const mails = new Map(readMail().messages.map((m) => [m.id, m]));
    importEmailTasks(
      Object.values(readActions()).map((a) => ({ ...a, link: mails.get(a.id) ? gmailLink(mails.get(a.id)!) : undefined, from: mails.get(a.id)?.from })),
      day,
    );
  } catch (err) {
    errors.push(`Email tasks: ${err instanceof Error ? err.message : String(err)}`);
  }
  return { tz, today: day, events, tomorrow, todos: todosFor(day), priorities: vaultPriorities(), goals: activeGoals(), errors };
}

// Gaps between now (or the start of the day) and the end of the day, around timed events.
export function freeSlots(t: Today, now = new Date(), extraBusy: { s: number; e: number }[] = []): { start: number; end: number }[] {
  const nowMin = Math.ceil(toMin(clock(t.tz, now)) / 15) * 15;
  let from = Math.max(nowMin, toMin(DAY_START()));
  const end = toMin(DAY_END());
  // A previous plan is a mirror to replace, not a fixed appointment: its tagged blocks must not eat
  // the free slots a re-plan is supposed to use.
  const busy = t.events
    .filter((e) => !e.allDay && !e.planned)
    .map((e) => ({ s: toMin(clock(t.tz, new Date(e.start))), e: Math.min(toMin(clock(t.tz, new Date(e.end))) || 24 * 60, 24 * 60) }))
    .concat(extraBusy)
    .sort((a, b) => a.s - b.s);
  const slots: { start: number; end: number }[] = [];
  for (const b of busy) {
    if (b.s > from) slots.push({ start: from, end: Math.min(b.s, end) });
    from = Math.max(from, b.e);
  }
  if (from < end) slots.push({ start: from, end });
  return slots.filter((s) => s.end - s.start >= 15);
}

// opts.keep: blocks that stay as they are (done or running) — their time isn't free and they come back
// unchanged, so a re-plan never touches what's already happened. opts.useSol: plan with gpt-6.1-sol
// (Autopilot) instead of Groq; Groq is the fallback.
export async function planDay(note: string, opts: { useSol?: boolean; keep?: PlanBlock[] } = {}): Promise<{ blocks: PlanBlock[]; summary: string; day: string; tz: string; model: string }> {
  const t = await today();
  const keep = opts.keep ?? [];
  const slots = freeSlots(t, new Date(), keep.map((k) => ({ s: toMin(k.start), e: toMin(k.end) })));
  if (!slots.length) return { blocks: keep, summary: "No free time left today.", day: t.today, tz: t.tz, model: "—" };
  const taskList: Todo[] = [...t.todos.overdue, ...t.todos.today].slice(0, 30);
  const pri = { 3: "high", 2: "medium", 1: "low", 0: "none" } as const;
  const dueOf = (x: Todo) => (!x.due ? "no deadline" : x.due.slice(0, 10) < t.today ? "overdue" : x.due.includes("T") ? `due ${x.due.slice(11)}` : x.due.slice(0, 10) === t.today ? "due today" : `due ${x.due}`);
  // How far behind each goal is this week, so the plan gives time where it's missing.
  const progress = new Map(goalProgress().map((p) => [p.goal.id, p]));
  const weekly = (id: string) => {
    const p = progress.get(id);
    if (!p) return "—";
    return `${p.weekMin} of ${p.targetMin} min done, ${Math.max(0, p.targetMin - p.weekMin)} min still to find this week`;
  };
  const context = [
    `Today: ${t.today} (${t.tz}). Now: ${clock(t.tz, new Date())}.`,
    `Free slots (only schedule inside these): ${slots.map((s) => `${toHHMM(s.start)}-${toHHMM(s.end)}`).join(", ")}`,
    `Fixed events: ${t.events.filter((e) => !e.allDay && !e.planned).map((e) => `${clock(t.tz, new Date(e.start))}-${clock(t.tz, new Date(e.end))} ${e.title}`).join("; ") || "none"}`,
    `All-day: ${t.events.filter((e) => e.allDay).map((e) => e.title).join("; ") || "none"}`,
    `Open tasks (id | priority | deadline | minutes of work left | goal | title):\n${taskList.map((x) => `${x.id} | ${pri[x.priority]} | ${dueOf(x)} | ${remainingMin(x)} | ${x.goalId ?? "—"} | ${x.title}${x.subtasks.length ? ` (steps left: ${x.subtasks.filter((st) => !st.done).map((st) => st.title).join("; ")})` : ""}`).join("\n") || "none"}`,
    `Standing priorities from the vault: ${t.priorities.join(" / ") || "none"}`,
    `Active goals from the vault (id | horizon | next action | why | due | this week so far):\n${t.goals.map((g) => `${g.id} | ${g.horizon} | ${g.title} → ${g.next || "choose the next action"} | ${g.why || "—"} | ${g.due ?? "no date"} | ${weekly(g.id)}`).join("\n") || "none"}`,
    ...(keep.length ? [`Already on the plan and staying (don't schedule over these): ${keep.map((k) => `${k.start}-${k.end} ${k.title}`).join("; ")}`] : []),
    `What Lind says about today: ${note || "(nothing — plan from the list)"}`,
  ].join("\n\n");
  type Out = { blocks: { start: string; end: string; title: string; kind: string; taskId?: string | null; goalId?: string | null }[]; summary: string };
  const SYSTEM = `You plan Lind's day into time blocks. He's a CS student building AI products and running a news site.
Return JSON: {"summary": string, "blocks": [{"start": "HH:MM", "end": "HH:MM", "title": string, "kind": "task"|"focus"|"break"|"routine", "taskId": string|null, "goalId": string|null}]}.
- Only inside the free slots, never overlapping each other. Blocks in 15-minute steps.
- Goals first: each active goal's next action gets a "focus" block long enough to make real progress (45–120 min) before generic tasks, unless Lind's note says otherwise. Goals furthest behind their weekly target get the earliest and longest block; the hardest goal block goes in the morning.
- Then every task with a deadline today must land BEFORE its deadline; then overdue and high-priority tasks, sized to their minutes of work left; then the standing priorities as deep "focus" blocks (60–120 min).
- The point is finishing the day's list: if everything can't fit, schedule the most important and say in the summary which tasks won't fit.
- Group small tasks into one block ("Admin: x, y, z"). A 10–15 min break after ~2h of work, and a meal around 13:00 and 19:30 if free.
- taskId: the id from the list when a block is for one task, else null. goalId: the id of the active goal when the block serves it, else null. Never invent ids.
- Leave some slack; do not fill every minute. Titles short, in Lind's language.
- summary: one sentence on the shape of the day.`;
  let model = "groq";
  let out: Partial<Out> | null = null;
  if (opts.useSol) {
    out = await solJSON<Out>(SYSTEM, context, 8 * 60_000).catch(() => null);
    model = solLabel();
  }
  if (!out?.blocks) {
    out = await groqJSON<Out>(SYSTEM, context, 0.3);
    model = "groq";
  }
  const ids = new Map(taskList.map((x) => [x.id, x]));
  const kinds = ["task", "focus", "break", "routine"];
  const blocks: PlanBlock[] = [];
  const raw = (Array.isArray(out?.blocks) ? out.blocks : []).slice().sort((a, z) => String(a?.start ?? "").padStart(5, "0").localeCompare(String(z?.start ?? "").padStart(5, "0")));
  for (const b of raw) {
    if (!/^\d{1,2}:\d{2}$/.test(b?.start ?? "") || !/^\d{1,2}:\d{2}$/.test(b?.end ?? "") || !b?.title) continue;
    let s = Math.round(toMin(b.start.padStart(5, "0")) / 5) * 5;
    let e = Math.round(toMin(b.end.padStart(5, "0")) / 5) * 5;
    // Clamp into the slot it starts in; drop it if it lands nowhere or overlaps an earlier block.
    const slot = slots.find((x) => s >= x.start && s < x.end);
    if (!slot) continue;
    e = Math.min(e, slot.end);
    s = Math.max(s, blocks.length ? toMin(blocks[blocks.length - 1].end) : 0);
    if (e - s < 10) continue;
    const task = b.taskId ? ids.get(b.taskId) : undefined;
    const goal = b.goalId ? t.goals.find((g) => g.id === b.goalId) : undefined;
    const title = String(b.title).slice(0, 100);
    blocks.push({
      blockId: blockId(t.today, toHHMM(s), title),
      start: toHHMM(s),
      end: toHHMM(e),
      title,
      kind: (kinds.includes(b.kind) ? b.kind : "task") as PlanBlock["kind"],
      taskId: task?.id,
      goalId: goal?.id,
    });
  }
  return {
    blocks: [...keep, ...blocks].sort((a, z) => a.start.localeCompare(z.start)),
    summary: out ? (out.summary ?? "") : "Groq is out of quota right now — try again in a few minutes.",
    day: t.today,
    tz: t.tz,
    model,
  };
}

// The plan as a note in the vault (100 - Me/plans/YYYY-MM-DD.md), so it syncs to Obsidian and
// Memory can find it later. Returns false when the folder isn't writable yet.
export function writePlanNote(day: string, blocks: PlanBlock[], summary: string, note: string): boolean {
  const dir = path.join(vaultDir(), "100 - Me", "plans");
  const md = [
    "---",
    "tags: [me, plan]",
    `date: ${day}`,
    "source: agents.383ks.com",
    "---",
    "",
    `# Plan — ${day}`,
    "",
    ...(summary ? [`> ${summary}`, ""] : []),
    ...(note ? [`**What I said:** ${note}`, ""] : []),
    ...blocks.map((b) => `- [ ] ${b.start}–${b.end} ${b.title}${b.kind === "break" ? " _(break)_" : ""} #${b.blockId}${b.goalId ? ` #${b.goalId}` : ""}`),
    "",
  ].join("\n");
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${day}.md`), md);
    return true;
  } catch {
    return false;
  }
}
