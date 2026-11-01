import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { inflateSync } from "node:zlib";
import { createHash } from "node:crypto";
import { NextRequest } from "next/server";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "widget-test-"));
process.env.DATA_DIR = dir;
process.env.MEMORY_VAULT_DIR = path.join(dir, "vault");
process.env.DASHBOARD_TZ = "Europe/Belgrade";
process.env.WIDGET_READ_TOKEN = "test-widget-secret-" + "a".repeat(48);
process.env.SESSION_SECRET = "test-session-secret";
const secret = process.env.WIDGET_READ_TOKEN;
const { GET, POST, HEAD } = await import("../app/api/widget/image/route");
const { proxy } = await import("../proxy");
const { makeSession } = await import("../lib/auth");
const { readWidgetData } = await import("../lib/widget/data");
const { renderWidget, widgetContent, widgetElement, widgetTheme, WIDGET_SIZES } = await import("../lib/widget/image");
const golden = JSON.parse(fs.readFileSync(new URL("./widget-golden.json", import.meta.url), "utf8"));
const { WIDGET_HEADERS } = await import("../lib/widget/auth");
after(() => fs.rmSync(dir, { recursive: true, force: true }));
const request = (query = "view=today&size=large", auth: string | null = `Bearer ${secret}`, method = "GET") => new Request(`https://agents.383ks.com/api/widget/image?${query}`, { method, headers: auth ? { authorization: auth } : {} });
const privateResponse = (response: Response) => {
  for (const [key, value] of Object.entries(WIDGET_HEADERS)) assert.equal(response.headers.get(key), value, key);
  assert.ok(!JSON.stringify([...response.headers]).includes(secret));
  assert.equal(response.headers.get("set-cookie"), null);
};
function write(file: string, value: unknown) {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), JSON.stringify(value));
}
const at = new Date("2026-11-01T11:30:00Z");
const day = "2026-11-01";
write(`plans/${day}.json`, { day, blocks: [
  { id: "done", start: "09:00", end: "10:00", title: "Real finished session", kind: "focus", status: "done", goalId: "goal-ship", startedAt: "2026-11-01T08:00:00Z", doneAt: "2026-11-01T09:00:00Z" },
  { id: "now", start: "12:00", end: "13:00", title: "Real planner block", kind: "focus", status: "running" },
] });
write("todos.json", [{ id: "task", title: "Real task", day, priority: 2, createdAt: at.toISOString() }]);
fs.writeFileSync(path.join(dir, "goals.md"), "- [ ] now Ship | next: Release widget | weekly: 2h\n");
write("habits/habits.json", [{ id: "h-water", title: "Water", target: 2, createdAt: "2026-10-01" }]);
write(`habits/days/${day}.json`, { "h-water": 2 });
write("sources/calendar.json", { at: at.toISOString(), items: [
  { id: "event", title: "Real appointment", start: "2026-11-01T14:00:00Z", end: "2026-11-01T15:00:00Z", allDay: false },
  { id: "midnight", title: "Ends at midnight", start: "2026-10-31T20:00:00Z", end: "2026-10-31T23:00:00Z", allDay: false },
  { id: "old", title: "Yesterday only", start: "2026-10-31", end: day, allDay: true },
  { id: "mirror", title: "Planner reservation", start: "2026-11-01T12:00:00Z", end: "2026-11-01T13:00:00Z", planned: true },
] });

test("auth fails closed, accepts only widget bearer, and every error is private", async () => {
  for (const auth of [null, "", "Bearer bad", `Basic ${secret}`, `Bearer ${secret} extra`]) {
    const res = await GET(request(undefined, auth));
    assert.equal(res.status, 401); privateResponse(res);
    assert.ok(!(await res.text()).includes(secret));
  }
  for (const value of [undefined, "", "short", "a ".repeat(32)]) {
    if (value === undefined) delete process.env.WIDGET_READ_TOKEN;
    else process.env.WIDGET_READ_TOKEN = value;
    const res = await GET(request());
    assert.equal(res.status, 503); privateResponse(res);
  }
  process.env.WIDGET_READ_TOKEN = secret;
  for (const query of ["", "view=bad&size=large", "view=today&size=constructor", "view=today&size=large&size=small", `view=today&size=large&token=${secret}`]) {
    const res = await GET(request(query)); assert.equal(res.status, 400); privateResponse(res);
    assert.ok(!(await res.text()).includes(secret));
  }
  for (const [handler, method] of [[POST, "POST"], [HEAD, "HEAD"]] as const) {
    const res = await handler(request(undefined, undefined, method));
    assert.equal(res.status, 405); assert.equal(res.headers.get("allow"), "GET"); privateResponse(res);
  }
});

