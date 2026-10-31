import { addDays, dayString } from "./calendar";
import { coachTz, goalProgress, zonedMs } from "./coach";
import { blockMinutes, readPlan, type DayPlan, type StoredBlock } from "./plan-store";

// Accountability (v5.2, Lind's pick: "Goggins mode"). Every planned block is judged against the clock:
// started on time (within 5 minutes), late, missed (never started), or left unfinished. The day's
// "mirror" lines up what he said he'd do with what he did, block by block; a day is KEPT when nothing
// was missed or left unfinished and at least 80% started on time — kept days make the streak. Two
// weeks of mirrors teach the planner, the Buddy and the morning push his real patterns: when he starts
// late, which kind of work overruns, what gets skipped. Pure reads, so the web app and runner share it.

export const GRACE_MIN = 5;
export type Verdict = "upcoming" | "not-started" | "on-time" | "late" | "missed" | "unfinished";
export type MirrorRow = {
  id: string;
  title: string;
  start: string;
  end: string;
  kind: StoredBlock["kind"];
  goalId?: string;
  verdict: Verdict;
  running: boolean;
  lateMin?: number; // how long after its start it was started
  plannedMin: number;
  actualMin?: number; // done blocks: real start→done
  rescheduledTo?: string; // missed, and put into free time later (the new block's start)
};
export type Mirror = { day: string; rows: MirrorRow[]; due: number; done: number; onTime: number; late: number; missed: number; notStarted: number; unfinished: number; onTimeRate: number; kept: boolean; over: boolean };

const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const MIN = 60_000;

// One block against the clock; null for breaks and for blocks moved or dropped before their time came.
export function judge(b: StoredBlock, day: string, nowMs: number, tz = coachTz(), plan?: DayPlan | null): MirrorRow | null {
  if (b.kind === "break") return null;
  const startMs = zonedMs(day, b.start, tz);
  const endMs = zonedMs(day, b.end, tz);
  const plannedMin = Math.max(0, mins(b.end) - mins(b.start));
  const lateMin = b.startedAt ? Math.max(0, Math.round((Date.parse(b.startedAt) - startMs) / MIN)) : undefined;
  const row = { id: b.id, title: b.title, start: b.start, end: b.end, kind: b.kind, goalId: b.goalId, plannedMin, lateMin, running: b.status === "running" };
  const timely = (lateMin ?? 0) <= GRACE_MIN ? "on-time" : "late";
  if (b.status === "done") return { ...row, verdict: timely, actualMin: blockMinutes(b) };
  if (b.status === "running") return { ...row, verdict: nowMs > endMs + 15 * MIN ? "unfinished" : timely };
  if (b.status === "moved" || b.status === "dropped") {
    // Moved or re-planned away before it was over: not a miss. After its end: it was one.
    if (Date.parse(b.updatedAt ?? "") < endMs) return null;
    const to = b.rescheduledTo ? plan?.blocks.find((x) => x.id === b.rescheduledTo) : undefined;
    return { ...row, verdict: "missed", rescheduledTo: to?.start };
  }
  if (nowMs >= endMs) return { ...row, verdict: b.startedAt ? "unfinished" : "missed" };
  if (nowMs >= startMs + GRACE_MIN * MIN) return { ...row, verdict: b.startedAt ? timely : "not-started" };
  return { ...row, verdict: "upcoming" };
}

export function mirror(day: string, nowMs = Date.now(), tz = coachTz()): Mirror {
  const plan = readPlan(day);
  const rows = (plan?.blocks ?? [])
    .map((b) => judge(b, day, nowMs, tz, plan))
    .filter((r): r is MirrorRow => !!r)
    .sort((a, z) => a.start.localeCompare(z.start));
  const count = (v: Verdict) => rows.filter((r) => r.verdict === v).length;
  const done = rows.filter((r) => (r.verdict === "on-time" || r.verdict === "late") && !r.running).length;
  const started = rows.filter((r) => r.lateMin !== undefined).length;
  const onTime = rows.filter((r) => r.lateMin !== undefined && r.lateMin <= GRACE_MIN).length;
  const due = rows.filter((r) => r.verdict !== "upcoming").length;
  const missed = count("missed");
  const notStarted = count("not-started");
  const unfinished = count("unfinished");
  const over = rows.length > 0 && rows.every((r) => nowMs >= zonedMs(day, r.end, tz));
  return {
    day,
    rows,
    due,
    done,
    onTime,
    late: started - onTime,
    missed,
    notStarted,
    unfinished,
    onTimeRate: started ? Math.round((100 * onTime) / started) : 0,
    kept: due > 0 && missed === 0 && notStarted === 0 && unfinished === 0 && started > 0 && onTime / started >= 0.8,
    over,
  };
}

// Kept days in a row, ending yesterday — plus today once today's last block is behind him and kept.
export function keptStreak(today: string, tz = coachTz(), nowMs = Date.now()): { days: number; todayKept: boolean; todayAlive: boolean } {
  const t = mirror(today, nowMs, tz);
  let days = 0;
  for (let i = 1; i <= 120; i++) {
    const d = addDays(today, -i);
    if (!mirror(d, Number.MAX_SAFE_INTEGER, tz).kept) break;
    days++;
  }
  // Still alive today while nothing has been missed or left unfinished yet.
  const todayAlive = t.missed === 0 && t.unfinished === 0;
  const todayKept = t.over && t.kept;
  return { days: days + (todayKept ? 1 : 0), todayKept, todayAlive };
}

