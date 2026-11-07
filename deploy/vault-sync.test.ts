import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import Module from "node:module";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "vault-sync-test-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";

const { createInvite, signUp, tenantOf } = await import("../lib/users");
const { runAs, ownerTenant, vaultDir } = await import("../lib/tenant");
const { newSyncCode, tenantFromSyncCode, safePath, revokeSyncCode } = await import("../lib/vault-sync");
const { crc32, zip } = await import("../lib/zip");
const manifestRoute = await import("../app/api/vault/manifest/route");
const fileRoute = await import("../app/api/vault/file/route");
const pluginRoute = await import("../app/api/vault/plugin/route");

const user = (email: string) => signUp({ email, name: "V", password: "long enough pw", invite: createInvite().code });
const auth = (code: string) => ({ authorization: `Bearer ${code}` });
const U = (p: string, q: Record<string, string> = {}) => `http://x${p}?${new URLSearchParams(q)}`;

test("a sync code opens only its own account's vault, and only the sync routes", async () => {
  const a = user("va@example.com");
  const b = user("vb@example.com");
  const codeA = runAs(tenantOf(a), newSyncCode);
  const codeB = runAs(tenantOf(b), newSyncCode);
  assert.equal(tenantFromSyncCode(codeA)?.id, a.id);
  assert.equal(tenantFromSyncCode(codeA.replace(a.id, b.id)), null, "a code can't be pointed at another account");
  assert.equal(tenantFromSyncCode("adv_owner_xxxxxxxxxxxxxxxxxxxxxxxx"), null);

  runAs(tenantOf(b), () => {
    fs.mkdirSync(path.join(vaultDir(), "Private"), { recursive: true });
    fs.writeFileSync(path.join(vaultDir(), "Private", "diary.md"), "B's diary");
  });
  const put = await fileRoute.PUT(new Request(U("/api/vault/file", { path: "Notes/hello.md", base: "" }), { method: "PUT", headers: auth(codeA), body: "hello from A" }));
  assert.equal(put.status, 200);
  const listA = (await (await manifestRoute.GET(new Request(U("/api/vault/manifest"), { headers: auth(codeA) }))).json()) as { files: { path: string }[] };
  assert.deepEqual(listA.files.map((f) => f.path), ["Notes/hello.md"]);
  const sneak = await fileRoute.GET(new Request(U("/api/vault/file", { path: "Private/diary.md" }), { headers: auth(codeA) }));
  assert.equal(sneak.status, 404, "A's code reads A's vault, where B's diary doesn't exist");
  const bad = await manifestRoute.GET(new Request(U("/api/vault/manifest"), { headers: auth("adv_u_0000000000000000_nonsensenonsensenonsense") }));
  assert.equal(bad.status, 401);
  runAs(tenantOf(a), revokeSyncCode);
  assert.equal(tenantFromSyncCode(codeA), null, "unpairing stops the code");
  assert.equal(tenantFromSyncCode(codeB)?.id, b.id);
});

test("paths can't leave the vault or touch Obsidian's own folders", () => {
  const a = user("paths@example.com");
  runAs(tenantOf(a), () => {
    for (const p of ["../x.md", "a/../../x.md", "/etc/passwd.md", ".obsidian/plugins/x.md", "a/.hidden/x.md", "C:/x.md", "a\\b.md", "note.exe", "", "a//b.md"]) {
      assert.throws(() => safePath(p), Error, p);
    }
    assert.ok(safePath("Journal/2026-11-07.md").endsWith(path.join("vault", "Journal", "2026-11-07.md")));
  });
});

