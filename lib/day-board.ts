import { addDays } from "./calendar";
import { coachNow, goalProgress } from "./coach";
import { habitsFor, type HabitDay } from "./habits";
import { listTodos, todoPercent, todosFor, type Todo } from "./todos";

// The day board (v5.3): one list for a day — habits, tasks, and (today) the goals' week — each row
// filling up as it's done, plus the week strip's rings. Shared by Today's server render and
// /api/habits, so a tap's refresh shows exactly what the page would.

export type BoardTask = Pick<Todo, "id" | "title" | "priority" | "estimateMin" | "done" | "due" | "subtasks" | "goalId"> & { percent: number; overdue: boolean };
export type BoardGoal = { id: string; title: string; next: string; weekMin: number; targetMin: number; todayMin: number; streak: number };
export type Board = { day: string; today: string; habits: HabitDay[]; tasks: BoardTask[]; goals: BoardGoal[]; week: { day: string; ratio: number; items: number }[] };

const task = (t: Todo, overdue = false): BoardTask => ({ id: t.id, title: t.title, priority: t.priority, estimateMin: t.estimateMin, done: t.done, due: t.due, subtasks: t.subtasks, goalId: t.goalId, percent: todoPercent(t), overdue });

function tasksOn(day: string, today: string, all: Todo[]): BoardTask[] {
  const t = todosFor(day, all);
  if (day === today) return [...t.overdue.map((x) => task(x, true)), ...t.today.map((x) => task(x)), ...t.done.map((x) => task(x))];
  // Another day: what was done that day, and what was (or is) planned for it and still open.
  return [...all.filter((x) => !x.done && x.day === day).map((x) => task(x)), ...t.done.map((x) => task(x))];
}

// A day's completion for the week strip: every habit (its share of the target) and task counts once.
function ratio(habits: HabitDay[], tasks: BoardTask[]): { ratio: number; items: number } {
  const parts = [...habits.map((h) => Math.min(1, h.value / h.habit.target)), ...tasks.map((t) => (t.done ? 1 : t.percent / 100))];
  return { ratio: parts.length ? parts.reduce((s, x) => s + x, 0) / parts.length : 0, items: parts.length };
}

export function board(day?: string): Board {
  const today = coachNow().day;
  const d = day && /^\d{4}-\d{2}-\d{2}$/.test(day) && day <= addDays(today, 7) ? day : today;
  const all = listTodos();
  const habits = habitsFor(d);
  const tasks = tasksOn(d, today, all);
  // Sunday-first week around the chosen day, like a paper planner.
  const sunday = addDays(d, -new Date(`${d}T12:00:00Z`).getUTCDay());
  const week = Array.from({ length: 7 }, (_, i) => addDays(sunday, i)).map((w) => ({ day: w, ...(w === d ? ratio(habits, tasks) : ratio(habitsFor(w), tasksOn(w, today, all))) }));
  const goals =
    d === today
      ? goalProgress()
          .filter((g) => g.goal.horizon !== "long")
          .map((g) => ({ id: g.goal.id, title: g.goal.title, next: g.goal.next, weekMin: g.weekMin, targetMin: g.targetMin, todayMin: g.todayDoneMin, streak: g.streak }))
      : [];
  return { day: d, today, habits, tasks, goals, week };
}
