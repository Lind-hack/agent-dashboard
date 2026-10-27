import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AgentKey } from "./agents";
import { DATA_DIR } from "./config";

// The skills each agent really has on the VPS, so the "/" picker only offers ones that will run:
//   Claude — your skills (~/.claude/skills, synced from the PC), account skills synced from claude.ai
//            (anthropic-skills:<name>) and installed plugin skills (<plugin>:<skill>).
//   Codex  — ~/.codex/skills and ~/.agents/skills (synced from the PC).
//   OpenCode / Hermes — no skill loader of their own: your Claude skills, whose instructions get
//            included in the message (see promptWithSkills).

export type Skill = { name: string; invoke: string; description: string; source: "you" | "account" | "plugin" | "codex"; file: string };

const home = () => os.homedir();
const codexHome = () => process.env.CODEX_HOME ?? path.join(home(), ".codex");
const list = (d: string) => {
  try {
    return fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith("."));
  } catch {
    return [];
  }
};

// name + description from the SKILL.md frontmatter (folded YAML strings kept to one line).
function readSkill(file: string): { name?: string; description: string } | null {
  let head = "";
  try {
    const fd = fs.openSync(file, "r");
    const b = Buffer.alloc(4096);
    const n = fs.readSync(fd, b, 0, b.length, 0);
    fs.closeSync(fd);
    head = b.subarray(0, n).toString("utf8");
  } catch {
    return null;
  }
  const fm = head.match(/^---\s*\n([\s\S]*?)\n---/)?.[1] ?? "";
  const name = fm.match(/^name:\s*["']?([^"'\n]+)["']?\s*$/m)?.[1]?.trim();
  const desc = fm.match(/^description:\s*(?:[>|]-?\s*\n)?([\s\S]*?)(?=\n[a-zA-Z_-]+:|\s*$)/m)?.[1] ?? "";
  return { name, description: desc.replace(/\s+/g, " ").replace(/^["']|["']$/g, "").trim().slice(0, 220) };
}

function scan(dir: string, source: Skill["source"], prefix = ""): Skill[] {
  return list(dir).flatMap((e) => {
    const file = path.join(dir, e.name, "SKILL.md");
    const s = fs.existsSync(file) ? readSkill(file) : null;
    if (!s) return [];
    const base = e.name; // the folder name is what the CLIs invoke
    return [{ name: s.name && !s.name.includes(" ") ? s.name.replace(/^.*:/, "") : base, invoke: `${prefix}${base}`, description: s.description, source, file }];
  });
}

function claudeSkills(): Skill[] {
  const root = path.join(home(), ".claude");
  const own = scan(path.join(root, "skills"), "you").filter((s) => s.invoke !== "synced");
  const account = list(path.join(root, "skills", "synced")).flatMap((b) => scan(path.join(root, "skills", "synced", b.name), "account", "anthropic-skills:"));
  const plugins = list(path.join(root, "plugins", "synced")).flatMap((b) =>
    list(path.join(root, "plugins", "synced", b.name)).flatMap((p) => scan(path.join(root, "plugins", "synced", b.name, p.name, "skills"), "plugin", `${p.name}:`)),
  );
  return [...own, ...account, ...plugins];
}

function codexSkills(): Skill[] {
  const seen = new Set<string>();
  return [...scan(path.join(codexHome(), "skills"), "codex"), ...scan(path.join(home(), ".agents", "skills"), "codex")].filter((s) => !seen.has(s.invoke) && seen.add(s.invoke));
}

let cache: { at: number; claude: Skill[]; codex: Skill[] } | null = null;

export function skillsFor(agent: AgentKey): Skill[] {
  if (!cache || Date.now() - cache.at > 60_000) cache = { at: Date.now(), claude: claudeSkills(), codex: codexSkills() };
  const out = agent === "codex" ? cache.codex : agent === "claude" ? cache.claude : cache.claude.filter((s) => s.source === "you");
  return [...out].sort((a, b) => a.invoke.localeCompare(b.invoke));
}

const INLINE_CAP = 12_000;

// Keeps only skills this agent really has (exact names), deduped.
export function validSkills(agent: AgentKey, picked: unknown): string[] {
  if (!Array.isArray(picked)) return [];
  const known = new Set(skillsFor(agent).map((s) => s.invoke));
  return [...new Set(picked.filter((x): x is string => typeof x === "string" && known.has(x)))];
}

// What Lind sees in the chat for a turn: the skill tokens, then his words.
export const skillDisplay = (agent: AgentKey, skills: string[] | undefined, text: string) =>
  [(skills ?? []).map((s) => `${agent === "codex" ? "$" : "/"}${s}`).join(" "), text].filter(Boolean).join(" ");

// Runner side: turns the turn's picked skills (structured, never parsed from text) into each agent's
// own invocation. Re-checked against what's installed right now.
export function applySkills(agent: AgentKey, skills: string[] | undefined, prompt: string): string {
  const chosen = validSkills(agent, skills);
  if (!chosen.length) return prompt;
  if (agent === "claude") {
    // Claude runs a skill command only when it starts the prompt.
    const [first, ...rest] = chosen;
    return `/${first} ${prompt}${rest.length ? `\n\nAlso use these skills: ${rest.map((s) => `/${s}`).join(" ")}` : ""}`;
  }
  if (agent === "codex") return `${chosen.map((s) => `$${s}`).join(" ")}\n\n${prompt}`;
  // OpenCode / Hermes have no skill loader: include every picked skill's instructions.
  const files = new Map(skillsFor(agent).map((s) => [s.invoke, s.file]));
  const blocks = chosen.map((name) => {
    let body = "";
    try {
      body = fs.readFileSync(files.get(name)!, "utf8").slice(0, INLINE_CAP);
    } catch {
      /* removed since it was picked */
    }
    return `<skill name="${name}">\n${body}\n</skill>`;
  });
  return `Follow these skills for this task (from Lind's skill library):\n${blocks.join("\n\n")}\n\n## Lind's message\n${prompt}`;
}

// A GitHub repo / folder / SKILL.md URL for "Add a skill from GitHub" (runner/skills-github.ts installs it).
// `rest` is everything after /tree/ or /blob/: "<ref>/<path>", where the ref itself may contain slashes —
// the runner finds where the ref ends by asking GitHub.
export type GithubTarget = { owner: string; repo: string; rest?: string[] };

export function parseGithubUrl(raw: string): GithubTarget | null {
  let parts: string[];
  let host: string;
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "https:") return null;
    host = u.hostname;
    parts = u.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  } catch {
    return null;
  }
  if (host !== "github.com" && host !== "www.github.com") return null;
  const [owner, rawRepo, kind, ...rest] = parts;
  const repo = rawRepo?.replace(/\.git$/, "");
  const ok = (s?: string) => !!s && /^[\w.-]{1,100}$/.test(s) && !s.startsWith(".");
  if (!ok(owner) || !ok(repo)) return null;
  if (!kind) return { owner, repo };
  if ((kind !== "tree" && kind !== "blob") || !rest.length || rest.length > 30) return null;
  if (kind === "blob" && /^SKILL\.md$/i.test(rest[rest.length - 1])) rest.pop();
  if (!rest.length || rest.some((x) => x === "." || x === ".." || !/^[\w.@+() -][\w.@+() -]{0,119}$/.test(x))) return null;
  return { owner, repo, rest };
}

// What the runner wrote about skill syncs (runner/skills-sync.ts) — read-only here, for Settings.
type SyncRun = { at?: string; installed?: number; removed?: number; skipped?: { name: string; why: string }[] };
export type SkillsStatus = {
  claude?: SyncRun;
  codex?: SyncRun;
  github?: { at?: string; url?: string; installed?: string[]; unchanged?: string[]; skipped?: { name: string; why: string }[]; error?: string };
  fromGithub?: Record<string, { url?: string; commit?: string; at?: string }>;
  manifestAt?: string;
};
export function readSkillsStatus(): SkillsStatus {
  const read = (f: string) => {
    try {
      return JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), "utf8"));
    } catch {
      return null;
    }
  };
  return { ...(read("skills-status.json") ?? {}), manifestAt: read("pc-manifest.json")?.receivedAt };
}
