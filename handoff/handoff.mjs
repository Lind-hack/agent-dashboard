#!/usr/bin/env node
// Hand-off v2: sends one Claude Code or Codex chat from this PC to the agent dashboard on the VPS, where
// it continues with the full conversation, the PC's uncommitted code, Lind's memory/rules/skills and a
// project-wide context bundle (the VPS turns it into a dossier). Manual only — nothing runs on its own.
//
//   node handoff.mjs --detect                 chats in this repo that could be handed off (JSON)
//   node handoff.mjs --list [--days 14]       every recent Claude/Codex chat on this PC
//   node handoff.mjs --session <id> [--title "…"] [--no-code] [--allow-secrets] [--dry-run]
//
// Reads HANDOFF_TOKEN and AGENT_DASHBOARD_URL from ~/.agent-dashboard/handoff.env. Needs Node 24+
// (runs the shared .ts helpers directly).

import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const lib = fs.existsSync(path.join(here, "redact.ts")) ? here : path.join(here, "..", "lib");
const { redact, secretPath } = await import(new URL(`file:///${path.join(lib, "redact.ts").replace(/\\/g, "/")}`).href);
const { parseTranscript, condense, titleOf } = await import(new URL(`file:///${path.join(lib, "transcript.ts").replace(/\\/g, "/")}`).href);

const HOME = os.homedir();
const CLAUDE_PROJECTS = path.join(HOME, ".claude", "projects");
const CODEX_SESSIONS = path.join(HOME, ".codex", "sessions");
const CHUNK = 8 * 1024 * 1024; // the dashboard's proxy buffers request bodies up to ~10 MB

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d;
};

function readEnv() {
  try {
    return Object.fromEntries(
      fs
        .readFileSync(path.join(HOME, ".agent-dashboard", "handoff.env"), "utf8")
        .split(/\r?\n/)
        .filter((l) => l.includes("="))
        .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
    );
  } catch {
    return {};
  }
}
const env = readEnv();
const BASE = env.AGENT_DASHBOARD_URL ?? "https://agents.383ks.com";
const VPS_CLAUDE = env.CLAUDE_VPS_VERSION ?? "2.1.310"; // the version the round-trip gate passed with
const CODEX_NATIVE = env.CODEX_NATIVE === "1"; // off until the Codex gate passes

const die = (msg) => {
  console.error(`✗ ${msg}`);
  process.exit(1);
};

const git = (cwd, args, extraEnv) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 256 * 1024 * 1024, env: { ...process.env, ...extraEnv } }).trim();
const tryGit = (cwd, args, extraEnv) => {
  try {
    return git(cwd, args, extraEnv);
  } catch {
    return null;
  }
};

// ---------- finding chats ----------

function walk(dir, depth, pred, out = []) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory() && depth > 0 && e.name !== "memory" && e.name !== "subagents") walk(p, depth - 1, pred, out);
    else if (e.isFile() && pred(e.name)) out.push(p);
  }
  return out;
}

// Head + tail sample: enough to see where a chat ran without reading 270 MB files whole.
function sample(file) {
  const fd = fs.openSync(file, "r");
  try {
    const size = fs.fstatSync(fd).size;
    const read = (pos, len) => {
      const b = Buffer.alloc(Math.max(0, Math.min(len, size - pos)));
      fs.readSync(fd, b, 0, b.length, pos);
      return b.toString("utf8");
    };
    return size <= 3 * 1024 * 1024 ? read(0, size) : read(0, 1024 * 1024) + "\n" + read(size - 2 * 1024 * 1024, 2 * 1024 * 1024);
  } finally {
    fs.closeSync(fd);
  }
}

const normPath = (p) => p.replace(/\\\\/g, "\\").replace(/\//g, "\\").replace(/^\\([a-z])\\/i, "$1:\\").toLowerCase().replace(/\\+$/, "");

function chatInfo(file, agent) {
  const st = fs.statSync(file);
  const text = sample(file);
  const cwds = [...text.matchAll(/"cwd":"((?:[^"\\]|\\.)*)"/g)].map((m) => JSON.parse(`"${m[1]}"`));
  // Claude stamps its own version next to gitBranch on every record — take the latest (a chat resumed
  // on a newer CLI counts as that version); other "version" strings in tool output don't match.
  const version = [...text.matchAll(/"version":"(\d+\.\d+\.\d+)","gitBranch"/g)].at(-1)?.[1] ?? [...text.matchAll(/"cli_version":"([^"]+)"/g)].at(-1)?.[1];
  const id = agent === "claude" ? path.basename(file, ".jsonl") : (file.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/)?.[1] ?? "");
  const subagent = agent === "codex" && /"source":\{[^}]*"subagent/.test(text.slice(0, 20000));
  return { file, agent, id, mtime: st.mtimeMs, size: st.size, cwd: cwds.at(-1) ?? "", cwds: [...new Set(cwds)], version, subagent };
}

