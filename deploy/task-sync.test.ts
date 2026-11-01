import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, beforeEach, after } from "node:test";
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "task-sync-test-"));
process.env.DASHBOARD_TZ = "Europe/Belgrade";
const { addTodo, listTodos, updateTodo, removeTodo, applyTaskSync } = await import("../lib/todos");
const { addBlock, activeBlocks, readPlan, savePlan, setBlockStatus } = await import("../lib/plan-store");
const { syncDashboardTasks, mergeTask } = await import("../lib/task-sync");
const { finishTodo } = await import("../lib/todo-actions");
const { POST: blockAction } = await import("../app/api/plan/blocks/route");
const { POST: coachAction } = await import("../app/api/coach/route");
const { coachNow } = await import("../lib/coach");
const original = global.fetch;
let remote: Record<string, any> = {};
let creates = 0;
let fail = false;
let loseReply = false;
let whileRequest: (() => void) | undefined;
const day = () => coachNow().day;
function setup() {
 fs.rmSync(process.env.DATA_DIR!, { recursive: true, force: true }); fs.mkdirSync(process.env.DATA_DIR!);
 fs.writeFileSync(path.join(process.env.DATA_DIR!, "ticktick.json"), JSON.stringify({ client_id: "test", access_token: "fake" }));
 remote = {}; creates = 0; fail = false; loseReply = false; whileRequest = undefined;
 global.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  const u = String(url).split("/open/v1")[1];
  if (fail) return new Response("{}", { status: 503 });
  const respond = (x: unknown) => new Response(JSON.stringify(x), { status: 200 });
  if (u === "/project") return respond([]);
  if (u === "/task/filter" || u?.endsWith("/data")) {
    const open = Object.values(remote).filter((r) => r.status !== 2 && !r.hidden);
    return respond(u === "/task/filter" ? open : { tasks: open });
  }
  if (u === "/task" || u?.startsWith("/task/")) {
    const b = JSON.parse(String(init?.body));
    const id = b.id ?? `remote-${++creates}`;
    remote[id] = { ...remote[id], ...b, id, projectId: "inbox-test", status: b.status ?? 0 };
    if (whileRequest) { const cb = whileRequest; whileRequest = undefined; cb(); }
    if (loseReply) { loseReply = false; throw new Error("Response lost after create"); }
    return respond(remote[id]);
  }
  const complete = u?.match(/\/task\/([^/]+)\/complete$/);
  if (complete) { remote[complete[1]].status = 2; return respond(null); }
  const id = u?.split("/task/")[1];
  if (init?.method === "DELETE") { delete remote[id!]; return respond(null); }
  return remote[id!] ? respond(remote[id!]) : new Response("{}", { status: 404 });
 }) as typeof fetch;
}
beforeEach(setup);
after(() => { global.fetch = original; fs.rmSync(process.env.DATA_DIR!, { recursive: true, force: true }); });
const sync = async () => { const result = await syncDashboardTasks(); assert.deepEqual(result.errors, {}); };

test("all task creators export once; repeated planning links work but ignores breaks and routines", async () => {
 for (const source of ["dashboard", "assistant", "email", "journal"] as const) addTodo({ title: source, day: day(), source });
 const blocks = [{ blockId: "work", title: "New work", start: "14:00", end: "15:00", kind: "task" as const }, { blockId: "break", title: "Lunch", start: "15:00", end: "15:30", kind: "break" as const }, { blockId: "routine", title: "Wake up", start: "10:00", end: "11:00", kind: "routine" as const }];
 savePlan(day(), blocks); savePlan(day(), blocks);
 assert.equal(listTodos().length, 5); assert.ok(readPlan(day())!.blocks[1].taskId);
 await sync(); await sync();
 assert.equal(creates, 5); assert.ok(listTodos().every((t) => t.ticktick));
 assert.match(Object.values(remote).find((t) => t.title === "New work").content, /14:00–15:00/);
 assert.equal(Object.values(remote).some((t) => t.title === "Lunch"), false);
});

test("edits and explicit completion/reopening sync both ways; field conflicts preserve independent edits", async () => {
 const t = addTodo({ title: "First", day: day(), notes: "Before", priority: 1, subtasks: ["One"] });
 await sync(); const r = Object.values(remote)[0];
 updateTodo(t.id, { title: "Local title" }); remote[r.id].priority = 5; remote[r.id].items[0].status = 1;
 await sync(); assert.equal(remote[r.id].title, "Local title"); assert.equal(listTodos()[0].priority, 3); assert.equal(listTodos()[0].subtasks[0].done, true);
 remote[r.id].status = 2; await sync(); assert.equal(listTodos()[0].done, true);
 updateTodo(t.id, { done: false }); await sync(); assert.equal(remote[r.id].status, 0);
 remote[r.id].title = "From TickTick"; await sync(); assert.equal(listTodos()[0].title, "From TickTick");
 updateTodo(t.id, { due: day() + "T18:30" }); await sync(); assert.match(remote[r.id].dueDate, /17:30:00\+0000/);
});

test("a lost create response is recovered by provenance without creating a duplicate", async () => {
 addTodo({ title: "Retry me", day: day() }); loseReply = true;
 assert.equal(Object.keys((await syncDashboardTasks()).errors).length, 1);
 await sync(); assert.equal(creates, 1); assert.ok(listTodos()[0].ticktick);
});

