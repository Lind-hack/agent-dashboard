import fs from "node:fs";
import path from "node:path";
import { dayString } from "./calendar";
import { zonedMs } from "./coach";
import { DATA_DIR } from "./config";
import { activeBlocks, readPlan } from "./plan-store";
import { applyTaskSync, importTickTick, listTodos, type Todo } from "./todos";
import { completeTask, getTask, putTask, syncTasks, ticktickConnected, type RawTask } from "./ticktick";

// Tasks are durable work, calendar blocks are reservations of time. Only explicit task completion
// changes `done`. A finished/elapsed/moved/deleted calendar block never completes a task.
export type TaskFields = { title: string; notes: string; due: string; priority: number; done: boolean; steps: { title: string; done: boolean }[] };
type Snapshot = { local: TaskFields; remote: TaskFields; projectId: string; remoteId: string; schedule: string };
type SyncState = { at?: string; errors: Record<string, string>; tasks: Record<string, Snapshot> };
const file = () => path.join(DATA_DIR, "task-sync.json");
const tz = () => process.env.DASHBOARD_TZ ?? "Europe/Belgrade";
const fields = ["title", "notes", "due", "priority", "done", "steps"] as const;
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const localFields = (t: Todo): TaskFields => ({ title: t.title, notes: t.notes ?? "", due: t.due ?? t.day, priority: t.priority, done: t.done, steps: t.subtasks.map((s) => ({ title: s.title, done: s.done })) });
const marker = (id: string) => `Dashboard task: ${id}`;
const footer = "\n\n---\n";
function remoteFields(r: RawTask): TaskFields {
  const stamp = r.dueDate ?? r.startDate;
  let due = "";
  if (stamp) {
    const at = new Date(stamp.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
    const zone = r.timeZone || tz();
    due = dayString(zone, at);
    if (!r.isAllDay) due += "T" + new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at);
  }
  return { title: r.title ?? "", notes: (r.content ?? "").split(footer + "Dashboard task:")[0], due, priority: r.priority === 5 ? 3 : r.priority === 3 ? 2 : r.priority === 1 ? 1 : 0, done: r.status === 2, steps: (r.items ?? []).map((s) => ({ title: s.title, done: s.status === 1 })) };
}

// Merge each field independently. When both sides changed the SAME field, the dashboard wins;
// unrelated TickTick changes still come back. Separate baselines handle provider normalisation.
export function mergeTask(local: TaskFields, remote: TaskFields, before?: Pick<Snapshot, "local" | "remote">): TaskFields {
  if (!before) return local;
  const merged = { ...local };
  for (const key of fields) if (equal(local[key], before.local[key]) && !equal(remote[key], before.remote[key])) Object.assign(merged, { [key]: remote[key] });
  return merged;
}