function allChats(days) {
  const since = Date.now() - days * 86400_000;
  const claude = walk(CLAUDE_PROJECTS, 1, (n) => n.endsWith(".jsonl")).filter((f) => fs.statSync(f).mtimeMs >= since);
  const codex = walk(CODEX_SESSIONS, 3, (n) => n.startsWith("rollout-") && n.endsWith(".jsonl")).filter((f) => fs.statSync(f).mtimeMs >= since);
  return [...claude.map((f) => chatInfo(f, "claude")), ...codex.map((f) => chatInfo(f, "codex"))].filter((c) => c.id && !c.subagent).sort((a, b) => b.mtime - a.mtime);
}

function findChat(id) {
  const c = walk(CLAUDE_PROJECTS, 1, (n) => n === `${id}.jsonl`)[0];
  if (c) return chatInfo(c, "claude");
  const x = walk(CODEX_SESSIONS, 3, (n) => n.endsWith(`${id}.jsonl`))[0];
  return x ? chatInfo(x, "codex") : null;
}

function repoOf(cwd) {
  if (!cwd || !fs.existsSync(cwd)) return null;
  const top = tryGit(cwd, ["rev-parse", "--show-toplevel"]);
  if (!top) return null;
  const url = tryGit(top, ["remote", "get-url", "origin"]) ?? "";
  const m = url.match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/);
  const worktrees = (tryGit(top, ["worktree", "list", "--porcelain"]) ?? "")
    .split("\n")
    .filter((l) => l.startsWith("worktree "))
    .map((l) => l.slice(9));
  return { top, name: m?.[1] ?? null, worktrees: [...new Set([top, ...worktrees])], branch: tryGit(top, ["branch", "--show-current"]) || "detached" };
}

const inRepo = (chat, repo) => {
  const roots = repo.worktrees.map(normPath);
  return chat.cwds.some((c) => roots.some((r) => normPath(c) === r || normPath(c).startsWith(`${r}\\`)));
};

const lastUserLines = (chat, n) =>
  parseTranscript(sample(chat.file), chat.agent)
    .filter((i) => i.role === "you")
    .slice(-n)
    .map((i) => i.text.replace(/\s+/g, " ").slice(0, 140));

// ---------- commands ----------

if (flag("list") || flag("detect")) {
  const days = Number(opt("days", flag("detect") ? 1 : 14));
  let chats = allChats(days);
  if (flag("detect")) {
    const repo = repoOf(opt("cwd", process.cwd()));
    if (repo) chats = chats.filter((c) => inRepo(c, repo));
    else chats = chats.filter((c) => normPath(c.cwd) === normPath(opt("cwd", process.cwd())));
    const out = chats.slice(0, 6).map((c) => {
      const last = lastUserLines(c, 2);
      return { id: c.id, agent: c.agent, lastActive: new Date(c.mtime).toISOString(), sizeMB: +(c.size / 1e6).toFixed(1), cwd: c.cwd, lastMessages: last, invokedHandoff: last.some((l) => /(^|\s)[/$]?hand-?off\b/i.test(l)) && Date.now() - c.mtime < 15 * 60_000 };
    });
    console.log(JSON.stringify({ repo: repo?.name ?? null, candidates: out }, null, 2));
  } else {
    for (const c of chats) {
      const t = titleOf(parseTranscript(sample(c.file), c.agent));
      console.log(`${c.id}  ${c.agent.padEnd(6)} ${new Date(c.mtime).toISOString().slice(0, 16)}  ${(c.size / 1e6).toFixed(1).padStart(6)} MB  ${t}`);
    }
  }
  process.exit(0);
}

