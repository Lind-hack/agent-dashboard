import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { DATA_DIR } from "../lib/config";
import { redact } from "../lib/redact";

// Installs the skill folders the PC collector uploads (PLAN-v2 R21) into the VPS agents' skill dirs:
// Claude → ~/.claude/skills, Codex → $CODEX_HOME/skills. Every file is validated (relative paths only,
// ≤256 KB, text, no secret-looking content); skills that only make sense on the PC are skipped; each
// skill is staged and swapped in whole. Skills this sync installed carry a marker, and only those are
// removed when they disappear from the PC. Hooks, plugins and MCP servers arrive as a manifest only.

const INBOX = () => path.join(DATA_DIR, "skills-inbox");
const STATUS = () => path.join(DATA_DIR, "skills-status.json");
const MANIFEST = () => path.join(DATA_DIR, "pc-manifest.json");
const MARKER = ".synced-from-pc";
const NAME = /^[\w.-]{1,80}$/;
const SEGMENT = /^[\w .@+()-]{1,120}$/;
const FILE_CAP = 256 * 1024;
const SKILL_CAP = 3 * 1024 * 1024;

// Need the PC (Windows, its Chrome, its desktop apps) or change the harness itself — not useful on the VPS.
const PC_ONLY = [/^chrome/, /^claude-in-chrome/, /computer-use/, /^orca/, /^herdr/, /^keybindings/, /^statusline/, /^update-config/, /^fewer-permission/, /^plugin-authoring/, /windows/i, /^synced$/];

type Upload = { kind: "skills"; agent: "claude" | "codex"; names: string[]; skills: Record<string, Record<string, string>> };
type Status = Record<"claude" | "codex", { at?: string; installed: number; removed: number; skipped: { name: string; why: string }[] }>;

const log = (...a: unknown[]) => console.log(new Date().toISOString(), "skills:", ...a);
const rootFor = (agent: "claude" | "codex") => (agent === "codex" ? path.join(process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex"), "skills") : path.join(os.homedir(), ".claude", "skills"));

function readStatus(): Status {
  try {
    return JSON.parse(fs.readFileSync(STATUS(), "utf8"));
  } catch {
    return { claude: { installed: 0, removed: 0, skipped: [] }, codex: { installed: 0, removed: 0, skipped: [] } };
  }
}

function safeRel(rel: string): string[] | null {
  if (!rel || rel.startsWith("/") || rel.includes("\\") || rel.includes("\0")) return null;
  const parts = rel.split("/");
  return parts.every((p) => p !== "." && p !== ".." && SEGMENT.test(p)) ? parts : null;
}

function installOne(root: string, name: string, files: Record<string, string>): string | null {
  if (!files["SKILL.md"]) return "no SKILL.md";
  let total = 0;
  const clean: [string[], string][] = [];
  for (const [rel, text] of Object.entries(files)) {
    const parts = safeRel(rel);
    if (!parts) return `unsafe path ${rel.slice(0, 80)}`;
    if (typeof text !== "string" || text.length > FILE_CAP || text.includes("\0")) continue; // binary/huge files just don't come along
    const hits = Object.keys(redact(text).hits).filter((k) => k !== "high-entropy");
    if (hits.length) {
      if (rel === "SKILL.md") return `SKILL.md looks like it contains a secret (${hits.join(", ")})`;
      continue;
    }
    total += text.length;
    if (total > SKILL_CAP) return "skill is over 3 MB of text";
    clean.push([parts, text]);
  }
  const staging = path.join(root, ".sync-staging", name);
  fs.rmSync(staging, { recursive: true, force: true });
  for (const [parts, text] of clean) {
    const f = path.join(staging, ...parts);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, text);
  }
  fs.writeFileSync(path.join(staging, MARKER), new Date().toISOString());
  const dest = path.join(root, name);
  const old = path.join(root, ".sync-old", `${name}-${Date.now()}`);
  if (fs.existsSync(dest)) {
    fs.mkdirSync(path.dirname(old), { recursive: true });
    fs.renameSync(dest, old);
  }
  fs.renameSync(staging, dest);
  fs.rmSync(old, { recursive: true, force: true });
  return null;
}

function applySkills(u: Upload) {
  const root = rootFor(u.agent);
  fs.mkdirSync(root, { recursive: true });
  const status = readStatus();
  const s = { at: new Date().toISOString(), installed: 0, removed: 0, skipped: [] as { name: string; why: string }[] };
  for (const [name, files] of Object.entries(u.skills ?? {})) {
    if (!NAME.test(name)) {
      s.skipped.push({ name: name.slice(0, 80), why: "bad name" });
      continue;
    }
    const pcOnly = PC_ONLY.find((re) => re.test(name));
    if (pcOnly) {
      s.skipped.push({ name, why: "needs the PC" });
      continue;
    }
    const why = installOne(root, name, files ?? {});
    if (why) s.skipped.push({ name, why });
    else s.installed++;
  }
  // Skills this sync installed earlier and that no longer exist on the PC.
  const onPc = new Set(Array.isArray(u.names) ? u.names : []);
  if (onPc.size) {
    for (const e of fs.readdirSync(root, { withFileTypes: true })) {
      if (!e.isDirectory() || e.name.startsWith(".") || onPc.has(e.name)) continue;
      if (fs.existsSync(path.join(root, e.name, MARKER))) {
        fs.rmSync(path.join(root, e.name), { recursive: true, force: true });
        s.removed++;
      }
    }
  }
  status[u.agent] = { ...s, installed: (u.skills && Object.keys(u.skills).length ? s.installed : status[u.agent]?.installed) ?? 0 };
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
      const body = JSON.parse(gunzipSync(fs.readFileSync(file)).toString("utf8"));
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