test("a write based on an old copy is refused, so an edit on the server is never overwritten", async () => {
  const a = user("stale@example.com");
  const code = runAs(tenantOf(a), newSyncCode);
  const r1 = (await (await fileRoute.PUT(new Request(U("/api/vault/file", { path: "Goals.md", base: "" }), { method: "PUT", headers: auth(code), body: "v1" }))).json()) as { hash: string };
  const again = await fileRoute.PUT(new Request(U("/api/vault/file", { path: "Goals.md", base: "" }), { method: "PUT", headers: auth(code), body: "v1 from another device" }));
  assert.equal(again.status, 409);
  const ok = await fileRoute.PUT(new Request(U("/api/vault/file", { path: "Goals.md", base: r1.hash }), { method: "PUT", headers: auth(code), body: "v2" }));
  assert.equal(ok.status, 200);
  const del = await fileRoute.DELETE(new Request(U("/api/vault/file", { path: "Goals.md", base: r1.hash }), { method: "DELETE", headers: auth(code) }));
  assert.equal(del.status, 409, "deleting a copy you never saw is refused");
  const big = await fileRoute.PUT(new Request(U("/api/vault/file", { path: "Big.md", base: "" }), { method: "PUT", headers: auth(code), body: "x".repeat(2 * 1024 * 1024 + 1) }));
  assert.equal(big.status, 413);
});

test("the owner's Syncthing vault is never touched by the plugin routes", async () => {
  const res = await runAs(ownerTenant(), () => manifestRoute.GET(new Request(U("/api/vault/manifest"))));
  assert.equal(res.status, 400);
  assert.throws(() => runAs(ownerTenant(), newSyncCode));
});

test("the zip is a valid archive with the plugin and this account's settings", async () => {
  assert.equal(crc32(Buffer.from("123456789")).toString(16), "cbf43926");
  const a = user("zip@example.com");
  const res = await runAs(tenantOf(a), () => pluginRoute.POST(new Request("http://x/api/vault/plugin", { method: "POST", headers: { "x-forwarded-host": "agents.example.com", "x-forwarded-proto": "https" } })));
  const buf = Buffer.from(await res.arrayBuffer());
  assert.equal(buf.readUInt32LE(0), 0x04034b50);
  assert.equal(buf.readUInt32LE(buf.length - 22), 0x06054b50);
  assert.equal(buf.readUInt16LE(buf.length - 22 + 10), 3);
  const text = buf.toString("utf8");
  assert.match(text, /agentic-os-sync\/main\.js/);
  const settings = JSON.parse(/\{\s*"server"[\s\S]*?"last": \{\}\s*\}/.exec(text)![0]);
  assert.equal(settings.server, "https://agents.example.com");
  assert.equal(tenantFromSyncCode(settings.code)?.id, a.id);
  assert.ok(zip([{ name: "a.txt", data: Buffer.from("a") }]).length > 0);
});

// ---- the plugin itself, against the real routes ---------------------------------------------------------

class TAbstractFile {
  constructor(public path: string) {}
}
class TFile extends TAbstractFile {}
class TFolder extends TAbstractFile {}

function fakeObsidian(code: string) {
  const files = new Map<string, Buffer>();
  const folders = new Set<string>();
  const trashed: string[] = [];
  const toAB = (b: Buffer) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  const vault = {
    getFiles: () => [...files.keys()].map((p) => new TFile(p)),
    getAbstractFileByPath: (p: string) => (files.has(p) ? new TFile(p) : folders.has(p) ? new TFolder(p) : null),
    readBinary: async (f: TFile) => toAB(files.get(f.path)!),
    modifyBinary: async (f: TFile, d: ArrayBuffer) => void files.set(f.path, Buffer.from(d)),
    createBinary: async (p: string, d: ArrayBuffer) => {
      if (files.has(p)) throw new Error("exists");
      files.set(p, Buffer.from(d));
    },
    createFolder: async (p: string) => void folders.add(p),
    trash: async (f: TFile) => {
      trashed.push(f.path);
      files.delete(f.path);
    },
    on: () => ({}),
  };
  const routes: Record<string, Record<string, (r: Request) => Promise<Response>>> = {
    "/api/vault/manifest": { GET: manifestRoute.GET as never },
    "/api/vault/file": { GET: fileRoute.GET as never, PUT: fileRoute.PUT as never, DELETE: fileRoute.DELETE as never },
  };
  const requestUrl = async (o: { url: string; method: string; headers: Record<string, string>; body?: ArrayBuffer }) => {
    const u = new URL(o.url);
    const res = await routes[u.pathname][o.method](new Request(o.url, { method: o.method, headers: o.headers, body: o.body }));
    const ab = await res.arrayBuffer();
    const text = Buffer.from(ab).toString("utf8");
    return { status: res.status, arrayBuffer: ab, text, get json() { return JSON.parse(text); } };
  };
  class Plugin {
    app = { vault, workspace: { onLayoutReady: () => {} } };
    data: unknown = { server: "https://agents.example.com", code, everyMin: 5, last: {} };
    async loadData() {
      return this.data;
    }
    async saveData(d: unknown) {
      this.data = JSON.parse(JSON.stringify(d));
    }
    addStatusBarItem() {
      return { setText: () => {} };
    }
    addRibbonIcon() {}
    addCommand() {}
    addSettingTab() {}
    registerEvent() {}
    registerInterval() {}
  }
  const notices: string[] = [];
  const mod = { Plugin, PluginSettingTab: class {}, Setting: class {}, Notice: class { constructor(m: string) { notices.push(m); } }, requestUrl, TFile, TFolder };
  return { mod, files, trashed, notices };
}

