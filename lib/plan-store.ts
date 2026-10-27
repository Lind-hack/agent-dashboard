import fs from "node:fs";
import path from "node:path";
import { addDays, type PlanBlock } from "./calendar";
import { DATA_DIR } from "./config";

// The authoritative record of what Lind planned and what actually happened, one JSON file per day.
// The vault note and the Google Calendar events are mirrors: replanning rewrites those, so ticks and
// statuses must never live there. `data/plans/<day>.json` is the source of truth.

export type BlockStatus = "planned" | "running" | "done" | "blocked" | "moved" | "dropped";

export type StoredBlock = {
  id: string;
  start: string;
  end: string;
  title: string;
  kind: PlanBlock["kind"];
  goalId?: string;
  taskId?: string;
  projectId?: string;
  status: BlockStatus;
  movedTo?: string;
  updatedAt?: string;
};

export type DayPlan = {
  day: string;
  tz?: string;
  summary?: string;
  note?: string;
  createdAt: string;
  updatedAt: string;
  blocks: StoredBlock[];
};

export type PlanStats = {
  weekDays: number; // days this week with a plan
  weekTotal: number; // blocks that were scheduled this week
  weekDone: number;
  percent: number; // ticked / scheduled for the week
  streak: number; // consecutive days with at least one tick
  todayDone: number;
  todayTotal: number;
};

const plansDir = () => path.join(DATA_DIR, "plans");
const dayFile = (day: string) => path.join(plansDir(), `${day}.json`);
const active = (b: StoredBlock) => b.status !== "dropped" && b.status !== "moved";

export function blockId(day: string, start: string, title: string): string {
  const slug =
    title
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "block";
  return `${day}-${start.replace(":", "")}-${slug}`;
}

function clean(raw: Partial<DayPlan> | null): DayPlan | null {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.blocks)) return null;
  const statuses: BlockStatus[] = ["planned", "running", "done", "blocked", "moved", "dropped"];
  return {
    day: String(raw.day ?? ""),
    tz: raw.tz,
    summary: raw.summary,
    note: raw.note,
    createdAt: raw.createdAt ?? new Date().toISOString(),
    updatedAt: raw.updatedAt ?? new Date().toISOString(),
    blocks: raw.blocks
      .filter((b) => b && /^\d{2}:\d{2}$/.test(b.start ?? "") && /^\d{2}:\d{2}$/.test(b.end ?? "") && b.title)
      .map((b) => ({
        id: String(b.id ?? blockId(raw.day ?? "", b.start!, b.title!)),
        start: b.start!,
        end: b.end!,
        title: String(b.title).slice(0, 200),
        kind: (["task", "focus", "break", "routine"] as const).includes(b.kind as PlanBlock["kind"]) ? (b.kind as PlanBlock["kind"]) : "task",
        goalId: b.goalId || undefined,
        taskId: b.taskId || undefined,
        projectId: b.projectId || undefined,
        status: statuses.includes(b.status as BlockStatus) ? (b.status as BlockStatus) : "planned",
        movedTo: b.movedTo || undefined,
        updatedAt: b.updatedAt || undefined,
      })),
  };
}

export function readPlan(day: string): DayPlan | null {
  try {
    return clean(JSON.parse(fs.readFileSync(dayFile(day), "utf8")));
  } catch {
    return null;
  }
}

function writePlan(plan: DayPlan) {
  plan.updatedAt = new Date().toISOString();
  fs.mkdirSync(plansDir(), { recursive: true });
  const file = dayFile(plan.day);
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(plan, null, 2));
  fs.renameSync(`${file}.tmp`, file);
}