const sid = opt("session");
if (!sid) die("Pass --session <id> (see --detect or --list).");
if (!env.HANDOFF_TOKEN && !flag("dry-run")) die("Missing HANDOFF_TOKEN in ~/.agent-dashboard/handoff.env");
const chat = findChat(sid);
if (!chat) die(`No Claude or Codex chat with id ${sid} on this PC.`);
const generation = String(Date.now());

// 1. Checkpoint: the transcript up to (not including) the hand-off request, complete lines only.
const raw = fs.readFileSync(chat.file, "utf8");
const pcSha = crypto.createHash("sha256").update(raw).digest("hex");
let lines = raw.split("\n");
let cut = -1;
// Cut only when Lind's *latest* message is the hand-off request (/handoff, $handoff in Codex) — an
// older hand-off further up, or tool output mentioning it, doesn't count.
for (let i = lines.length - 1; i >= 0 && i > lines.length - 4000; i--) {
  const said = parseTranscript(lines[i], chat.agent).filter((it) => it.role === "you");
  if (!said.length) continue;
  if (said.some((it) => /^\s*[/$]handoff\b/.test(it.text))) cut = i;
  break;
}
if (cut >= 0) lines = lines.slice(0, cut);
while (lines.length) {
  const last = lines[lines.length - 1];
  if (!last.trim()) {
    lines.pop();
    continue;
  }
  try {
    JSON.parse(last);
    break;
  } catch {
    lines.pop(); // a half-written record
  }
}
const transcript = lines.join("\n") + "\n";
const items = parseTranscript(transcript, chat.agent);
const title = opt("title", titleOf(items));
console.log(`• Chat: ${title}  (${chat.agent}, ${(chat.size / 1e6).toFixed(1)} MB${cut >= 0 ? ", cut at the hand-off request" : ""})`);

const mode = chat.agent === "claude" ? (chat.version === VPS_CLAUDE ? "native" : "summary") : CODEX_NATIVE ? "native" : "summary";
if (mode === "summary") {
  console.log(
    chat.agent === "claude"
      ? `• Summary hand-off: this chat was written by Claude ${chat.version ?? "?"}, the VPS runs ${VPS_CLAUDE} (only that pair passed the round-trip test).`
      : "• Summary hand-off: native Codex hand-off isn't enabled yet (the VPS Codex workspace needs credits to pass the test).",
  );
}