test("proxy isolates widget namespace, leaving login and handoff flows intact", async () => {
  const cookie = (await makeSession()).value;
  for (const pathname of ["/api/widget/image", "/api/widget/future"]) {
    const res = await proxy(new NextRequest(`https://agents.383ks.com${pathname}`, { headers: { cookie: `ad_session=${cookie}` } }));
    assert.equal(res.status, 401); privateResponse(res);
  }
  process.env.HANDOFF_TOKEN = "handoff-only";
  assert.equal((await proxy(new NextRequest(request(undefined, "Bearer handoff-only")))).status, 401);
  const accepted = await proxy(new NextRequest(request()));
  assert.equal(accepted.headers.get("x-middleware-next"), "1"); privateResponse(accepted);
  assert.equal((await proxy(new NextRequest("https://agents.383ks.com/api/todos", { headers: { cookie: `ad_session=${cookie}` } }))).headers.get("x-middleware-next"), "1");
  assert.equal((await proxy(new NextRequest("https://agents.383ks.com/api/todos", { headers: { authorization: `Bearer ${secret}` } }))).status, 401);
});

test("snapshot reads all six real sources, local dates, actual focus time; no writes", async () => {
  const before = fs.readFileSync(path.join(dir, `plans/${day}.json`), "utf8");
  const data = await readWidgetData(at);
  assert.equal(data.day, day);
  assert.equal(data.tasks.today[0].title, "Real task");
  assert.equal(data.focus.focusMin, 60);
  assert.equal(data.focus.current?.title, "Real planner block");
  assert.equal(data.goals[0].weekMin, 60);
  assert.equal(data.habits[0].done, true);
  assert.deepEqual(data.calendar.events.map((e) => e.title), ["Real appointment"]);
  assert.ok(widgetContent(data, "today").rows.some((r) => r.title === "Real appointment"));
  assert.ok(widgetContent(data, "goals").rows[0].detail.includes("60/120"));
  assert.ok(widgetContent(data, "focus").rows.some((r) => r.title === "Real finished session"));
  assert.equal(fs.readFileSync(path.join(dir, `plans/${day}.json`), "utf8"), before);
  assert.equal((await readWidgetData(new Date("2026-11-01T23:30:00Z"))).day, "2026-11-02");
});

// Decode RGBA PNG with the standard PNG row filters, without adding a dependency for tests.
function decodePNG(png: Buffer) {
  assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
  assert.equal(png[24], 8); assert.equal(png[25], 6);
  const parts: Buffer[] = [];
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset);
    if (png.toString("ascii", offset + 4, offset + 8) === "IDAT") parts.push(png.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  const raw = inflateSync(Buffer.concat(parts)), stride = width * 4;
  const pixels = Buffer.alloc(height * stride);
  const paeth = (a: number, b: number, c: number) => {
    const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const i = y * stride + x, a = x >= 4 ? pixels[i - 4] : 0, b = y ? pixels[i - stride] : 0, c = y && x >= 4 ? pixels[i - stride - 4] : 0;
      const correction = [0, a, b, Math.floor((a + b) / 2), paeth(a, b, c)][filter];
      pixels[i] = (raw[y * (stride + 1) + x + 1] + correction) & 255;
    }
  }
  return { width, height, pixels };
}