// ---- patterns: what two weeks of mirrors say -------------------------------------------------------

export type Patterns = { days: number; blocks: number; onTimeRate: number; lines: string[] };

const period = (start: string) => (mins(start) < 12 * 60 ? "morning" : mins(start) < 17 * 60 ? "afternoon" : "evening");
const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

export function patterns(today: string, tz = coachTz(), lookback = 14): Patterns {
  const rows: MirrorRow[] = [];
  let days = 0;
  for (let i = 1; i <= lookback; i++) {
    const m = mirror(addDays(today, -i), Number.MAX_SAFE_INTEGER, tz);
    if (!m.rows.length) continue;
    days++;
    rows.push(...m.rows);
  }
  const lines: string[] = [];
  const started = rows.filter((r) => r.lateMin !== undefined);
  for (const p of ["morning", "afternoon", "evening"] as const) {
    const all = rows.filter((r) => period(r.start) === p);
    if (all.length < 3) continue;
    const st = started.filter((r) => period(r.start) === p);
    const missRate = Math.round((100 * all.filter((r) => r.verdict === "missed").length) / all.length);
    const late = Math.round(avg(st.map((r) => r.lateMin!)));
    lines.push(`${p[0].toUpperCase()}${p.slice(1)} blocks: ${missRate}% missed${st.length ? `, started ${late} min late on average` : ""} (${all.length} blocks).`);
  }
  for (const k of ["task", "focus", "routine"] as const) {
    const done = rows.filter((r) => r.kind === k && r.actualMin !== undefined && r.plannedMin >= 15 && r.actualMin > 0);
    if (done.length < 3) continue;
    const ratio = avg(done.map((r) => r.actualMin! / r.plannedMin));
    if (Math.abs(ratio - 1) >= 0.15) lines.push(`${k} blocks really take ${ratio.toFixed(1)}× their planned length (${done.length} done) — size them ${ratio > 1 ? "longer" : "shorter"}.`);
  }
  const titles = new Map<string, { n: number; missed: number }>();
  for (const r of rows) {
    const key = r.title.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, "").split(" ").slice(0, 3).join(" ");
    const v = titles.get(key) ?? { n: 0, missed: 0 };
    v.n++;
    if (r.verdict === "missed") v.missed++;
    titles.set(key, v);
  }
  const skipped = [...titles.entries()].filter(([, v]) => v.n >= 3 && v.missed / v.n >= 0.5).map(([k, v]) => `"${k}" (${v.missed}/${v.n})`);
  if (skipped.length) lines.push(`Usually skipped: ${skipped.slice(0, 4).join(", ")}.`);
  const onTimeRate = started.length ? Math.round((100 * started.filter((r) => r.lateMin! <= GRACE_MIN).length) / started.length) : 0;
  if (started.length) lines.unshift(`Over the last ${days} planned days: ${onTimeRate}% of blocks started on time, ${Math.round((100 * rows.filter((r) => r.verdict === "missed").length) / Math.max(1, rows.length))}% missed.`);
  return { days, blocks: rows.length, onTimeRate, lines };
}

// Goals with no finished work for 3+ days (or ever) — the plan and the Buddy bring them up.
export function staleGoals(today = dayString(coachTz())): { id: string; title: string; idleDays: number | null }[] {
  return goalProgress()
    .filter((g) => g.goal.horizon !== "long")
    .map((g) => ({ id: g.goal.id, title: g.goal.title, idleDays: g.lastWorked ? Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${g.lastWorked}T12:00:00Z`)) / 86_400_000) : null }))
    .filter((g) => g.idleDays === null || g.idleDays >= 3);
}

// The block-by-block mirror as text, for prompts.
export function mirrorText(m: Mirror): string {
  if (!m.rows.length) return "No time blocks planned.";
  const say: Record<Verdict, string> = { upcoming: "ahead", "not-started": "NOT STARTED", "on-time": "on time", late: "late", missed: "MISSED", unfinished: "UNFINISHED" };
  return [
    `${m.done} done of ${m.due} due · ${m.onTimeRate}% started on time · ${m.missed} missed${m.notStarted ? ` · ${m.notStarted} due and not started` : ""} · ${m.unfinished} unfinished${m.over ? (m.kept ? " · day KEPT" : " · day NOT kept") : ""}`,
    ...m.rows.map((r) => `- ${r.start}–${r.end} ${r.title}: ${say[r.verdict]}${r.running ? " (running)" : ""}${r.lateMin && r.lateMin > GRACE_MIN ? `, ${r.lateMin} min late` : ""}${r.actualMin !== undefined ? `, took ${r.actualMin} of ${r.plannedMin} min` : ""}${r.rescheduledTo ? `, re-scheduled to ${r.rescheduledTo}` : ""}`),
  ].join("\n");
}
