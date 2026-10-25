#!/usr/bin/env node
// Take-back: brings a chat handed off with handoff.mjs home from the VPS — the code the VPS wrote, the
// conversation as it is now (native hand-offs) and any memory notes it changed — so `claude --resume`
// continues on this PC. Manual only.
//
//   node takeback.mjs --list                       hand-offs from this PC that are still on the VPS
//   node takeback.mjs --session <id> --pc-chat-closed [--force]
//
// --pc-chat-closed is Lind's confirmation that the PC copy of the chat isn't open anywhere (it's replaced).
// Order: freeze + export on the VPS → download and verify → code → transcript → memory → tell the VPS.

import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const lib = fs.existsSync(path.join(here, "redact.ts")) ? here : path.join(here, "..", "lib");
const { redact } = await import(new URL(`file:///${path.join(lib, "redact.ts").replace(/\\/g, "/")}`).href);

const HOME = os.homedir();
const STATE = path.join(HOME, ".agent-dashboard");
const RECORDS = path.join(STATE, "handoffs");
const CLAUDE_PROJECTS = path.join(HOME, ".claude", "projects");

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : undefined;
};
const die = (msg) => {
  console.error(`✗ ${msg}`);
  process.exit(1);
};
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");

const env = (() => {
  try {
    return Object.fromEntries(
      fs
        .readFileSync(path.join(STATE, "handoff.env"), "utf8")
        .split(/\r?\n/)
        .filter((l) => l.includes("="))
        .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
    );
  } catch {
    return {};
  }
})();
const BASE = env.AGENT_DASHBOARD_URL ?? "https://agents.383ks.com";

const records = () =>
  (fs.existsSync(RECORDS) ? fs.readdirSync(RECORDS) : [])
    .filter((f) => f.endsWith(".json"))
    .map((f) => ({ file: path.join(RECORDS, f), ...JSON.parse(fs.readFileSync(path.join(RECORDS, f), "utf8")) }))
    .sort((a, b) => b.generation.localeCompare(a.generation));

if (flag("list")) {
  const open = records().filter((r) => !r.returnedAt);
  if (!open.length) console.log("No hand-offs from this PC are waiting on the VPS.");
  for (const r of open) console.log(`${r.sessionId}  ${r.agent.padEnd(6)} ${r.mode.padEnd(7)} ${r.at?.slice(0, 16) ?? ""}  ${r.title}  ${r.url ?? ""}`);
  process.exit(0);
}

const sid = opt("session");
if (!sid) die("Pass --session <id> (see --list).");
if (!env.HANDOFF_TOKEN) die("Missing HANDOFF_TOKEN in ~/.agent-dashboard/handoff.env");
// The destination comes from what this PC recorded at hand-off time, never from the server.
const record = records().find((r) => r.sessionId === sid && !r.returnedAt);
if (!record) die(`No open hand-off of ${sid} recorded on this PC (see --list).`);
if (!flag("pc-chat-closed")) die("Confirm the PC copy of this chat is closed (no terminal or app has it open), then re-run with --pc-chat-closed.");

const lock = path.join(STATE, "takeback.lock");
try {
  fs.writeFileSync(lock, String(process.pid), { flag: "wx" });
} catch {
  die(`Another take-back is running (or crashed): delete ${lock} if you're sure none is.`);
}
process.on("exit", () => fs.rmSync(lock, { force: true }));

const api = async (p, init) => {
  const res = await fetch(`${BASE}/api/handoff/v2/${p}`, { ...init, headers: { Authorization: `Bearer ${env.HANDOFF_TOKEN}`, ...(init?.headers ?? {}) } });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `HTTP ${res.status}`);
  }
  return res;
};
const post = (p, b) => api(p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }).then((r) => r.json());
const git = (cwd, args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 256 * 1024 * 1024 }).trim();
const tryGit = (cwd, args) => {
  try {
    return git(cwd, args);
  } catch {
    return null;
  }
};