async function loadPlugin(code: string) {
  const fake = fakeObsidian(code);
  const M = Module as unknown as { _load: (req: string, ...rest: unknown[]) => unknown };
  const orig = M._load;
  M._load = (req: string, ...rest: unknown[]) => (req === "obsidian" ? fake.mod : orig(req, ...rest));
  const req = createRequire(import.meta.url);
  const file = path.join(process.cwd(), "obsidian-plugin", "main.js");
  delete req.cache[req.resolve(file)];
  const Cls = req(file) as new () => { onload(): Promise<void>; sync(byHand: boolean): Promise<void>; onunload(): void };
  M._load = orig;
  const p = new Cls();
  (globalThis as { window?: unknown }).window = { setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {} };
  await p.onload();
  return { p, ...fake };
}

test("the plugin syncs both ways, keeps both sides of a conflict, and passes deletes through", async () => {
  const a = user("plugin@example.com");
  const code = runAs(tenantOf(a), newSyncCode);
  const server = (rel: string) => runAs(tenantOf(a), () => path.join(vaultDir(), rel));
  fs.mkdirSync(path.dirname(server("000 - Journal/2026-11-07.md")), { recursive: true });
  fs.writeFileSync(server("000 - Journal/2026-11-07.md"), "Written by Buddy");

  const { p, files, trashed } = await loadPlugin(code);
  files.set("Ideas.md", Buffer.from("my idea"));
  files.set(".obsidian/workspace.json", Buffer.from("{}")); // never synced
  await p.sync(true);
  assert.equal(files.get("000 - Journal/2026-11-07.md")?.toString(), "Written by Buddy", "the dashboard's journal arrives in the vault");
  assert.equal(fs.readFileSync(server("Ideas.md"), "utf8"), "my idea", "the vault's note reaches the dashboard");
  assert.ok(!fs.existsSync(server(".obsidian/workspace.json")));

  // Edited only here → uploaded. Edited only on the dashboard → downloaded.
  files.set("Ideas.md", Buffer.from("my idea, v2"));
  fs.writeFileSync(server("000 - Journal/2026-11-07.md"), "Buddy added a line");
  await p.sync(false);
  assert.equal(fs.readFileSync(server("Ideas.md"), "utf8"), "my idea, v2");
  assert.equal(files.get("000 - Journal/2026-11-07.md")?.toString(), "Buddy added a line");

  // Both changed → the dashboard's keeps the name, the vault's is kept as a conflict copy, and uploaded next time.
  files.set("Ideas.md", Buffer.from("edited in Obsidian"));
  fs.writeFileSync(server("Ideas.md"), "edited on the dashboard");
  await p.sync(false);
  assert.equal(files.get("Ideas.md")?.toString(), "edited on the dashboard");
  const copy = [...files.keys()].find((k) => k.startsWith("Ideas (conflict "));
  assert.ok(copy, "your version is kept");
  assert.equal(files.get(copy!)?.toString(), "edited in Obsidian");
  await p.sync(false);
  assert.equal(fs.readFileSync(server(copy!), "utf8"), "edited in Obsidian");

  // Deleted here → deleted there; deleted there → moved to the vault's trash here.
  files.delete(copy!);
  fs.rmSync(server("000 - Journal/2026-11-07.md"));
  await p.sync(false);
  assert.ok(!fs.existsSync(server(copy!)));
  assert.deepEqual(trashed, ["000 - Journal/2026-11-07.md"]);
  p.onunload();
});