// 2. Code: snapshot the working tree into a commit without touching the checkout, push to a hidden ref.
const repo = flag("no-code") ? null : repoOf(chat.cwd);
let snapshot;
if (repo && !repo.name) console.log("• No GitHub remote in this repo — conversation-only hand-off.");
if (repo?.name && !tryGit(repo.top, ["rev-parse", "--verify", "HEAD"])) console.log("• The repo has no commits yet — conversation-only hand-off.");
if (repo?.name && tryGit(repo.top, ["rev-parse", "--verify", "HEAD"])) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "handoff-"));
  const ix = { GIT_INDEX_FILE: path.join(tmp, "index") };
  try {
    git(repo.top, ["read-tree", "HEAD"], ix);
    git(repo.top, ["add", "-A"], ix);
    const tree = git(repo.top, ["write-tree"], ix);
    const sha = git(repo.top, ["commit-tree", "-p", "HEAD", "-m", `Hand-off snapshot of ${repo.branch} (${sid})`, tree], ix);
    // Secret scan: every object this push would newly upload (all unpushed commits, not just the tree).
    const objects = (tryGit(repo.top, ["rev-list", "--objects", sha, "--not", "--remotes"]) ?? "").split("\n").filter(Boolean).slice(0, 20000);
    const findings = [];
    for (const line of objects) {
      const [obj, ...rest] = line.split(" ");
      const p = rest.join(" ");
      if (!p) continue;
      if (secretPath(p)) findings.push(`${p} (secret-looking file)`);
      const kind = tryGit(repo.top, ["cat-file", "-t", obj]);
      if (kind !== "blob") continue;
      if (Number(tryGit(repo.top, ["cat-file", "-s", obj]) ?? 0) > 1024 * 1024) continue;
      const content = tryGit(repo.top, ["cat-file", "-p", obj]) ?? "";
      if (content.includes("handoff-scan: fake-secrets-only")) continue; // test fixtures, marked on purpose
      const hits = Object.keys(redact(content).hits).filter((k) => k !== "high-entropy");
      if (hits.length) findings.push(`${p} (${hits.join(", ")})`);
    }
    if (findings.length && !flag("allow-secrets")) {
      die(`Possible secrets in the code being uploaded — nothing was sent:\n  ${[...new Set(findings)].join("\n  ")}\nRemove them, or re-run with --allow-secrets if they're false alarms.`);
    }
    const ref = `refs/agent-handoff/${sid}/${generation}`;
    if (!flag("dry-run")) git(repo.top, ["push", "-q", "origin", `${sha}:${ref}`]);
    const dirty = (tryGit(repo.top, ["status", "--porcelain"]) ?? "").split("\n").filter(Boolean).length;
    snapshot = {
      ref,
      sha,
      pcBranch: repo.branch,
      boundary: `${repo.branch} + ${dirty} uncommitted file${dirty === 1 ? "" : "s"} (untracked ignored files, submodule changes and staging are not included)`,
    };
    console.log(`• Code: ${snapshot.boundary} → ${flag("dry-run") ? "(dry run, not pushed)" : ref}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// 3. Context bundle: the project's whole story, redacted.
let redactions = 0;
const red = (t) => {
  const r = redact(t);
  redactions += Object.values(r.hits).reduce((a, b) => a + b, 0);
  return r.text;
};
const capText = (t, n) => (t.length <= n ? t : `${t.slice(0, n * 0.25)}\n\n…(middle of a long chat omitted — see the live session)…\n\n${t.slice(-n * 0.75)}`);

const thisText = red(condense(items));
const related = [];
if (repo) {
  for (const c of allChats(30)) {
    if (c.id === chat.id || !inRepo(c, repo) || c.size > 300 * 1024 * 1024) continue;
    const its = parseTranscript(fs.readFileSync(c.file, "utf8"), c.agent);
    if (its.filter((i) => i.role === "you").length < 2) continue;
    related.push({ id: c.id, agent: c.agent, title: titleOf(its), updated: new Date(c.mtime).toISOString(), cwd: c.cwd, text: capText(red(condense(its)), 400_000) });
    if (related.length >= 8) break;
  }
}

const memory = {};
for (const d of fs.existsSync(CLAUDE_PROJECTS) ? fs.readdirSync(CLAUDE_PROJECTS) : []) {
  const md = path.join(CLAUDE_PROJECTS, d, "memory");
  if (!fs.existsSync(md)) continue;
  for (const f of fs.readdirSync(md).filter((f) => f.endsWith(".md"))) {
    (memory[d] ??= {})[f] = red(fs.readFileSync(path.join(md, f), "utf8"));
  }
}
const projectMemoryDir = path.basename(path.dirname(chat.file));

const instructions = [];
const addFile = (p) => {
  if (fs.existsSync(p) && !instructions.some((i) => i.path === p)) instructions.push({ path: p, text: red(fs.readFileSync(p, "utf8")) });
};
addFile(path.join(HOME, "CLAUDE.md"));
addFile(path.join(HOME, ".claude", "CLAUDE.md"));
for (const f of fs.existsSync(path.join(HOME, ".claude", "rules")) ? fs.readdirSync(path.join(HOME, ".claude", "rules")) : []) if (f.endsWith(".md")) addFile(path.join(HOME, ".claude", "rules", f));
if (chat.agent === "codex") addFile(path.join(HOME, ".codex", "AGENTS.md"));
// CLAUDE.md / AGENTS.md between home and the chat's folder (e.g. Desktop/claude/CLAUDE.md).
for (let d = repo?.top ?? chat.cwd; d && normPath(d).startsWith(normPath(HOME)) && normPath(d) !== normPath(HOME); d = path.dirname(d)) {
  addFile(path.join(d, "CLAUDE.md"));
  addFile(path.join(d, "AGENTS.md"));
}

// Skills this chat actually used (Skill tool calls and /commands), markdown only.
const skills = {};
const used = new Set([...items.filter((i) => i.role === "tool" && i.text.startsWith("Skill ")).map((i) => i.text.split(" ")[1]), ...items.filter((i) => i.role === "you").flatMap((i) => [...i.text.matchAll(/(?:^|\s)\/([a-z][\w-]+)/g)].map((m) => m[1]))]);
for (const name of used) {
  const dir = path.join(HOME, chat.agent === "codex" ? ".codex" : ".claude", "skills", name);
  if (!/^[\w-]+$/.test(name) || !fs.existsSync(path.join(dir, "SKILL.md"))) continue;
  let budget = 300 * 1024;
  for (const f of walk(dir, 1, (n) => n.endsWith(".md"))) {
    const t = fs.readFileSync(f, "utf8");
    if ((budget -= t.length) < 0) break;
    (skills[name] ??= {})[path.relative(dir, f).replace(/[\\/]/g, "__")] = t;
  }
}

const context = { version: 1, thisChat: { id: chat.id, agent: chat.agent, title, text: thisText }, related, memory, projectMemoryDir, instructions, skills, pc: { createdAt: new Date().toISOString(), claudeVersion: chat.version } };
const noteCount = Object.values(memory).reduce((n, m) => n + Object.keys(m).length, 0);
console.log(`• Context: this chat (${(thisText.length / 1e6).toFixed(2)} MB condensed), ${related.length} related chat${related.length === 1 ? "" : "s"}, ${noteCount} memory notes, ${instructions.length} instruction files, ${Object.keys(skills).length} skill${Object.keys(skills).length === 1 ? "" : "s"}; ${redactions} secret${redactions === 1 ? "" : "s"} redacted`);

const meta = {
  agent: chat.agent,
  sessionId: chat.id,
  generation,
  title,
  mode,
  pc: { transcriptPath: chat.file, transcriptSha256: pcSha, cwd: chat.cwd, projectDir: projectMemoryDir, cliVersion: chat.version, transcriptFile: path.basename(chat.file) },
  repo: snapshot ? repo.name : undefined,
  snapshot,
};

if (flag("dry-run")) {
  console.log(`• Dry run: would upload ${(Buffer.byteLength(transcript) / 1e6).toFixed(1)} MB transcript + ${(Buffer.byteLength(JSON.stringify(context)) / 1e6).toFixed(1)} MB context as ${mode}.`);
  process.exit(0);
}

// 4. Upload.
const api = async (p, init) => {
  const res = await fetch(`${BASE}/api/handoff/v2/${p}`, { ...init, headers: { Authorization: `Bearer ${env.HANDOFF_TOKEN}`, ...(init?.headers ?? {}) } });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
  return body;
};
const json = (b) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });

let uploadId;
try {
  ({ uploadId } = await api("start", json(meta)));
  const parts = {};
  for (const [part, data] of [
    ["transcript", Buffer.from(transcript)],
    ["context", Buffer.from(JSON.stringify(context))],
  ]) {
    const gz = zlib.gzipSync(data, { level: 6 });
    const n = Math.max(1, Math.ceil(gz.length / CHUNK));
    for (let i = 0; i < n; i++) {
      const chunk = gz.subarray(i * CHUNK, (i + 1) * CHUNK);
      const h = crypto.createHash("sha256").update(chunk).digest("hex");
      for (let attempt = 1; ; attempt++) {
        try {
          await api(`chunk?upload=${uploadId}&part=${part}&index=${i}&sha256=${h}`, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: chunk });
          break;
        } catch (err) {
          if (attempt >= 3) throw err;
        }
      }
      process.stdout.write(`\r• Uploading ${part}: ${i + 1}/${n} (${(gz.length / 1e6).toFixed(1)} MB)   `);
    }
    process.stdout.write("\n");
    parts[part] = { chunks: n, sha256: crypto.createHash("sha256").update(data).digest("hex") };
  }
  const done = await api("finish", json({ uploadId, parts }));
  const record = { ...meta, jobId: done.jobId, url: done.url, at: new Date().toISOString() };
  fs.mkdirSync(path.join(HOME, ".agent-dashboard", "handoffs"), { recursive: true });
  fs.writeFileSync(path.join(HOME, ".agent-dashboard", "handoffs", `${chat.id}-${generation}.json`), JSON.stringify(record, null, 2));
  console.log(`✓ Handed off: ${done.url}`);
  if (snapshot) console.log(`  The VPS continues on its own branch from your PC state; your checkout here is unchanged.`);
  console.log(`  Don't keep using this chat on the PC — continue on the phone. /takeback brings it home later.`);
} catch (err) {
  if (uploadId) await api("abort", json({ uploadId })).catch(() => {});
  die(`Hand-off failed: ${err.message}`);
}