try {
  // 1. Freeze on the VPS and wait for the export (a running turn finishes first).
  const ids = { sessionId: record.sessionId, generation: record.generation };
  let state;
  for (let i = 0; ; i++) {
    state = await post("return", ids);
    if (state.export?.status === "ready") break;
    if (state.export?.status === "failed") throw new Error(`The VPS couldn't pack the chat: ${state.export.error}`);
    if (i === 0) console.log(`• Asked the VPS to hand ${state.jobId} back${state.running ? " (a turn is running — waiting for it)" : ""}…`);
    if (i > 180) throw new Error("Timed out after 15 minutes waiting for the VPS.");
    await new Promise((r) => setTimeout(r, 5000));
  }

  // 2. Download and verify everything before touching anything.
  const q = `session=${record.sessionId}&generation=${record.generation}`;
  const manifestRaw = Buffer.from(await (await api(`export?${q}&part=manifest`)).arrayBuffer());
  if (sha(manifestRaw) !== state.export.digest) throw new Error("The export manifest doesn't match its digest.");
  const manifest = JSON.parse(manifestRaw.toString("utf8"));
  if (manifest.sessionId !== record.sessionId || manifest.generation !== record.generation) throw new Error("The export belongs to a different hand-off.");
  let transcript;
  if (manifest.transcript) {
    transcript = Buffer.from(await (await api(`export?${q}&part=transcript`)).arrayBuffer());
    if (sha(transcript) !== manifest.transcript.sha256) throw new Error("The transcript download is corrupt (hash mismatch).");
  }
  console.log(`• Downloaded: ${manifest.turnsOnVps} turn${manifest.turnsOnVps === 1 ? "" : "s"} on the VPS${transcript ? `, chat ${(transcript.length / 1e6).toFixed(1)} MB` : ""}, ${manifest.memory.length} memory change${manifest.memory.length === 1 ? "" : "s"}.`);

  // 3. Code: the VPS branch, verified by SHA, into the original checkout when that's safe.
  let codeWhere = record.pc.cwd;
  if (manifest.code) {
    const top = tryGit(record.pc.cwd, ["rev-parse", "--show-toplevel"]);
    if (!top) throw new Error(`The original checkout ${record.pc.cwd} is gone — fetch ${manifest.code.ref} @ ${manifest.code.sha} by hand.`);
    const branch = manifest.code.ref.replace(/^refs\/heads\//, "");
    if (!/^pc\/[\w.-]+$/.test(branch)) throw new Error(`Unexpected branch name ${branch}.`);
    git(top, ["fetch", "-q", "origin", `+${manifest.code.ref}:refs/remotes/origin/${branch}`]);
    if (git(top, ["rev-parse", `refs/remotes/origin/${branch}`]) !== manifest.code.sha) throw new Error(`origin/${branch} isn't at ${manifest.code.sha} — the VPS pushed again? Re-run.`);

    const local = tryGit(top, ["rev-parse", "--verify", "-q", `refs/heads/${branch}`]);
    if (local && local !== manifest.code.sha && tryGit(top, ["merge-base", "--is-ancestor", local, manifest.code.sha]) === null) {
      throw new Error(`Local branch ${branch} has commits the VPS doesn't — merge origin/${branch} into it by hand.`);
    }
    const dirty = (tryGit(top, ["status", "--porcelain"]) ?? "").trim();
    // The checkout is "as handed off" when its tracked + untracked files equal the snapshot tree.
    const asHandedOff = (() => {
      if (!dirty || !manifest.code.snapshotSha) return !dirty;
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "takeback-"));
      try {
        const e = { ...process.env, GIT_INDEX_FILE: path.join(tmp, "index") };
        const run = (args) => execFileSync("git", args, { cwd: top, encoding: "utf8", env: e, stdio: ["ignore", "pipe", "pipe"] }).trim();
        run(["read-tree", "HEAD"]);
        run(["add", "-A"]);
        return run(["write-tree"]) === git(top, ["rev-parse", `${manifest.code.snapshotSha}^{tree}`]);
      } catch {
        return false;
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    })();

    let switched = false;
    if (asHandedOff) {
      let stashed = false;
      if (dirty) {
        git(top, ["stash", "push", "-u", "-m", `takeback ${sid}: state at hand-off (also in ${branch})`]);
        stashed = true;
      }
      try {
        git(top, ["branch", "-f", branch, manifest.code.sha]);
        git(top, ["switch", branch]);
        switched = true;
        console.log(`• Code: ${top} is now on ${branch} (${manifest.code.sha.slice(0, 7)})${stashed ? " — your pre-hand-off changes are in it, and also kept in git stash" : ""}.`);
      } catch (err) {
        if (stashed) tryGit(top, ["stash", "pop"]);
        console.log(`• Couldn't switch ${top} (${String(err.message).split("\n")[0]}) — using a separate worktree instead.`);
      }
    }
    if (!switched) {
      const wt = `${top}-takeback-${sid.slice(0, 6)}`;
      if (fs.existsSync(wt)) throw new Error(`${wt} already exists — remove it or check it out by hand.`);
      if (!local || local !== manifest.code.sha) git(top, ["branch", "-f", branch, manifest.code.sha]);
      git(top, ["worktree", "add", wt, branch]);
      codeWhere = path.join(wt, path.relative(top, record.pc.cwd));
      console.log(`• Code: ${top} has changes made after the hand-off, so it was left alone. The VPS work is in ${wt} (branch ${branch}).`);
    }
  }

  // 4. Transcript (native only): replace the PC copy, keeping a backup if it moved on since the hand-off.
  if (transcript) {
    const target = record.pc.transcriptPath;
    if (!target?.startsWith(CLAUDE_PROJECTS) || !target.endsWith(`${sid}.jsonl`)) throw new Error(`Refusing to write the chat outside ~/.claude/projects (${target}).`);
    const st = fs.statSync(target, { throwIfNoEntry: false });
    if (st && Date.now() - st.mtimeMs < 2 * 60_000 && !flag("force")) throw new Error("The PC copy of this chat changed in the last 2 minutes — is it still open? Close it (or pass --force).");
    const tmp = `${target}.takeback-${process.pid}.tmp`;
    fs.writeFileSync(tmp, transcript);
    if (st) {
      const now = fs.readFileSync(target);
      if (sha(now) !== record.pc.transcriptSha256) {
        const bak = target.replace(/\.jsonl$/, `.pc-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl.bak`);
        fs.copyFileSync(target, bak);
        console.log(`• The PC copy had moved on since the hand-off — backed up to ${path.basename(bak)}.`);
      }
    }
    fs.renameSync(tmp, target);
    console.log(`• Chat installed: ${path.basename(target)}`);
  } else if (manifest.mode === "summary") {
    console.log("• Summary hand-off: the VPS session can't be resumed on the PC — the code and memory came back; the chat stays readable on the dashboard.");
  }

  // 5. Memory: three-way. VPS edits land only where the PC note is unchanged since the hand-off.
  const memDir = path.join(CLAUDE_PROJECTS, record.pc.projectDir, "memory");
  const conflicts = [];
  for (const m of manifest.memory) {
    if (!/^[\w.-]+\.md$/.test(m.name)) continue;
    const file = path.join(memDir, m.name);
    const cur = fs.lstatSync(file, { throwIfNoEntry: false });
    if (cur && !cur.isFile()) continue;
    const text = cur ? fs.readFileSync(file, "utf8") : null;
    // The VPS saw a redacted copy, so the base hash is over the redacted PC text.
    const red = text === null ? null : redact(text).text;
    const unchanged = text !== null && sha(red) === m.baseSha && red === text;
    fs.mkdirSync(memDir, { recursive: true });
    if (m.op === "deleted") {
      if (unchanged) {
        fs.renameSync(file, `${file}.deleted-on-vps.bak`);
        console.log(`• Memory: ${m.name} was deleted on the VPS — kept as ${m.name}.deleted-on-vps.bak`);
      }
      continue;
    }
    if (text === m.text) continue;
    if ((m.op === "added" && text === null) || (m.op === "changed" && unchanged)) {
      fs.writeFileSync(file, m.text);
      console.log(`• Memory: ${m.op} ${m.name}`);
    } else {
      fs.writeFileSync(file.replace(/\.md$/, ".vps.md"), m.text);
      conflicts.push(m.name);
    }
  }
  if (conflicts.length) console.log(`• Memory conflicts (changed on both sides) — the VPS versions are next to them as .vps.md: ${conflicts.join(", ")}`);

  // 6. Done: the VPS hands ownership to the PC and closes its copy.
  await post("complete", { ...ids, exportDigest: state.export.digest });
  fs.writeFileSync(record.file, JSON.stringify({ ...Object.fromEntries(Object.entries(record).filter(([k]) => k !== "file")), returnedAt: new Date().toISOString() }, null, 2));
  console.log(`✓ Back on the PC.${transcript ? ` Continue with:\n  cd "${codeWhere}"\n  claude --resume ${sid}` : ""}`);
} catch (err) {
  die(`Take-back stopped: ${err.message}`);
}
