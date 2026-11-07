import { NextResponse } from "next/server";
import { syncDashboardTasks, taskSyncStatus } from "@/lib/task-sync";
import { listTodos } from "@/lib/todos";
import { ticktickConnected } from "@/lib/ticktick";
import { guarded } from "@/lib/guard";

export const dynamic = "force-dynamic";
async function GET_() {
  const status = taskSyncStatus();
  const todos = listTodos();
  return NextResponse.json({ connected: ticktickConnected(), at: status.at, errors: Object.values(status.errors), linked: todos.filter((t) => t.ticktick).length, total: todos.length });
}
async function POST_() {
  const result = await syncDashboardTasks();
  return NextResponse.json({ ...result, errors: Object.values(result.errors) });
}

export const GET = guarded(GET_, { owner: true });
export const POST = guarded(POST_, { owner: true });
