import { NextResponse } from "next/server";
import { syncDashboardTasks, taskSyncStatus } from "@/lib/task-sync";
import { listTodos } from "@/lib/todos";
import { ticktickConnected } from "@/lib/ticktick";

export const dynamic = "force-dynamic";
export async function GET() {
  const status = taskSyncStatus();
  const todos = listTodos();
  return NextResponse.json({ connected: ticktickConnected(), at: status.at, errors: Object.values(status.errors), linked: todos.filter((t) => t.ticktick).length, total: todos.length });
}
export async function POST() {
  const result = await syncDashboardTasks();
  return NextResponse.json({ ...result, errors: Object.values(result.errors) });
}