test("all nine view/size PNGs use the design palette, fonts, spacing and render real content offline", async () => {
  const data = await readWidgetData(at);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("Rendering must not call the network"); };
  try {
    for (const view of ["today", "goals", "focus"] as const) for (const size of ["small", "medium", "large"] as const) {
      const element = widgetElement(data, view, size);
      assert.equal(element.props.style.padding, 48); // 16 pt gutter at 3x
      assert.equal(element.props.style.fontFamily, "Geist");
      assert.equal(element.props.style.backgroundColor, "#08080a");
      const res = await renderWidget(data, view, size);
      privateResponse(res); assert.equal(res.headers.get("content-type"), "image/png");
      const png = Buffer.from(await res.arrayBuffer());
      assert.ok(!png.includes(Buffer.from(secret)));
      // Stable fixtures allow a visual review with WIDGET_PREVIEW_DIR, never production data.
      if (process.env.WIDGET_PREVIEW_DIR) {
        fs.mkdirSync(process.env.WIDGET_PREVIEW_DIR, { recursive: true });
        fs.writeFileSync(path.join(process.env.WIDGET_PREVIEW_DIR, `${view}-${size}.png`), png);
      }
      const decoded = decodePNG(png);
      assert.equal(decoded.width, WIDGET_SIZES[size].width); assert.equal(decoded.height, WIDGET_SIZES[size].height);
      const colors = new Set<string>();
      for (let i = 0; i < decoded.pixels.length; i += 4) colors.add(decoded.pixels.subarray(i, i + 3).toString("hex"));
      for (const color of [widgetTheme.bright, widgetTheme.muted, widgetTheme.hud]) assert.ok(colors.has(color.slice(1)), `${view}/${size} missing ${color}`);
      if (process.env.WIDGET_GOLDEN_OUT) fs.appendFileSync(process.env.WIDGET_GOLDEN_OUT, `${view}-${size} ${createHash("sha256").update(png).digest("hex")}\n`);
      else assert.equal(createHash("sha256").update(png).digest("hex"), golden[`${view}-${size}`], "Reviewed visual baseline changed");

    }
  } finally { globalThis.fetch = originalFetch; }
});

test("endpoint success is a private PNG and failures do not log or reflect secrets", async () => {
  const calls: unknown[][] = [];
  const originals = [console.log, console.warn, console.error];
  console.log = console.warn = console.error = (...args: unknown[]) => { calls.push(args); };
  try {
    const res = await GET(request());
    assert.equal(res.status, 200); privateResponse(res);
    decodePNG(Buffer.from(await res.arrayBuffer()));
    process.env.DASHBOARD_TZ = "Invalid/Zone";
    const failure = await GET(request());
    assert.equal(failure.status, 500); privateResponse(failure);
    assert.equal(await failure.text(), '{"error":"Widget unavailable"}');
    assert.deepEqual(calls, []);
  } finally {
    [console.log, console.warn, console.error] = originals;
    process.env.DASHBOARD_TZ = "Europe/Belgrade";
  }
});

test("unsupported private text never reaches dynamic fonts or console", async () => {
  const data = await readWidgetData(at);
  data.blocks[1].title = "Shqip ë ç / 中文 / 🔐 / עברית";
  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  const calls: unknown[] = [];
  globalThis.fetch = async (...args) => { calls.push(args); throw new Error("Unexpected network"); };
  console.error = (...args) => { calls.push(args); };
  try {
    const result = await renderWidget(data, "today", "large");
    assert.equal(result.status, 200);
    assert.deepEqual(calls, []);
  } finally { globalThis.fetch = originalFetch; console.error = originalError; }
});

