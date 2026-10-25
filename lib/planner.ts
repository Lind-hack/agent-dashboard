import fs from "node:fs";
import path from "node:path";
import { agenda, calendarConnected, type CalEvent, type PlanBlock } from "./calendar";
import { groqJSON } from "./groq";
import { openTasks, ticktickConnected, type Task } from "./ticktick";

// "Plan my day": fixed calendar events + open TickTick tasks + the vault's Daily Agenda priorities +
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
  tasks: { overdue: Task[]; today: Task[]; inbox: Task[] } | null;
  priorities: string[];
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
  let tasks: Today["tasks"] = null;
  if (ticktickConnected()) {
    try {
      tasks = await openTasks(tz, day);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }
  return { tz, today: day, events, tomorrow, tasks, priorities: vaultPriorities(), errors };
}

// Gaps between now (or the start of the day) and the end of the day, around timed events.
export function freeSlots(t: Today, now = new Date()): { start: number; end: number }[] {
  const nowMin = Math.ceil(toMin(clock(t.tz, now)) / 15) * 15;
  let from = Math.max(nowMin, toMin(DAY_START()));
  const end = toMin(DAY_END());
  const busy = t.events
    .filter((e) => !e.allDay)
    .map((e) => ({ s: toMin(clock(t.tz, new Date(e.start))), e: Math.min(toMin(clock(t.tz, new Date(e.end))) || 24 * 60, 24 * 60) }))
    .sort((a, b) => a.s - b.s);
  const slots: { start: number; end: number }[] = [];
  for (const b of busy) {
    if (b.s > from) slots.push({ start: from, end: Math.min(b.s, end) });
    from = Math.max(from, b.e);
  }
  if (from < end) slots.push({ start: from, end });
  return slots.filter((s) => s.end - s.start >= 15);
}

export async function planDay(note: string): Promise<{ blocks: PlanBlock[]; summary: string; day: string; tz: string }> {
  const t = await today();
  const slots = freeSlots(t);
  if (!slots.length) return { blocks: [], summary: "No free time left today.", day: t.today, tz: t.tz };
  const taskList = [...(t.tasks?.overdue ?? []), ...(t.tasks?.today ?? []), ...(t.tasks?.inbox ?? [])].slice(0, 30);
  const pri = { 5: "high", 3: "medium", 1: "low", 0: "none" } as const;
  const context = [
    `Today: ${t.today} (${t.tz}). Now: ${clock(t.tz, new Date())}.`,
    `Free slots (only schedule inside these): ${slots.map((s) => `${toHHMM(s.start)}-${toHHMM(s.end)}`).join(", ")}`,
    `Fixed events: ${t.events.filter((e) => !e.allDay).map((e) => `${clock(t.tz, new Date(e.start))}-${clock(t.tz, new Date(e.end))} ${e.title}`).join("; ") || "none"}`,
    `All-day: ${t.events.filter((e) => e.allDay).map((e) => e.title).join("; ") || "none"}`,
    `Open tasks (id | priority | due | title):\n${taskList.map((x) => `${x.id} | ${pri[x.priority]} | ${x.due ? (x.due < t.today ? "overdue" : "today") : "no date"} | ${x.title}`).join("\n") || "none"}`,
    `Standing priorities from the vault: ${t.priorities.join(" / ") || "none"}`,
    `What Lind says about today: ${note || "(nothing — plan from the list)"}`,
  ].join("\n\n");
  const out = await groqJSON<{ blocks: { start: string; end: string; title: string; kind: string; taskId?: string | null }[]; summary: string }>(
    `You plan Lind's day into time blocks. He's a CS student building AI products and running a news site.
Return JSON: {"summary": string, "blocks": [{"start": "HH:MM", "end": "HH:MM", "title": string, "kind": "task"|"focus"|"break"|"routine", "taskId": string|null}]}.
- Only inside the free slots, never overlapping each other. Blocks in 15-minute steps.
- What Lind says wins. Then overdue and high-priority tasks, then the standing priorities as deep "focus" blocks (60–120 min).
- Group small tasks into one block ("Admin: x, y, z"). A 10–15 min break after ~2h of work, and a meal around 13:00 and 19:30 if free.
- taskId: the id from the list when a block is for one task, else null. Never invent ids.
- Leave some slack; do not fill every minute. Titles short, in Lind's language.
- summary: one sentence on the shape of the day.`,
    context,
    0.3,
  );
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
    blocks.push({
      start: toHHMM(s),
      end: toHHMM(e),
      title: String(b.title).slice(0, 100),
      kind: (kinds.includes(b.kind) ? b.kind : "task") as PlanBlock["kind"],
      taskId: task?.id,
      projectId: task?.projectId,
    });
  }
  return {
    blocks,
    summary: out ? (out.summary ?? "") : "Groq is out of quota right now — try again in a few minutes.",
    day: t.today,
    tz: t.tz,
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
    ...blocks.map((b) => `- [ ] ${b.start}–${b.end} ${b.title}${b.kind === "break" ? " _(break)_" : ""}`),
    "",
  ].join("\n");
  try {
    fs.writeFileSync(path.join(dir, `${day}.md`), md);
    return true;
  } catch {
    return false;
  }
}
