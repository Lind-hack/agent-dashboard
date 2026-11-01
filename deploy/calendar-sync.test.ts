import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, beforeEach, after } from "node:test";
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "calendar-sync-test-"));
const { replacePlan, mirrorBlock, PLAN_KEY, addDays, dayString } = await import("../lib/calendar");
const day = addDays(dayString("Europe/Belgrade"), 1);
const original = global.fetch;
let events: any[] = [], counter = 0, writes = 0, failCreate = false;
const block = { blockId: "work", title: "Write the report", start: "14:00", end: "15:00", kind: "task" as const, taskId: "todo-report" };
beforeEach(() => {
 fs.writeFileSync(path.join(process.env.DATA_DIR!, "google.json"), JSON.stringify({ client_id: "fake", client_secret: "fake", refresh_token: "fake" }));
 events = [{ id: "meeting", summary: "Dentist", start: { dateTime: `${day}T12:00:00+01:00` }, end: { dateTime: `${day}T13:00:00+01:00` } }];
 counter = writes = 0; failCreate = false;
 global.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const u = new URL(String(input)); const method = init?.method ?? "GET";
  const respond = (data: unknown) => new Response(JSON.stringify(data));
  if (u.hostname === "oauth2.googleapis.com") return respond({ access_token: "fake", expires_in: 3600 });
  if (u.pathname.endsWith("/calendars/primary")) return respond({ timeZone: "Europe/Belgrade" });
  if (method === "GET") {
    const [key, value] = (u.searchParams.get("privateExtendedProperty") ?? "").split("=");
    return respond({ items: events.filter((e) => e.extendedProperties?.private?.[key] === value) });
  }
  if (method === "POST") {
    if (failCreate) return new Response("{}", { status: 503 });
    const e = { ...JSON.parse(String(init?.body)), id: `event-${++counter}` }; events.push(e); writes++; return respond(e);
  }
  const id = u.pathname.split("/").at(-1);
  if (method === "PATCH") { const i = events.findIndex((e) => e.id === id); events[i] = { ...events[i], ...JSON.parse(String(init?.body)) }; writes++; return respond(events[i]); }
  if (method === "DELETE") { events = events.filter((e) => e.id !== id); writes++; return new Response(null, { status: 204 }); }
  throw new Error("Unexpected Google request");
 }) as typeof fetch;
});
after(() => { global.fetch = original; fs.rmSync(process.env.DATA_DIR!, { recursive: true, force: true }); });

test("replans update linked time blocks in place; appointments survive and repeat syncs do not duplicate", async () => {
 await replacePlan(day, [block]); await replacePlan(day, [block]);
 assert.equal(writes, 1); assert.equal(events.length, 2);
 const id = events.find((e) => e.id !== "meeting").id;
 await replacePlan(day, [{ ...block, start: "15:00", end: "16:00" }]);
 assert.equal(events.length, 2); assert.equal(events.find((e) => e.id === id).start.dateTime, `${day}T15:00:00`);
 assert.match(events.find((e) => e.id === id).description, /complete the task separately/);
 await replacePlan(day, []); assert.deepEqual(events.map((e) => e.id), ["meeting"]);
});

test("deleted reservations are restored once; scheduling an existing task repairs its calendar mirror", async () => {
 await mirrorBlock(day, block); await mirrorBlock(day, block); assert.equal(events.length, 2);
 events = events.filter((e) => e.id === "meeting");
 await replacePlan(day, [block]); await replacePlan(day, [block]); assert.equal(events.length, 2);
});

test("a failed new reservation does not delete the old plan", async () => {
 await replacePlan(day, [block]); failCreate = true;
 await assert.rejects(replacePlan(day, [{ ...block, blockId: "new-work" }]));
 assert.ok(events.some((e) => e.extendedProperties?.private?.blockId === "work"));
 assert.ok(events.some((e) => e.id === "meeting"));
});
