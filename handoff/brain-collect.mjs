#!/usr/bin/env node
// Brain collector (plan §D1), runs on the PC from Task Scheduler (every 2 h, hidden).
// Finds every Claude Code and Codex chat on this PC (terminal and desktop app) plus graphify reports,
// condenses and redacts them HERE, and uploads the text to the dashboard, which writes the vault pages.
// Raw transcripts never leave the PC this way; only condensed, redacted text does.
//
//   node brain-collect.mjs              upload chats quiet for 20+ min that changed since last time
//   node brain-collect.mjs --dry-run    list what would be sent
//   node brain-collect.mjs --status     the brain's status on the VPS
//   node brain-collect.mjs --install    register the scheduled task (every 2 h)
//   node brain-collect.mjs --skills     sync your Claude + Codex skills and the plugin/hook/MCP manifest now
//   node brain-collect.mjs --no-update  skip the self-update (the installed copy updates itself from the dashboard each run)
//                                       (otherwise they sync on any run where a skill changed)
//
// Reads HANDOFF_TOKEN and AGENT_DASHBOARD_URL from ~/.agent-dashboard/handoff.env. Node 24+.

import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const lib = fs.existsSync(path.join(here, "redact.ts")) ? here : path.join(here, "..", "lib");
// The libs load after the self-update (below), so a release whose libs don't load still gets replaced
// by the next fix instead of stopping the collector for good.
const loadLibs = async () => ({
  ...(await import(new URL(`file:///${path.join(lib, "redact.ts").replace(/\\/g, "/")}`).href)),
  ...(await import(new URL(`file:///${path.join(lib, "transcript.ts").replace(/\\/g, "/")}`).href)),
});
// Used by the self-update: a staged new version must at least load with its libs before it's swapped in.
if (process.argv.includes("--self-test")) {
  const l = await loadLibs();
  const ok = ["redact", "parseTranscript", "condense", "titleOf"].every((k) => typeof l[k] === "function");
  console.log(ok ? "self-test ok" : "self-test: missing exports");
  process.exit(ok ? 0 : 1);
}

const HOME = os.homedir();
const STATE_DIR = path.join(HOME, ".agent-dashboard");
const STATE_FILE = path.join(STATE_DIR, "brain-state.json");
const LOG_FILE = path.join(STATE_DIR, "brain-collect.log");
const CLAUDE_PROJECTS = path.join(HOME, ".claude", "projects");
const CODEX_SESSIONS = path.join(HOME, ".codex", "sessions");
const QUIET_MS = 20 * 60_000;
const MAX_UPLOADS = Number(process.env.BRAIN_MAX_UPLOADS ?? 60); // per run; the rest go next run
const TEXT_CAP = 3_500_000;

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);

const env = (() => {
  try {
    return Object.fromEntries(
      fs
        .readFileSync(path.join(STATE_DIR, "handoff.env"), "utf8")
        .split(/\r?\n/)
        .filter((l) => l.includes("="))
        .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
    );
  } catch {
    return {};
  }
})();
const BASE = env.AGENT_DASHBOARD_URL ?? "https://agents.383ks.com";

