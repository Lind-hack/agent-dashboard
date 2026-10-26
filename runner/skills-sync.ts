import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { DATA_DIR } from "../lib/config";
import { redact } from "../lib/redact";

// Installs the skill folders the PC collector uploads (PLAN-v2 R21) into the VPS agents' skill dirs:
// Claude → ~/.claude/skills, Codex → $CODEX_HOME/skills.
//   - Names must start with a letter or digit (no ".", "..", or our own hidden working folders).
//   - The skills folder must be a real directory under the agent's home, never a symlink.
//   - Every file is validated before anything is written: relative path, depth ≤ 8, ≤ 256 KB, text, no
//     secret-looking content; SKILL.md must pass or the whole skill is rejected. Size/count limits cap
//     an upload so it can't exhaust the disk or stall the runner.
//   - Each skill is staged in a fresh private folder and swapped in; a failed swap restores the old
//     version, and an interrupted one is recovered on the next tick.
//   - Only skills this sync installed (marker file) are removed when they vanish from the PC, and only
//     when the PC sent its complete inventory.
// Hooks, plugins and MCP servers arrive as a manifest only — nothing is installed from it.

const INBOX = () => path.join(DATA_DIR, "skills-inbox");
const STATUS = () => path.join(DATA_DIR, "skills-status.json");
const MANIFEST = () => path.join(DATA_DIR, "pc-manifest.json");
const MARKER = ".synced-from-pc";
const NAME = /^[A-Za-z0-9][\w.-]{0,79}$/;
const SEGMENT = /^[\w @+()-][\w .@+()-]{0,119}$/; // no leading dot: no "..", no hidden files
const LIMITS = { fileBytes: 256 * 1024, skillBytes: 3 * 1024 * 1024, filesPerSkill: 500, depth: 8, skillsPerUpload: 800, unpacked: 96 * 1024 * 1024 };

// Need the PC (Windows, its Chrome, its desktop apps) or change the harness itself — not useful on the VPS.
const PC_ONLY = [/^chrome/, /^claude-in-chrome/, /computer-use/, /^orca/, /^herdr/, /^keybindings/, /^statusline/, /^update-config/, /^fewer-permission/, /^plugin-authoring/, /windows/i, /^synced$/];

type Upload = { kind: "skills"; agent: "claude" | "codex"; names: string[]; complete?: boolean; skills: Record<string, Record<string, string>> };
type AgentStatus = { at?: string; installed: number; removed: number; skipped: { name: string; why: string }[] };
type Status = Record<"claude" | "codex", AgentStatus>;

