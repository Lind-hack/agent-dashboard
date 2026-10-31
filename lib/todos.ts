import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./config";

// Dashboard tasks (v5, Lind's pick: tasks live here, not in TickTick). One file, data/todos.json,
// written only by the web app (the runner just reads it for reminders). TickTick's open tasks are
// imported once each (by their TickTick id) so they can be ticked here too; ticking one also
// completes it in TickTick.

export type Priority = 0 | 1 | 2 | 3; // none, low, medium, high
export type Subtask = { id: string; title: string; done: boolean };
export type Todo = {
  id: string;
  title: string;
  notes?: string;
  goalId?: string;
  priority: Priority;
  estimateMin: number;
  day: string; // the day it's on (carried forward while open)
  due?: string; // deadline: "YYYY-MM-DD" or "YYYY-MM-DDTHH:MM" local time
  subtasks: Subtask[];
  done: boolean;
  doneAt?: string;
  createdAt: string;
  updatedAt: string;
  source: "dashboard" | "ticktick" | "assistant";
  ticktick?: { id: string; projectId: string; pending?: boolean }; // pending: completing it in TickTick failed, retry
};

const file = () => path.join(DATA_DIR, "todos.json");
const newId = () => `t-${Date.now().toString(36)}${crypto.randomBytes(2).toString("hex")}`;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DUE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/;

function clean(t: Partial<Todo> | null | undefined): Todo | null {
  if (!t?.id || !t.title || !DAY.test(t.day ?? "")) return null;
  const pr = Number(t.priority);
  return {
    id: String(t.id),
    title: String(t.title).slice(0, 200),
    notes: t.notes ? String(t.notes).slice(0, 2000) : undefined,
    goalId: t.goalId || undefined,
    priority: ([0, 1, 2, 3].includes(pr) ? pr : 0) as Priority,
    estimateMin: Math.max(5, Math.min(480, Number(t.estimateMin) || 30)),
    day: t.day!,
    due: DUE.test(t.due ?? "") ? t.due : undefined,
    subtasks: Array.isArray(t.subtasks) ? t.subtasks.filter((s) => s?.id && s?.title).map((s) => ({ id: String(s.id), title: String(s.title).slice(0, 160), done: !!s.done })).slice(0, 20) : [],
    done: !!t.done,
    doneAt: t.doneAt || undefined,
    createdAt: t.createdAt ?? new Date().toISOString(),
    updatedAt: t.updatedAt ?? new Date().toISOString(),
    source: t.source === "ticktick" || t.source === "assistant" ? t.source : "dashboard",
    ticktick: t.ticktick?.id ? { id: String(t.ticktick.id), projectId: String(t.ticktick.projectId ?? ""), pending: t.ticktick.pending ? true : undefined } : undefined,
  };
}

export function listTodos(): Todo[] {
  try {
    const raw = JSON.parse(fs.readFileSync(file(), "utf8"));
    return (Array.isArray(raw) ? raw : []).map(clean).filter((t): t is Todo => !!t);
  } catch {
    return [];
  }
}

function writeTodos(all: Todo[]) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  // Finished tasks older than 60 days drop off; the plans keep the history.
  const cutoff = new Date(Date.now() - 60 * 86_400_000).toISOString();
  const kept = all.filter((t) => !t.done || (t.doneAt ?? t.updatedAt) > cutoff);
  fs.writeFileSync(`${file()}.${process.pid}.tmp`, JSON.stringify(kept, null, 2));
  fs.renameSync(`${file()}.${process.pid}.tmp`, file());
}

export type TodoInput = Partial<Pick<Todo, "title" | "notes" | "goalId" | "priority" | "estimateMin" | "day" | "due" | "source">> & { subtasks?: string[] };

export function addTodo(input: TodoInput & { title: string; day: string }): Todo {
  const at = new Date().toISOString();
  const t = clean({
    ...input,
    id: newId(),
    subtasks: (input.subtasks ?? []).filter(Boolean).map((title) => ({ id: newId(), title, done: false })),
    done: false,
    createdAt: at,
    updatedAt: at,
  });
  if (!t) throw new Error("A task needs a title and a day.");
  writeTodos([...listTodos(), t]);
  return t;
}

export type TodoPatch = Partial<Pick<Todo, "title" | "notes" | "goalId" | "priority" | "estimateMin" | "day" | "due" | "done">> & {
  addSubtask?: string;
  toggleSubtask?: string;
  removeSubtask?: string;
};

