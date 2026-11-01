import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { test } from "node:test";

const source = fs.readFileSync(new URL("../public/widgets/Agentic-OS.js", import.meta.url), "utf8");
const secret = "synthetic-widget-token-" + "a".repeat(40);

async function run({ size = "medium", view = "today", token = secret, inApp = false, fail = false, cancel = false } = {}) {
  const calls = [], messages = [], keys = new Map(token ? [["agent-dashboard.widget-read-token", token]] : []);
  let result, preview = 0, prompts = 0, complete = false;
  class Widget {
    setPadding() {}
    addSpacer() {}
    addText(value) { messages.push(value); return {}; }
    async presentMedium() { preview++; }
  }
  class Request {
    constructor(url) { this.url = url; }
    async loadImage() {
      calls.push(this);
      if (fail) throw new Error(`Sensitive transport failure: ${secret}`);
      this.response = { statusCode: 200 };
      return "fresh-png";
    }
  }
  class Alert {
    addSecureTextField() { prompts++; }
    addAction() {}
    addCancelAction() {}
    async presentAlert() { return cancel ? -1 : 0; }
    textFieldValue() { return secret; }
  }
  const context = vm.createContext({
    args: { widgetParameter: view }, config: { widgetFamily: size, runsInApp: inApp },
    Keychain: { contains: (key) => keys.has(key), get: (key) => keys.get(key), set: (key, value) => keys.set(key, value) },
    ListWidget: Widget, Request, Alert, Color: class { static white() { return "white"; } },
    Script: { setWidget: (widget) => { result = widget; }, complete: () => { complete = true; } },
  });
  await vm.runInContext(`(async () => {${source}\n})()`, context);
  return { result, calls, messages, keys, preview, prompts, complete };
}

test("all nine phone configurations fetch the current private PNG and schedule refresh", async () => {
  for (const size of ["small", "medium", "large"]) {
    for (const view of ["today", "goals", "focus"]) {
      const before = Date.now(), r = await run({ size, view });
      assert.equal(r.calls[0].url, `https://agents.383ks.com/api/widget/image?view=${view}&size=${size}`);
      assert.equal(r.calls[0].headers.Authorization, `Bearer ${secret}`);
      assert.equal(r.calls[0].headers["Cache-Control"], "no-cache");
      assert.equal(r.result.backgroundImage, "fresh-png");
      assert.ok(r.result.refreshAfterDate.getTime() >= before + 300000);
      assert.equal(r.result.url, `https://agents.383ks.com/${view === "today" ? "" : view}`);
      assert.equal(r.complete, true);
    }
  }
});

test("missing credentials prompt only in app and cancellation preserves Keychain", async () => {
  const background = await run({ token: null });
  assert.equal(background.prompts, 0);
  assert.equal(background.calls.length, 0);
  assert.match(background.messages.join(" "), /once to connect/);
  const setup = await run({ token: null, inApp: true });
  assert.equal(setup.keys.get("agent-dashboard.widget-read-token"), secret);
  assert.equal(setup.preview, 1);
  const cancelled = await run({ token: null, inApp: true, cancel: true });
  assert.equal(cancelled.keys.size, 0);
  assert.equal(cancelled.calls.length, 0);
});

test("network failure hides transport details and invalid parameters never make requests", async () => {
  const r = await run({ fail: true });
  assert.match(r.messages.join(" "), /Refresh failed/);
  assert.ok(!r.messages.join(" ").includes(secret));
  assert.equal(r.result.backgroundImage, undefined);
  for (const options of [{ view: "today&token=bad" }, { size: "accessoryCircular" }]) {
    assert.equal((await run(options)).calls.length, 0);
  }
});
