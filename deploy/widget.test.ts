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

test("snapshot reads all six real sources, local dates, actual focus time; no writes", () => {
  const before = fs.readFileSync(path.join(dir, `plans/${day}.json`), "utf8");
  const data = readWidgetData(at);
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
  assert.equal(readWidgetData(new Date("2026-11-01T23:30:00Z")).day, "2026-11-02");
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
  const data = readWidgetData(at);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("Rendering must not call the network"); };
  try {
    for (const view of ["today", "goals", "focus"] as const) for (const size of ["small", "medium", "large"] as const) {
      const element = widgetElement(data, view, size);
      assert.equal(element.props.style.padding, 32); // 16 pt gutter at 2x
      assert.equal(element.props.style.fontFamily, "Geist");
      assert.equal(element.props.style.backgroundColor, "#08080a");
      const res = await renderWidget(data, view, size);
      privateResponse(res); assert.equal(res.headers.get("content-type"), "image/png");
      const png = Buffer.from(await res.arrayBuffer());
      assert.ok(!png.includes(Buffer.from(secret)));
      const decoded = decodePNG(png);
      assert.equal(decoded.width, WIDGET_SIZES[size].width); assert.equal(decoded.height, WIDGET_SIZES[size].height);
      const colors = new Set<string>();
      for (let i = 0; i < decoded.pixels.length; i += 4) colors.add(decoded.pixels.subarray(i, i + 3).toString("hex"));
      for (const color of [widgetTheme.text, widgetTheme.faint, widgetTheme.hud]) assert.ok(colors.has(color.slice(1)), `${view}/${size} missing ${color}`);
      assert.equal(createHash("sha256").update(png).digest("hex"), golden[`${view}-${size}`], "Reviewed visual baseline changed");
      // Stable fixtures allow a visual review with WIDGET_PREVIEW_DIR, never production data.
      if (process.env.WIDGET_PREVIEW_DIR) {
        fs.mkdirSync(process.env.WIDGET_PREVIEW_DIR, { recursive: true });
        fs.writeFileSync(path.join(process.env.WIDGET_PREVIEW_DIR, `${view}-${size}.png`), png);
      }
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
  const data = readWidgetData(at);
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