const log = (...a: unknown[]) => console.log(new Date().toISOString(), "skills:", ...a);
const homeFor = (agent: "claude" | "codex") => (agent === "codex" ? (process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex")) : path.join(os.homedir(), ".claude"));
const rootFor = (agent: "claude" | "codex") => path.join(homeFor(agent), "skills");

function readStatus(): Status {
  try {
    return JSON.parse(fs.readFileSync(STATUS(), "utf8"));
  } catch {
    return { claude: { installed: 0, removed: 0, skipped: [] }, codex: { installed: 0, removed: 0, skipped: [] } };
  }
}

// The skills root must be a real directory inside the agent's home — refuse to touch anything else.
function safeRoot(agent: "claude" | "codex"): string {
  const root = rootFor(agent);
  fs.mkdirSync(root, { recursive: true });
  const st = fs.lstatSync(root);
  if (st.isSymbolicLink() || !st.isDirectory()) throw new Error(`${root} is not a plain directory`);
  const real = fs.realpathSync(root);
  const home = fs.realpathSync(homeFor(agent));
  if (!real.startsWith(home + path.sep)) throw new Error(`${root} resolves outside ${home}`);
  return real;
}

function safeRel(rel: string): string[] | null {
  if (typeof rel !== "string" || !rel || rel.startsWith("/") || rel.includes("\\") || rel.includes("\0")) return null;
  const parts = rel.split("/");
  return parts.length <= LIMITS.depth && parts.every((p) => SEGMENT.test(p)) ? parts : null;
}

// Validates a whole skill before anything touches the disk. Returns the files to write, or why not.
function validate(files: Record<string, unknown>): { ok: [string[], string][] } | { why: string } {
  const entries = Object.entries(files ?? {});
  if (entries.length > LIMITS.filesPerSkill) return { why: `more than ${LIMITS.filesPerSkill} files` };
  const skillMd = files?.["SKILL.md"];
  if (typeof skillMd !== "string" || !skillMd.trim() || skillMd.includes("\0") || Buffer.byteLength(skillMd) > LIMITS.fileBytes) return { why: "no usable SKILL.md" };
  let total = 0;
  const ok: [string[], string][] = [];
  for (const [rel, text] of entries) {
    const parts = safeRel(rel);
    if (!parts) return { why: `unsafe path ${String(rel).slice(0, 80)}` };
    if (typeof text !== "string" || text.includes("\0")) continue;
    const bytes = Buffer.byteLength(text);
    if (bytes > LIMITS.fileBytes) continue; // too big to be a skill text — left behind
    const hits = Object.keys(redact(text).hits).filter((k) => k !== "high-entropy");
    if (hits.length) {
      if (rel === "SKILL.md") return { why: `SKILL.md looks like it contains a secret (${hits.join(", ")})` };
      continue;
    }
    total += bytes;
    if (total > LIMITS.skillBytes) return { why: "over 3 MB of text" };
    ok.push([parts, text]);
  }
  return { ok };
}

function installOne(root: string, name: string, files: [string[], string][]) {
  // A fresh private staging folder each time (mkdtemp can't be pre-planted as a symlink).
  const staging = fs.mkdtempSync(path.join(root, `.stage-${name}-`));
  try {
    for (const [parts, text] of files) {
      const f = path.join(staging, ...parts);
      if (!f.startsWith(staging + path.sep)) throw new Error("path escaped staging");
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, text, { flag: "wx" });
    }
    fs.writeFileSync(path.join(staging, MARKER), new Date().toISOString());
    const dest = path.join(root, name);
    const old = path.join(root, `.old-${name}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`);
    const had = fs.existsSync(dest);
    if (had) fs.renameSync(dest, old);
    try {
      fs.renameSync(staging, dest);
    } catch (e) {
      if (had) fs.renameSync(old, dest); // put the working version back
      throw e;
    }
    if (had) fs.rmSync(old, { recursive: true, force: true });
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

// After a crash mid-swap: a skill missing but backed up gets its backup back; leftovers are cleared.
function recover(root: string) {
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    if (e.name.startsWith(".stage-")) fs.rmSync(path.join(root, e.name), { recursive: true, force: true });
    const m = e.name.match(/^\.old-(.+)-\d+-[0-9a-f]{6}$/);
    if (m) {
      const dest = path.join(root, m[1]);
      if (!fs.existsSync(dest) && NAME.test(m[1])) fs.renameSync(path.join(root, e.name), dest);
      else fs.rmSync(path.join(root, e.name), { recursive: true, force: true });
    }
  }
}

function applySkills(u: Upload) {
  const root = safeRoot(u.agent);
  recover(root);
  const status = readStatus();
  const s: AgentStatus = { at: new Date().toISOString(), installed: 0, removed: 0, skipped: [] };
  const entries = Object.entries(u.skills ?? {});
  if (entries.length > LIMITS.skillsPerUpload) throw new Error(`upload has more than ${LIMITS.skillsPerUpload} skills`);
  for (const [name, files] of entries) {
    if (!NAME.test(name)) {
      s.skipped.push({ name: name.slice(0, 80), why: "bad name" });
      continue;
    }
    if (PC_ONLY.some((re) => re.test(name))) {
      s.skipped.push({ name, why: "needs the PC" });
      continue;
    }
    const v = validate(files);
    if ("why" in v) {
      s.skipped.push({ name, why: v.why });
      continue;
    }
    try {
      installOne(root, name, v.ok);
      s.installed++;
    } catch (e) {
      s.skipped.push({ name, why: `install failed: ${e instanceof Error ? e.message : e}` });
    }
  }
  // Skills this sync installed earlier that no longer exist on the PC — only with a complete inventory.
  if (u.complete === true && Array.isArray(u.names)) {
    const onPc = new Set(u.names.filter((n) => typeof n === "string"));
    for (const e of fs.readdirSync(root, { withFileTypes: true })) {
      if (!e.isDirectory() || !NAME.test(e.name) || onPc.has(e.name)) continue;
      if (fs.existsSync(path.join(root, e.name, MARKER))) {
        fs.rmSync(path.join(root, e.name), { recursive: true, force: true });
        s.removed++;
      }
    }
  }
  // Batches of one sync add up; a new sync (a different first batch) starts the count again.
  const prev = status[u.agent];
  const sameSync = prev?.at && Date.now() - new Date(prev.at).getTime() < 5 * 60_000;
  status[u.agent] = sameSync ? { at: s.at, installed: prev.installed + s.installed, removed: prev.removed + s.removed, skipped: [...prev.skipped, ...s.skipped].slice(-200) } : s;
  fs.writeFileSync(`${STATUS()}.tmp`, JSON.stringify(status, null, 2));
  fs.renameSync(`${STATUS()}.tmp`, STATUS());
  log(u.agent, `installed ${s.installed}, removed ${s.removed}, skipped ${s.skipped.length}`);
}

// Called every runner tick: applies uploads oldest first.
export function syncSkillsTick() {
  let files: string[] = [];
  try {
    files = fs.readdirSync(INBOX()).filter((f) => f.endsWith(".json.gz")).sort();
  } catch {
    return;
  }
  for (const f of files) {
    const file = path.join(INBOX(), f);
    try {
      const body = JSON.parse(gunzipSync(fs.readFileSync(file), { maxOutputLength: LIMITS.unpacked }).toString("utf8"));
      if (body?.kind === "skills" && (body.agent === "claude" || body.agent === "codex")) applySkills(body as Upload);
      else if (body?.kind === "manifest") {
        fs.writeFileSync(`${MANIFEST()}.tmp`, JSON.stringify({ ...body, receivedAt: new Date().toISOString() }, null, 2));
        fs.renameSync(`${MANIFEST()}.tmp`, MANIFEST());
      }
    } catch (e) {
      log("bad upload", f, e instanceof Error ? e.message : e);
    }
    fs.rmSync(file, { force: true });
  }
}
