#!/usr/bin/env node
// Brain collector (plan §D1), runs on the PC from Task Scheduler (at logon + every 2 h, hidden).
// Finds every Claude Code and Codex chat on this PC (terminal and desktop app) plus graphify reports,
// condenses and redacts them HERE, and uploads the text to the dashboard, which writes the vault pages.
// Raw transcripts never leave the PC this way; only condensed, redacted text does.
//
//   node brain-collect.mjs              upload chats quiet for 20+ min that changed since last time
//   node brain-collect.mjs --dry-run    list what would be sent
//   node brain-collect.mjs --status     the brain's status on the VPS
//   node brain-collect.mjs --install    register the two scheduled tasks
//
// Reads HANDOFF_TOKEN and AGENT_DASHBOARD_URL from ~/.agent-dashboard/handoff.env. Node 24+.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const lib = fs.existsSync(path.join(here, "redact.ts")) ? here : path.join(here, "..", "lib");
const { redact } = await import(new URL(`file:///${path.join(lib, "redact.ts").replace(/\\/g, "/")}`).href);
const { parseTranscript, condense, titleOf } = await import(new URL(`file:///${path.join(lib, "transcript.ts").replace(/\\/g, "/")}`).href);

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
  for (const [name, trigger] of [
    ["AgentDashboard Brain (logon)", ["/SC", "ONLOGON"]],
    ["AgentDashboard Brain (2h)", ["/SC", "HOURLY", "/MO", "2"]],
  ]) {
    execFileSync("schtasks", ["/Create", "/F", "/TN", name, "/TR", cmd, ...trigger, "/RL", "LIMITED"], { stdio: "inherit" });
  }
  console.log("✓ Scheduled: at logon and every 2 hours. Log: ~/.agent-dashboard/brain-collect.log");
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