// Exercise dense and missing-source layouts with synthetic records only. The same renderer and
// offline guarantee apply; previews are deliberately outside public/ and contain no private data.
test("empty, long-title, missing-source and dense goal layouts render in every size", async () => {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const base = await readWidgetData(at);
  const empty = structuredClone(base);
  empty.blocks = []; empty.tasks = { ...empty.tasks, overdue: [], today: [], done: [] };
  empty.goals = []; empty.habits = []; empty.agents = [];
  empty.focus = { ...empty.focus, current: null, next: null, blocks: [], done: 0, total: 0, focusMin: 0, planned: false };
  empty.calendar = { syncedAt: null, events: [] };
  empty.progress = { ...empty.progress, percent: 0, tasksDone: 0, tasksTotal: 0, workLeftMin: 0, overloadMin: 0, pace: "not-started", blocksDone: 0, blocksTotal: 0, focusMin: 0, blocks: undefined };
  const dense = structuredClone(base);
  const long = "WWW Investigate authentication, scheduling and release verification across every connected project ".repeat(5);
  dense.tasks.today = Array.from({ length: 3 }, (_, i) => ({ ...base.tasks.today[0], id: `long-${i}`, title: long, priority: 3 }));
  dense.focus.current!.title = long;
  dense.focus.current!.startedAt = "2026-11-01T11:00:00Z";
  dense.blocks.push({ id: "upcoming", title: long, start: "14:00", end: "15:00", kind: "focus", status: "planned" });
  dense.goals = Array.from({ length: 2 }, (_, i) => ({ ...base.goals[0], goal: { ...base.goals[0].goal, id: `g-${i}`, title: long }, weekMin: i ? 60 : 180, targetMin: 120 }));
  dense.habits = Array.from({ length: 3 }, (_, i) => ({ ...base.habits[0], habit: { ...base.habits[0].habit, id: `h-${i}`, title: long }, streak: 42 }));
  dense.agents = [{ id: "fixture", agent: "codex", title: long, status: "running" }];
  dense.progress = { ...dense.progress, percent: 65, tasksDone: 4, tasksTotal: 7 };
  const missing = structuredClone(dense);
  missing.calendar = { syncedAt: null, events: [] }; missing.goals = [];
  const dueTask = structuredClone(empty);
  dueTask.tasks.today = [{ ...base.tasks.today[0], title: "Next action", due: "2026-11-01T17:00:00Z", priority: 3 }];
  assert.equal(widgetContent(dueTask, "today").nextAction.detail, "Due 01 Nov, 18:00");
  const zeroTarget = structuredClone(dense); zeroTarget.goals[0].targetMin = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("Widget snapshot rendering must stay offline"); };
  try {
    for (const [scenario, data] of Object.entries({ empty, dense, missing, "zero-target": zeroTarget })) {
      for (const size of ["small", "medium", "large"] as const) {
        for (const view of ["today", "goals", "focus"] as const) {
          const markup = renderToStaticMarkup(widgetElement(data, view, size));
          assert.ok(!markup.includes("0/0"));
          assert.ok(!/\+\d+ more/.test(markup));
          assert.ok(markup.includes("Updated") && markup.includes("12:30"));
          if (scenario === "empty") assert.ok(!markup.replace(/<[^>]*>/g, "").includes("0%"));
          if (scenario === "missing" && size !== "small") assert.ok(markup.includes("Calendar unavailable"));
          const png = Buffer.from(await (await renderWidget(data, view, size)).arrayBuffer());
          const decoded = decodePNG(png);
          assert.equal(decoded.height, WIDGET_SIZES[size].height);
          if (process.env.WIDGET_PREVIEW_DIR && view === "today") fs.writeFileSync(path.join(process.env.WIDGET_PREVIEW_DIR, `${scenario}-${size}.png`), png);
        }
      }
    }
    for (const agent of ["claude", "codex", "opencode", "hermes"] as const) {
      dense.agents[0].agent = agent;
      const markup = renderToStaticMarkup(widgetElement(dense, "today", "large"));
      assert.ok(markup.includes(`stroke`) && markup.includes(agent === "opencode" ? "OpenCode" : agent[0].toUpperCase() + agent.slice(1)));
      assert.equal((await renderWidget(dense, "today", "large")).status, 200);
    }
  } finally { globalThis.fetch = originalFetch; }
});

test("snapshot progress uses the real calendar snapshot without network or source writes", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("Snapshot read must stay offline"); };
  try {
    const before = fs.readFileSync(path.join(dir, "sources/calendar.json"), "utf8");
    const data = await readWidgetData(at);
    assert.equal(data.progress.percent, 0); // An elapsed session never completes the task.
    assert.equal(data.progress.tasksTotal, 1);
    assert.equal(data.progress.focusMin, 60);
    assert.equal(data.progress.untilEndMin - data.progress.freeMin, 60);
    assert.equal(data.progress.pace, "behind");
    assert.equal(data.at, at.toISOString());
    assert.equal(fs.readFileSync(path.join(dir, "sources/calendar.json"), "utf8"), before);
    const generated = await readWidgetData();
    assert.ok(Math.abs(Date.now() - Date.parse(generated.at)) < 5000);
  } finally { globalThis.fetch = originalFetch; }
});