test("outages and deleted remote tasks do not complete local work, and local edits in flight survive", async () => {
 const t = addTodo({ title: "Old", day: day() }); fail = true;
 assert.ok((await syncDashboardTasks()).errors.connection); fail = false;
 whileRequest = () => { updateTodo(t.id, { title: "Changed during request" }); };
 await sync(); assert.equal(listTodos()[0].title, "Changed during request");
 await sync(); assert.equal(Object.values(remote)[0].title, "Changed during request");
 delete remote[listTodos()[0].ticktick!.id];
 assert.ok((await syncDashboardTasks()).errors[t.id]); assert.equal(listTodos()[0].done, false);
});

test("finishing or moving a block never completes its task; explicit task completion does not invent worked sessions", async () => {
 const t = addTodo({ title: "Two sessions", day: day() });
 const b = addBlock(day(), { title: t.title, start: "14:00", length: 60, taskId: t.id, kind: "task" });
 const other = addBlock(day(), { title: t.title, start: "16:00", length: 60, taskId: t.id, kind: "task" });
 const request = (body: unknown) => new Request("http://localhost/api/plan/blocks", { method: "POST", body: JSON.stringify(body) });
 assert.equal((await blockAction(request({ day: day(), id: b.id, action: "done" }))).status, 200);
 assert.equal(listTodos()[0].done, false);
 assert.equal((await coachAction(request({ id: other.id, action: "done" }))).status, 200);
 assert.equal(listTodos()[0].done, false);
 setBlockStatus(day(), other.id, "planned");
 await finishTodo(t.id); assert.equal(listTodos()[0].done, true);
 assert.equal(readPlan(day())!.blocks.find((x) => x.id === other.id)!.status, "planned");
});

test("clearing a date in TickTick stays cleared across retries and unrelated edits", async () => {
 const t = addTodo({ title: "Clear my deadline", day: day(), due: day() + "T18:30" });
 await sync(); const r = Object.values(remote)[0];
 r.startDate = r.dueDate = "";
 await sync(); assert.equal(listTodos()[0].due, undefined);
 await sync(); assert.equal(remote[r.id].dueDate, "");
 remote[r.id].title = "No deadline";
 await sync(); assert.equal(listTodos()[0].title, "No deadline"); assert.equal(remote[r.id].dueDate, "");
});

test("an existing live sync lock prevents concurrent creation", async () => {
 addTodo({ title: "Only one owner", day: day() });
 const f = path.join(process.env.DATA_DIR!, "task-sync.lock");
 fs.writeFileSync(f, `${process.pid}:other-owner`);
 const result = await syncDashboardTasks(); assert.equal(result.busy, true); assert.equal(creates, 0);
 fs.rmSync(f); await sync(); assert.equal(creates, 1);
});


test("deleting or undoing a dashboard task removes its exported TickTick copy", async () => {
 const t = addTodo({ title: "Undo this task", day: day() });
 await sync(); const id = listTodos()[0].ticktick!.id;
 removeTodo(t.id); await sync(); assert.equal(remote[id], undefined); assert.equal(listTodos().length, 0);
});


test("initial migration preserves work explicitly completed in TickTick", async () => {
 const t = addTodo({ title: "Already finished remotely", day: day() });
 remote.existing = { id: "existing", projectId: "inbox-test", title: t.title, status: 2, priority: 0, content: "", dueDate: "", isAllDay: true };
 applyTaskSync(t.id, t.updatedAt, { id: "existing", projectId: "inbox-test" });
 await sync(); assert.equal(listTodos()[0].done, true); assert.equal(remote.existing.status, 2);
});


test("HTTP 200 with a null deleted-task body never creates replacement copies", async () => {
 const t = addTodo({ title: "Deleted on TickTick", day: day() });
 applyTaskSync(t.id, t.updatedAt, { id: "deleted", projectId: "inbox-test" });
 const api = global.fetch;
 global.fetch = (async (url: string | URL | Request, init?: RequestInit) => String(url).endsWith("/task/deleted") ? new Response("null") : api(url, init)) as typeof fetch;
 const result = await syncDashboardTasks(); assert.match(result.errors[t.id], /no longer exists/);
 assert.equal(creates, 0); assert.equal(listTodos()[0].done, false);
});


test("rate limits stop the pass and persist Retry-After across manual retries", async () => {
 addTodo({ title: "Wait for the provider", day: day() });
 let requests = 0;
 global.fetch = (async () => { requests++; return new Response("{}", { status: 429, headers: { "retry-after": "120" } }); }) as typeof fetch;
 const first = await syncDashboardTasks(); assert.match(first.errors.connection, /rate limiting/);
 const second = await syncDashboardTasks(); assert.match(second.errors.connection, /retry/);
 assert.equal(requests, 1); assert.equal(creates, 0); assert.equal(listTodos()[0].done, false);
});


test("deleted TickTick records still readable by ID are not resurrected", async () => {
 const t = addTodo({ title: "Deleted remotely", day: day() });
 await sync(); const id = listTodos()[0].ticktick!.id; remote[id].hidden = true;
 const result = await syncDashboardTasks(); assert.match(result.errors[t.id], /no longer listed/);
 assert.equal(creates, 1); assert.equal(remote[id].hidden, true); assert.equal(listTodos()[0].done, false);
});