const out = (msg) => {
  console.log(msg);
  try {
    fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} ${msg}\n`);
  } catch {
    /* logging is best-effort */
  }
};

if (flag("install")) {
  // conhost --headless keeps the console window from flashing up every 2 hours.
  const cmd = `conhost.exe --headless "${process.execPath}" "${path.join(STATE_DIR, "brain-collect.mjs")}"`;
  // Every 2 hours, starting now (an at-logon trigger would need an admin prompt; 2 h covers it).
  try {
    execFileSync("schtasks", ["/Create", "/F", "/TN", "AgentDashboard Brain", "/TR", cmd, "/SC", "HOURLY", "/MO", "2"], { stdio: ["ignore", "inherit", "pipe"] });
  } catch (err) {
    console.error(`✗ schtasks: ${String(err.stderr ?? err.message).trim()}`);
    process.exit(1);
  }
  console.log("✓ Scheduled every 2 hours (task \"AgentDashboard Brain\"). Log: ~/.agent-dashboard/brain-collect.log");
  process.exit(0);
}

const api = async (p, init) => {
  const res = await fetch(`${BASE}/api/brain/${p}`, { ...init, headers: { Authorization: `Bearer ${env.HANDOFF_TOKEN}`, ...(init?.headers ?? {}) } });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
  return body;
};

if (flag("status")) {
  console.log(JSON.stringify(await api("status"), null, 2));
  process.exit(0);
}
if (!env.HANDOFF_TOKEN && !flag("dry-run")) {
  out("✗ Missing HANDOFF_TOKEN in ~/.agent-dashboard/handoff.env");
  process.exit(1);
}

// Single instance: a lock with our pid; a lock left by a dead process is taken over.
const lock = path.join(STATE_DIR, "brain-collect.lock");
try {
  fs.writeFileSync(lock, String(process.pid), { flag: "wx" });
} catch {
  const pid = Number(fs.readFileSync(lock, "utf8"));
  let alive = false;
  try {
    process.kill(pid, 0);
    alive = true;
  } catch {
    /* gone */
  }
  if (alive) {
    console.log(`Another collector is running (pid ${pid}).`);
    process.exit(0);
  }
  fs.writeFileSync(lock, String(process.pid));
}
process.on("exit", () => fs.rmSync(lock, { force: true }));

// ---------- Self-update ----------
// The installed copy (~/.agent-dashboard, run by the scheduled task) keeps itself and the other PC scripts
// in step with the deployed dashboard, so a dashboard update never needs a command on the PC. Only files
// already installed here are replaced (plus the two libs they import). Before anything is swapped, every
// staged .mjs must parse and the staged collector must load with the staged libs; the old copies stay
// next to them as <name>.prev. A copy run from a repo checkout never updates itself. It runs first, so even a
// version that breaks later in the run still gets replaced by the next fix.
const UPDATABLE = ["brain-collect.mjs", "handoff.mjs", "takeback.mjs", "sync-notes.mjs", "google-auth.mjs", "redact.ts", "transcript.ts"];
const sameDir = (a, b) => (process.platform === "win32" ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b));
if (sameDir(fileURLToPath(new URL(".", import.meta.url)), STATE_DIR) && !flag("no-update") && !flag("dry-run")) {
  try {
    const res = await fetch(`${BASE}/api/brain/collector`, { headers: { Authorization: `Bearer ${env.HANDOFF_TOKEN}` }, signal: AbortSignal.timeout(30_000) });
    const body = await res.json().catch(() => null);
    if (!res.ok || typeof body?.files !== "object" || !body.files) throw new Error(body?.error ?? `HTTP ${res.status}`);
    const current = (n) => {
      try {
        return fs.readFileSync(path.join(STATE_DIR, n), "utf8");
      } catch {
        return null;
      }
    };
    const installed = (n) => n === "redact.ts" || n === "transcript.ts" || current(n) !== null;
    const changed = UPDATABLE.filter((n) => typeof body.files[n] === "string" && body.files[n].length > 0 && installed(n) && current(n) !== body.files[n]);
    if (changed.length) {
      const stage = fs.mkdtempSync(path.join(STATE_DIR, ".update-"));
      try {
        for (const n of UPDATABLE) {
          const text = changed.includes(n) ? body.files[n] : current(n);
          if (text !== null) fs.writeFileSync(path.join(stage, n), text);
        }
        for (const n of UPDATABLE.filter((x) => x.endsWith(".mjs") && fs.existsSync(path.join(stage, x)))) {
          execFileSync(process.execPath, ["--check", path.join(stage, n)], { stdio: "pipe", timeout: 30_000 });
        }
        execFileSync(process.execPath, [path.join(stage, "brain-collect.mjs"), "--self-test"], { stdio: "pipe", timeout: 60_000 });
        // Libs first, the collector last; if any swap fails, the ones already done are put back.
        const order = [...changed].sort((x, y) => Number(x === "brain-collect.mjs") - Number(y === "brain-collect.mjs") || Number(y.endsWith(".ts")) - Number(x.endsWith(".ts")));
        const done = [];
        try {
          for (const n of order) {
            const dest = path.join(STATE_DIR, n);
            const had = fs.existsSync(dest);
            if (had) fs.copyFileSync(dest, `${dest}.prev`);
            fs.renameSync(path.join(stage, n), dest);
            done.push([n, had]);
          }
        } catch (err) {
          for (const [n, had] of done.reverse()) {
            const dest = path.join(STATE_DIR, n);
            if (had) fs.copyFileSync(`${dest}.prev`, dest);
            else fs.rmSync(dest, { force: true });
          }
          throw err;
        }
      } finally {
        fs.rmSync(stage, { recursive: true, force: true });
      }
      out(`brain-collect: updated ${changed.join(", ")} from the dashboard${body.build ? ` (build ${String(body.build).slice(0, 7)})` : ""}`);
    }
  } catch (err) {
    // A staged version that failed its checks: say why in one line, keep running the current one.
    const why = `${err.stderr ?? ""}\n${err.stdout ?? ""}`.split("\n").find((l) => /Error|self-test/.test(l));
    out(`  ✗ self-update: ${why ? `new version rejected, keeping this one (${why.trim().slice(0, 200)})` : err.message}`);
  }
}

const { redact, parseTranscript, condense, titleOf } = await loadLibs();

const state = (() => {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return { files: {} };
  }
})();
state.files ??= {};
const saveState = () => {
  fs.writeFileSync(`${STATE_FILE}.tmp`, JSON.stringify(state));
  fs.renameSync(`${STATE_FILE}.tmp`, STATE_FILE);
};

function walk(dir, depth, pred, acc = []) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory() && depth > 0 && !["memory", "subagents", "node_modules", ".git"].includes(e.name)) walk(p, depth - 1, pred, acc);
    else if (e.isFile() && pred(e.name, p)) acc.push(p);
  }
  return acc;
}

const projectCache = new Map();
function projectOf(cwd) {
  if (!cwd) return "misc";
  if (projectCache.has(cwd)) return projectCache.get(cwd);
  let name = path.basename(cwd.replace(/[\\/]+$/, "")) || "misc";
  try {
    const url = execFileSync("git", ["remote", "get-url", "origin"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    name = url.match(/github\.com[:/][^/]+\/([^/]+?)(?:\.git)?$/)?.[1] ?? name;
  } catch {
    /* not a repo, or the folder is gone */
  }
  if (path.resolve(cwd) === path.resolve(HOME)) name = "home";
  projectCache.set(cwd, name);
  return name;
}

const capText = (t) => (t.length <= TEXT_CAP ? t : `${t.slice(0, TEXT_CAP * 0.25)}\n\n…(middle of a very long chat omitted)…\n\n${t.slice(-TEXT_CAP * 0.75)}`);

// ---------- candidates ----------

const chats = [
  ...walk(CLAUDE_PROJECTS, 1, (n) => n.endsWith(".jsonl")).map((f) => ({ f, agent: "claude" })),
  ...walk(CODEX_SESSIONS, 3, (n) => n.startsWith("rollout-") && n.endsWith(".jsonl")).map((f) => ({ f, agent: "codex" })),
];
const graphs = [path.join(HOME, "Desktop"), path.join(HOME, "Documents")].flatMap((d) => walk(d, 4, (n, p) => n === "GRAPH_REPORT.md" && p.includes(`graphify-out`)));

const todo = [];
let unreadable = 0;
for (const { f, agent } of chats) {
  let st;
  try {
    st = fs.statSync(f);
  } catch {
    unreadable++;
    continue;
  }
  const prev = state.files[f];
  if (prev && prev.size === st.size && prev.mtimeMs === st.mtimeMs) continue; // unchanged since we last looked
  if (Date.now() - st.mtimeMs < QUIET_MS) continue; // still being written
  todo.push({ f, agent, st, kind: "chat" });
}
for (const f of graphs) {
  const st = fs.statSync(f);
  const prev = state.files[f];
  if (prev && prev.size === st.size && prev.mtimeMs === st.mtimeMs) continue;
  todo.push({ f, agent: "graphify", st, kind: "graph" });
}
todo.sort((a, b) => b.st.mtimeMs - a.st.mtimeMs); // newest first: recent work matters most

out(`brain-collect: ${chats.length} chats + ${graphs.length} graph reports on this PC, ${todo.length} new or changed${unreadable ? `, ${unreadable} unreadable` : ""}`);

let sent = 0;
let skipped = 0;
let failed = 0;
let redactions = 0;
for (const t of todo) {
  if (sent >= MAX_UPLOADS) break;
  const mark = () => (state.files[t.f] = { size: t.st.size, mtimeMs: t.st.mtimeMs, at: new Date().toISOString() });
  try {
    let item;
    if (t.kind === "graph") {
      const repoDir = path.dirname(path.dirname(t.f));
      const r = redact(fs.readFileSync(t.f, "utf8").slice(0, 1_000_000));
      redactions += Object.values(r.hits).reduce((a, b) => a + b, 0);
      const project = projectOf(repoDir);
      item = { kind: "graph", id: project.replace(/[^\w.-]/g, "_"), agent: "graphify", title: `${project} code graph`, project, firstAt: t.st.mtime.toISOString(), lastAt: t.st.mtime.toISOString(), text: r.text, source: t.f };
    } else {
      if (t.st.size > 400 * 1024 * 1024) {
        out(`  skip (too large, ${(t.st.size / 1e6).toFixed(0)} MB): ${t.f}`);
        mark();
        skipped++;
        continue;
      }
      const raw = fs.readFileSync(t.f, "utf8");
      // Codex sub-agent rollouts are part of their parent chat.
      if (t.agent === "codex" && /"source":\{[^}]*"subagent/.test(raw.slice(0, 20000))) {
        mark();
        skipped++;
        continue;
      }
      const items = parseTranscript(raw, t.agent);
      const said = items.filter((i) => i.role === "you");
      const userChars = said.reduce((n, i) => n + i.text.length, 0);
      // `claude -p` / `codex exec` with a single prompt is a pipeline run (383's article editor etc.),
      // not a conversation. Resumed ones (the Telegram bridge) have several prompts and are kept.
      const scripted = /"entrypoint":"sdk-|"originator":"codex_exec"/.test(raw.slice(0, 20000));
      if (userChars < 200 || !items.some((i) => i.role === "agent") || (scripted && said.length < 2)) {
        mark(); // trivial, scripted, or a run that never answered
        skipped++;
        continue;
      }
      const cwds = [...raw.matchAll(/"cwd":"((?:[^"\\]|\\.)*)"/g)].map((m) => JSON.parse(`"${m[1]}"`));
      const id = t.agent === "claude" ? path.basename(t.f, ".jsonl") : (t.f.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/)?.[1] ?? path.basename(t.f, ".jsonl"));
      const r = redact(condense(items));
      redactions += Object.values(r.hits).reduce((a, b) => a + b, 0);
      const times = items.map((i) => i.at).filter(Boolean);
      item = {
        kind: "chat",
        id,
        agent: t.agent,
        title: titleOf(items),
        project: projectOf(cwds.at(-1) ?? ""),
        firstAt: times[0] ?? t.st.birthtime.toISOString(),
        lastAt: times.at(-1) ?? t.st.mtime.toISOString(),
        text: capText(r.text),
        source: t.f,
      };
    }
    if (flag("dry-run")) {
      out(`  would send ${item.kind} ${item.agent} ${item.project}: ${item.title.slice(0, 80)} (${(item.text.length / 1e3).toFixed(0)} KB)`);
      sent++;
      continue;
    }
    await api("ingest", { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: zlib.gzipSync(Buffer.from(JSON.stringify(item))) });
    mark();
    saveState();
    sent++;
  } catch (err) {
    failed++;
    out(`  ✗ ${t.f}: ${err.message}`);
  }
}
if (!flag("dry-run")) saveState();
out(`brain-collect: ${flag("dry-run") ? "would send" : "sent"} ${sent}, skipped ${skipped} trivial/sub-agent, ${failed} failed, ${redactions} secrets redacted${todo.length - sent - skipped - failed > 0 ? `, ${todo.length - sent - skipped - failed} left for the next run` : ""}`);

// ---------- skills + manifest (PLAN-v2 R21) ----------
// Your Claude and Codex skill folders go to the VPS agents (text files only, structure kept), plus a
// manifest of plugins, hooks and MCP servers (names and commands only — nothing is installed from it).
// Uploaded only when something changed since the last run.

const postSkills = async (body) => {
  const res = await fetch(`${BASE}/api/skills/sync`, { method: "POST", headers: { Authorization: `Bearer ${env.HANDOFF_TOKEN}`, "Content-Type": "application/octet-stream" }, body });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `HTTP ${res.status}`);
};

const TEXT_EXT = /\.(md|txt|json|js|mjs|cjs|ts|py|sh|ya?ml|toml|csv|html|css|xml|sql|tsx|jsx)$/i;

function skillFiles(dir) {
  const files = {};
  const visit = (d, rel) => {
    let entries = [];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith(".") || e.name === "node_modules" || e.name === "__pycache__") continue;
      const p = path.join(d, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) visit(p, r);
      else if (e.isFile() && TEXT_EXT.test(e.name) && fs.statSync(p).size <= 256 * 1024) files[r] = fs.readFileSync(p, "utf8");
    }
  };
  visit(dir, "");
  return files;
}

function skillDirs(roots) {
  const out = {};
  for (const root of roots) {
    let entries = [];
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.isDirectory() && !e.name.startsWith(".") && fs.existsSync(path.join(root, e.name, "SKILL.md")) && !out[e.name]) out[e.name] = path.join(root, e.name);
    }
  }
  return out;
}

// Every collected file's path, size and mtime: adding, editing or deleting any file changes it.
const fingerprint = (dirs) => {
  const h = crypto.createHash("sha256");
  for (const [n, d] of Object.entries(dirs).sort()) {
    const visit = (x, rel) => {
      let entries = [];
      try {
        entries = fs.readdirSync(x, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
      } catch {
        return;
      }
      for (const e of entries) {
        if (e.name.startsWith(".") || e.name === "node_modules" || e.name === "__pycache__") continue;
        const p = path.join(x, e.name);
        if (e.isDirectory()) visit(p, `${rel}/${e.name}`);
        else if (e.isFile() && TEXT_EXT.test(e.name)) {
          const st = fs.statSync(p);
          h.update(`${n}${rel}/${e.name}|${st.size}|${Math.round(st.mtimeMs)}\n`);
        }
      }
    };
    visit(d, "");
  }
  return h.digest("hex");
};

async function uploadSkills(agent, dirs) {
  const names = Object.keys(dirs);
  let batch = {};
  let size = 0;
  const flush = async (force = false) => {
    if (!Object.keys(batch).length && !force) return;
    // `names` is the complete inventory on the PC, so the VPS can prune skills you deleted.
    const body = zlib.gzipSync(Buffer.from(JSON.stringify({ kind: "skills", agent, names, complete: true, skills: batch })));
    await postSkills(body);
    batch = {};
    size = 0;
  };
  for (const [name, dir] of Object.entries(dirs)) {
    const files = skillFiles(dir);
    const bytes = Object.values(files).reduce((n, t) => n + t.length, 0);
    if (size + bytes > 20 * 1024 * 1024) await flush(); // keeps each gzipped upload well under the 9 MB limit
    batch[name] = files;
    size += bytes;
  }
  // An empty set still goes up, so removing your last skill reaches the VPS too.
  await flush(names.length === 0);
  return names.length;
}

function manifest() {
  const readJSON = (f) => {
    try {
      return JSON.parse(fs.readFileSync(f, "utf8"));
    } catch {
      return null;
    }
  };
  const settings = readJSON(path.join(HOME, ".claude", "settings.json")) ?? {};
  const claudeJson = readJSON(path.join(HOME, ".claude.json")) ?? {};
  let codexToml = "";
  try {
    codexToml = fs.readFileSync(path.join(HOME, ".codex", "config.toml"), "utf8");
  } catch {
    /* no codex */
  }
  const hooks = Object.fromEntries(
    Object.entries(settings.hooks ?? {}).map(([event, groups]) => [
      event,
      (Array.isArray(groups) ? groups : []).flatMap((g) => (g?.hooks ?? []).map((h) => ({ matcher: g?.matcher ?? "", command: redact(String(h?.command ?? "")).text.slice(0, 300) }))),
    ]),
  );
  return {
    kind: "manifest",
    at: new Date().toISOString(),
    plugins: Object.entries(settings.enabledPlugins ?? {}).filter(([, on]) => on).map(([p]) => p),
    hooks,
    mcp: { claude: Object.keys(claudeJson.mcpServers ?? {}), codex: [...codexToml.matchAll(/^\[mcp_servers\.([^\].]+)\]/gm)].map((m) => m[1]) },
    skills: { claude: Object.keys(skillDirs([path.join(HOME, ".claude", "skills")])).length, codex: Object.keys(skillDirs([path.join(HOME, ".codex", "skills"), path.join(HOME, ".agents", "skills")])).length },
  };
}

if (!flag("dry-run") || flag("skills")) {
  try {
    const sets = {
      claude: skillDirs([path.join(HOME, ".claude", "skills")]),
      codex: skillDirs([path.join(HOME, ".codex", "skills"), path.join(HOME, ".agents", "skills")]),
    };
    state.skills ??= {};
    for (const agent of ["claude", "codex"]) {
      const fp = fingerprint(sets[agent]);
      if (state.skills[agent] === fp && !flag("skills")) continue;
      if (flag("dry-run")) {
        out(`  would sync ${Object.keys(sets[agent]).length} ${agent} skills`);
        continue;
      }
      const n = await uploadSkills(agent, sets[agent]);
      state.skills[agent] = fp;
      saveState();
      out(`brain-collect: synced ${n} ${agent} skills to the VPS`);
    }
    if (!flag("dry-run")) {
      const m = manifest();
      const mfp = JSON.stringify({ ...m, at: undefined });
      if (state.manifest !== mfp || flag("skills")) {
        await postSkills(zlib.gzipSync(Buffer.from(JSON.stringify(m))));
        state.manifest = mfp;
        saveState();
        out(`brain-collect: sent the manifest (${m.plugins.length} plugins, ${Object.keys(m.hooks).length} hook events, ${m.mcp.claude.length + m.mcp.codex.length} MCP servers)`);
      }
    }
  } catch (err) {
    out(`  ✗ skills sync: ${err.message}`);
  }
}