export function taskSyncStatus(): SyncState {
  try { return JSON.parse(fs.readFileSync(file(), "utf8")); }
  catch { return { errors: {}, tasks: {} }; }
}
function save(state: SyncState) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(`${file()}.tmp`, JSON.stringify(state, null, 2));
  fs.renameSync(`${file()}.tmp`, file());
}
function scheduleFor(t: Todo): string {
  // A task may have several sessions. These are context in TickTick, not a substitute for its due date.
  const day = dayString(tz());
  const lines: string[] = [];
  for (let i = 0; i < 8; i++) {
    const date = new Date(`${day}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + i);
    const d = date.toISOString().slice(0, 10);
    for (const b of activeBlocks(readPlan(d))) if (b.taskId === t.id) lines.push(`${d} ${b.start}–${b.end} (${b.status})`);
  }
  return lines.join("\n");
}
function bodyFor(t: Todo, f: TaskFields, schedule: string, projectId: string, r?: RawTask): Partial<RawTask> & { title: string; projectId: string } {
  const stamp = f.due ? new Date(zonedMs(f.due.slice(0, 10), f.due.slice(11) || "00:00", tz())).toISOString().replace(/\.\d{3}Z$/, "+0000") : undefined;
  const managed = [marker(t.id), `Estimate: ${t.estimateMin} minutes`, t.link, ...(schedule ? [`Time blocks (${tz()}):\n${schedule}`] : []), "https://agents.383ks.com/calendar"].filter(Boolean).join("\n");
  return { id: r?.id, projectId, title: f.title, content: f.notes + footer + managed, priority: [0, 1, 3, 5][f.priority], status: f.done ? 2 : 0, startDate: stamp ?? "", dueDate: stamp ?? "", isAllDay: !f.due.includes("T"), timeZone: tz(), items: f.steps.map((s, i) => ({ id: r?.items?.[i]?.id, title: s.title, status: s.done ? 1 : 0, sortOrder: i })) };
}

// One owner across runner and web processes. Never hold the synchronous file lock over a request.
// A dead process's lock can be recovered; live processes (including a slow request) keep ownership.
function takeLock(): (() => void) | null {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const lock = path.join(DATA_DIR, "task-sync.lock");
  for (let attempt = 0; attempt < 2; attempt++) {
    try { fs.writeFileSync(lock, String(process.pid), { flag: "wx" }); return () => fs.rmSync(lock, { force: true }); }
    catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      try {
        const pid = Number(fs.readFileSync(lock, "utf8"));
        if (!pid) return null; // another owner may still be writing its pid
        try { process.kill(pid, 0); return null; }
        catch (err) { if ((err as NodeJS.ErrnoException).code !== "ESRCH") return null; }
        // Recheck before unlink: don't remove a replacement lock.
        if (fs.readFileSync(lock, "utf8") === String(pid)) fs.rmSync(lock);
      } catch { return null; }
    }
  }
  return null;
}

export async function syncDashboardTasks(): Promise<{ connected: boolean; busy?: boolean; errors: Record<string, string> }> {
  if (!ticktickConnected()) return { connected: false, errors: {} };
  const release = takeLock();
  if (!release) return { connected: true, busy: true, errors: taskSyncStatus().errors };
  const state = taskSyncStatus();
  state.errors = {};
  try {
    const all = listTodos();
    const recovery = await syncTasks([...new Set(all.flatMap((t) => t.ticktick ? [t.ticktick.projectId] : []))]);
    const inbox = all.find((t) => t.ticktick?.projectId.startsWith("inbox"))?.ticktick?.projectId ?? recovery.find((r) => r.projectId.startsWith("inbox"))?.projectId ?? "inbox";
    // Import new remote work, including future dates; never interpret an absent task as completed.
    importTickTick(recovery.filter((r) => r.status !== 2 && !(r.content ?? "").includes("Dashboard task:")).map((r) => {
      const f = remoteFields(r);
      return { id: r.id, projectId: r.projectId, title: f.title, content: f.notes, due: r.dueDate ?? r.startDate, allDay: !!r.isAllDay, priority: r.priority ?? 0 };
    }), dayString(tz()), tz());
    for (const t of listTodos()) {
      try {
        const local = localFields(t);
        const prev = state.tasks[t.id];
        const before = prev && (!t.ticktick || prev.remoteId === t.ticktick.id) ? prev : undefined;
        const schedule = scheduleFor(t);
        let r: RawTask | undefined;
        if (t.ticktick) r = await getTask(t.ticktick.projectId, t.ticktick.id);
        else {
          const found = recovery.filter((r) => (r.content ?? "").split("\n").includes(marker(t.id)));
          if (found.length > 1) throw new Error("Multiple TickTick copies found; sync paused for this task.");
          r = found[0];
        }
        const remote = r ? remoteFields(r) : local;
        // On first linking, TickTick-imported tasks keep their remote details. Dashboard-owned tasks
        // establish the dashboard baseline, including the tasks linked by the earlier one-off import.
        const merged = !before && t.source === "ticktick" && r ? remote : mergeTask(local, remote, before);
        const needsWrite = !r || !equal(merged, remote) || before?.schedule !== schedule;
        if (needsWrite) {
          const project = r?.projectId ?? inbox;
          r = await putTask(bodyFor(t, merged, schedule, project, r));
          if (!r?.id || !r.projectId) throw new Error("TickTick did not return a task ID.");
          // Persist the link BEFORE completion or further requests: retries cannot create a second task.
          applyTaskSync(t.id, t.updatedAt, { id: r.id, projectId: r.projectId });
          if (merged.done && r.status !== 2) await completeTask(r.projectId, r.id);
          r = await getTask(r.projectId, r.id);
          const actual = remoteFields(r);
          if (!equal(actual, merged)) throw new Error("TickTick did not accept all changes; sync will retry.");
        }
        if (!r) throw new Error("Task could not be synced.");
        const patch: Partial<Todo> = equal(merged, local) ? {} : {
          title: merged.title, notes: merged.notes || undefined, priority: merged.priority as Todo["priority"],
          due: merged.due || undefined,
          ...(merged.due !== local.due && merged.due ? { day: merged.due.slice(0, 10) } : {}),
          done: merged.done, doneAt: merged.done ? (t.doneAt ?? new Date().toISOString()) : undefined,
          subtasks: merged.steps.map((s, i) => ({ ...s, id: t.subtasks[i]?.id ?? `tt-${r!.id}-${i}` })),
        };
        const applied = applyTaskSync(t.id, t.updatedAt, { id: r.id, projectId: r.projectId }, Object.keys(patch).length ? patch : undefined);
        state.tasks[t.id] = { local: applied ? localFields(listTodos().find((x) => x.id === t.id)!) : merged, remote: remoteFields(r), projectId: r.projectId, remoteId: r.id, schedule };
        save(state);
      } catch (e) { state.errors[t.id] = e instanceof Error ? e.message : String(e); }
    }
    state.at = new Date().toISOString();
    save(state);
    return { connected: true, errors: state.errors };
  } catch (e) {
    state.errors.connection = e instanceof Error ? e.message : String(e); save(state);
    return { connected: true, errors: state.errors };
  } finally { release(); }
}

let running = false;
let last = 0;
export function taskSyncTick() {
  if (running || Date.now() - last < 30_000) return;
  last = Date.now(); running = true;
  void syncDashboardTasks().catch(() => {}).finally(() => { running = false; });
}