export function updateTodo(id: string, p: TodoPatch): Todo | null {
  const all = listTodos();
  const i = all.findIndex((t) => t.id === id);
  if (i < 0) return null;
  const t = { ...all[i] };
  for (const k of ["title", "notes", "goalId", "priority", "estimateMin", "day", "due"] as const) if (k in p) (t as Record<string, unknown>)[k] = p[k] === "" ? undefined : p[k];
  if (p.addSubtask?.trim()) t.subtasks = [...t.subtasks, { id: newId(), title: p.addSubtask.trim(), done: false }];
  if (p.toggleSubtask) t.subtasks = t.subtasks.map((s) => (s.id === p.toggleSubtask ? { ...s, done: !s.done } : s));
  if (p.removeSubtask) t.subtasks = t.subtasks.filter((s) => s.id !== p.removeSubtask);
  if (typeof p.done === "boolean" && p.done !== t.done) {
    t.done = p.done;
    t.doneAt = p.done ? new Date().toISOString() : undefined;
  }
  t.updatedAt = new Date().toISOString();
  const c = clean(t);
  if (!c) return null;
  all[i] = c;
  writeTodos(all);
  return c;
}

export function removeTodo(id: string): boolean {
  const all = listTodos();
  const next = all.filter((t) => t.id !== id);
  if (next.length === all.length) return false;
  writeTodos(next);
  return true;
}

export function setTickTickPending(id: string, pending: boolean) {
  const all = listTodos();
  const t = all.find((x) => x.id === id);
  if (!t?.ticktick) return;
  t.ticktick.pending = pending || undefined;
  writeTodos(all);
}

// Every TickTick id ever imported, kept apart from the tasks: a task deleted (or pruned) here must
// not come back on the next import.
const importedFile = () => path.join(DATA_DIR, "todos-imported.json");
function readImported(): Set<string> {
  try {
    const v = JSON.parse(fs.readFileSync(importedFile(), "utf8"));
    return new Set(Array.isArray(v) ? v.map(String) : []);
  } catch {
    return new Set();
  }
}

// TickTick's open tasks, imported once each. A task already imported keeps its local edits.
export function importTickTick(tasks: { id: string; projectId: string; title: string; content?: string; due?: string; allDay: boolean; priority: number }[], today: string, tz: string): number {
  const all = listTodos();
  const known = readImported();
  for (const t of all) if (t.ticktick?.id) known.add(t.ticktick.id);
  const at = new Date().toISOString();
  const local = (iso: string) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
    return { day: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
  };
  let n = 0;
  for (const x of tasks) {
    if (known.has(x.id)) continue;
    known.add(x.id);
    const d = x.due ? (DAY.test(x.due) ? { day: x.due, time: "" } : local(x.due)) : null;
    const t = clean({
      id: newId(),
      title: x.title,
      notes: x.content,
      priority: (x.priority >= 5 ? 3 : x.priority >= 3 ? 2 : x.priority >= 1 ? 1 : 0) as Priority,
      estimateMin: 30,
      day: d && d.day > today ? d.day : today,
      due: d ? (x.allDay || !d.time ? d.day : `${d.day}T${d.time}`) : undefined,
      subtasks: [],
      done: false,
      createdAt: at,
      updatedAt: at,
      source: "ticktick",
      ticktick: { id: x.id, projectId: x.projectId },
    });
    if (t) {
      all.push(t);
      n++;
    }
  }
  if (n) {
    writeTodos(all);
    fs.writeFileSync(`${importedFile()}.${process.pid}.tmp`, JSON.stringify([...known].slice(-5000)));
    fs.renameSync(`${importedFile()}.${process.pid}.tmp`, importedFile());
  }
  return n;
}

const dueDay = (t: Todo) => t.due?.slice(0, 10);
const localDay = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: process.env.DASHBOARD_TZ ?? "Europe/Belgrade" }).format(new Date(iso));

// Today's list: overdue (open, from an earlier day or past its deadline), today, done today, and what's
// on later days.
export function todosFor(day: string, all = listTodos()) {
  const open = all.filter((t) => !t.done);
  const rank = (a: Todo, z: Todo) => z.priority - a.priority || (a.due ?? "9999").localeCompare(z.due ?? "9999") || a.createdAt.localeCompare(z.createdAt);
  return {
    overdue: open.filter((t) => t.day < day || (dueDay(t) ?? "9999") < day).sort(rank),
    today: open.filter((t) => t.day === day && !((dueDay(t) ?? "9999") < day)).sort(rank),
    done: all.filter((t) => t.done && t.doneAt && localDay(t.doneAt) === day).sort((a, z) => (z.doneAt ?? "").localeCompare(a.doneAt ?? "")),
    later: open.filter((t) => t.day > day).sort((a, z) => a.day.localeCompare(z.day) || rank(a, z)),
  };
}

// Share of a task done: subtasks count when there are any.
export const todoPercent = (t: Todo) => (t.done ? 100 : t.subtasks.length ? Math.round((100 * t.subtasks.filter((s) => s.done).length) / t.subtasks.length) : 0);
export const remainingMin = (t: Todo) => (t.done ? 0 : Math.round((t.estimateMin * (100 - todoPercent(t))) / 100));