// Replanning: match by stable id so a ticked block stays ticked. Blocks that vanished from the new
// plan are kept as "dropped" history (a done block stays done, so the week's numbers stay honest).
export function savePlan(day: string, blocks: PlanBlock[], meta: { tz?: string; summary?: string; note?: string } = {}): DayPlan {
  const prev = readPlan(day);
  const before = new Map((prev?.blocks ?? []).map((b) => [b.id, b]));
  const seen = new Set<string>();
  const next: StoredBlock[] = [];
  for (const b of blocks) {
    let id = b.blockId?.trim() || blockId(day, b.start, b.title);
    const base = id;
    let n = 2;
    while (seen.has(id)) id = `${base}-${n++}`;
    seen.add(id);
    const old = before.get(id);
    next.push({
      id,
      start: b.start,
      end: b.end,
      title: b.title,
      kind: b.kind,
      goalId: b.goalId || undefined,
      taskId: b.taskId || undefined,
      projectId: b.projectId || undefined,
      // Done / blocked / running survive a replan. A moved block that reappears is deliberately re-added.
      status: old && old.status !== "dropped" && old.status !== "moved" ? old.status : "planned",
      movedTo: old?.movedTo,
      updatedAt: old?.updatedAt,
    });
  }
  for (const old of prev?.blocks ?? []) {
    if (seen.has(old.id) || old.status === "dropped") continue;
    next.push({ ...old, status: old.status === "done" ? "done" : "dropped" });
  }
  next.sort((a, z) => a.start.localeCompare(z.start));
  const plan: DayPlan = {
    day,
    tz: meta.tz ?? prev?.tz,
    summary: meta.summary ?? prev?.summary,
    note: meta.note ?? prev?.note,
    createdAt: prev?.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    blocks: next,
  };
  writePlan(plan);
  return plan;
}

// Save the user's words independently of generated time blocks. Never replan or reset progress.
export function savePlanNote(day: string, note: string): DayPlan {
  const at = new Date().toISOString();
  const plan = readPlan(day) ?? { day, createdAt: at, updatedAt: at, blocks: [] };
  plan.note = note;
  writePlan(plan);
  return plan;
}

export type BlockAction = "start" | "done" | "blocked" | "planned" | "move";

// Start / Done / Blocked / Move. Move carries the block to tomorrow at the same time and leaves a
// tombstone in today's file, so today's consistency numbers aren't inflated by it.
export function setBlockStatus(day: string, id: string, action: BlockAction): DayPlan | null {
  const plan = readPlan(day);
  const block = plan?.blocks.find((b) => b.id === id);
  if (!plan || !block) return null;
  const at = new Date().toISOString();
  if (action === "move") {
    const tomorrow = addDays(day, 1);
    const next = readPlan(tomorrow) ?? {
      day: tomorrow,
      tz: plan.tz,
      summary: `Moved from ${day}`,
      createdAt: at,
      updatedAt: at,
      blocks: [],
    };
    const moved: StoredBlock = {
      ...block,
      id: blockId(tomorrow, block.start, block.title),
      status: "planned",
      movedTo: undefined,
      updatedAt: at,
    };
    // A same-title block already there keeps both, with a fresh id.
    const base = moved.id;
    let n = 2;
    while (next.blocks.some((b) => b.id === moved.id)) moved.id = `${base}-${n++}`;
    next.blocks = [...next.blocks, moved].sort((a, z) => a.start.localeCompare(z.start));
    writePlan(next);
    block.status = "moved";
    block.movedTo = tomorrow;
  } else {
    block.status = action === "start" ? "running" : action;
  }
  block.updatedAt = at;
  writePlan(plan);
  return plan;
}

export function activeBlocks(plan: DayPlan | null): StoredBlock[] {
  return (plan?.blocks ?? []).filter(active);
}

function daysOfWeek(day: string): string[] {
  const d = new Date(`${day}T12:00:00Z`);
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => addDays(monday.toISOString().slice(0, 10), i));
}

export function planStats(day: string): PlanStats {
  const week = daysOfWeek(day);
  let weekDays = 0;
  let weekTotal = 0;
  let weekDone = 0;
  for (const d of week) {
    const plan = readPlan(d);
    const blocks = activeBlocks(plan);
    if (blocks.length) weekDays++;
    weekTotal += blocks.length;
    weekDone += blocks.filter((b) => b.status === "done").length;
  }
  const today = readPlan(day);
  const todayBlocks = activeBlocks(today);
  // A day counts toward the streak once anything on it was ticked. Today with nothing ticked yet is
  // skipped rather than breaking the streak — the day isn't over.
  let streak = 0;
  for (let i = 0; i < 366; i++) {
    const d = i === 0 ? day : addDays(day, -i);
    const blocks = activeBlocks(readPlan(d));
    const ticked = blocks.some((b) => b.status === "done");
    if (ticked) streak++;
    else if (i > 0) break;
  }
  return {
    weekDays,
    weekTotal,
    weekDone,
    percent: weekTotal ? Math.round((weekDone / weekTotal) * 100) : 0,
    streak,
    todayDone: todayBlocks.filter((b) => b.status === "done").length,
    todayTotal: todayBlocks.length,
  };
}
