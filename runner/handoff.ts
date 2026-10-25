import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { WORK_DIR, repoShort } from "../lib/config";
import { HANDOFF_DIR, jobIdFor, readJSON, type HandoffMeta } from "../lib/handoff";
import { limited, nemotron, nvidiaModel, nvidiaReady } from "../lib/nvidia";
import { redact } from "../lib/redact";
import type { Job } from "../lib/store";

// Hand-off v2, VPS side. A published hand-off (handoffs/sessions/<sid>/<gen>/) becomes a job; `prepare`
// then builds everything the agent needs beside the code in `.handoff/`:
//   DOSSIER.md     — project-wide knowledge, written by Nemotron from all sources below
//   chats/         — this chat + related chats, condensed and redacted, for grep
//   memory/        — Lind's memory notes (the chat's project first)
//   instructions/  — CLAUDE.md files and rules from the PC
//   project/       — repo docs, recent commits, PRs, vault pages
//   sources.json   — what's in here, for the dashboard's Context panel
// and, for a native hand-off, installs the PC transcript so `claude --resume <id>` continues it.

const exec = promisify(execFile);

export type HandoffContext = {
  version: 1;
  thisChat: { id: string; agent: string; title: string; text: string };
  related: { id: string; agent: string; title: string; updated: string; cwd: string; text: string }[];
  memory: Record<string, Record<string, string>>; // PC project dir → file → text
  projectMemoryDir: string;
  instructions: { path: string; text: string }[];
  skills: Record<string, Record<string, string>>;
  pc: { createdAt: string; claudeVersion?: string };
};

export type SourceInfo = { kind: string; label: string; detail?: string; bytes?: number };

export const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32) || "chat";

// The job for a freshly published hand-off. Status "preparing" until `prepare` finishes.
export function jobFromHandoff(meta: HandoffMeta, base: string | undefined): Job {
  const now = new Date().toISOString();
  const id = jobIdFor(meta.generation);
  const short = meta.sessionId.slice(0, 6);
  return {
    id,
    agent: meta.agent,
    title: meta.title || "Hand-off from the PC",
    description: `Handed off from Lind's PC (${meta.agent} chat ${meta.sessionId}).`,
    repo: meta.repo ?? "",
    base,
    branch: meta.repo ? `pc/${slug(meta.title)}-${short}` : `pc/${short}`,
    fromSha: meta.snapshot?.sha,
    fetchRef: meta.snapshot?.ref,
    status: "preparing",
    sessionId: meta.mode === "native" ? meta.sessionId : undefined,
    imported: {
      sessionId: meta.sessionId,
      generation: meta.generation,
      mode: meta.mode,
      pcCwd: meta.pc.cwd,
      pcTranscriptPath: meta.pc.transcriptPath,
      pcProjectDir: meta.pc.projectDir,
      snapshot: meta.snapshot,
      dossier: "building",
      needsPreamble: true,
    },
    owner: "vps",
    turns: [],
    seenCommentIds: [],
    seenEvents: [],
    createdAt: now,
    updatedAt: now,
  };
}

const encodeProjectDir = (cwd: string) => cwd.replace(/[^A-Za-z0-9]/g, "-");
const archiveDir = () => path.join(HANDOFF_DIR(), "archive");
const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");

function writeFiles(dir: string, files: Record<string, string>) {
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, text] of Object.entries(files)) {
    const safe = path.basename(name).replace(/[^\w.@ -]/g, "_");
    if (!safe || safe.startsWith(".")) continue;
    fs.writeFileSync(path.join(dir, safe), text);
  }
}

// Claude: put the transcript in the project dir of the VPS cwd (an exact lookup hit), move any other
// copy of the same id out of ~/.claude/projects so resume is unambiguous, and point that project's
// memory at a private writable copy of the PC memory notes.
function installClaude(job: Job, hdir: string, cwd: string, ctx: HandoffContext | null) {
  const sid = job.imported!.sessionId;
  const projects = path.join(os.homedir(), ".claude", "projects");
  const proj = path.join(projects, encodeProjectDir(cwd));
  fs.mkdirSync(proj, { recursive: true });
  for (const d of fs.existsSync(projects) ? fs.readdirSync(projects) : []) {
    const f = path.join(projects, d, `${sid}.jsonl`);
    if (d !== path.basename(proj) && fs.existsSync(f)) {
      fs.mkdirSync(archiveDir(), { recursive: true });
      fs.renameSync(f, path.join(archiveDir(), `${stamp()}-${d}-${sid}.jsonl`));
    }
  }
  fs.copyFileSync(path.join(hdir, "transcript.jsonl"), path.join(proj, `${sid}.jsonl`));

  const overlay = path.join(hdir, "memory");
  if (!fs.existsSync(overlay)) {
    writeFiles(overlay, ctx?.memory?.[ctx.projectMemoryDir] ?? {});
    fs.cpSync(overlay, path.join(hdir, "memory-base"), { recursive: true }); // for the three-way return later
  }
  const link = path.join(proj, "memory");
  const st = fs.lstatSync(link, { throwIfNoEntry: false });
  if (st && !st.isSymbolicLink()) {
    fs.mkdirSync(archiveDir(), { recursive: true });
    fs.renameSync(link, path.join(archiveDir(), `${stamp()}-${path.basename(proj)}-memory`));
  }
  fs.rmSync(link, { force: true });
  fs.symlinkSync(overlay, link);
}

function installCodex(job: Job, hdir: string, meta: HandoffMeta) {
  const home = process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex");
  const name = path.basename(meta.pc.transcriptFile ?? `rollout-${job.imported!.sessionId}.jsonl`);
  const d = new Date(Number(meta.generation));
  const dir = path.join(home, "sessions", String(d.getUTCFullYear()), String(d.getUTCMonth() + 1).padStart(2, "0"), String(d.getUTCDate()).padStart(2, "0"));
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(path.join(hdir, "transcript.jsonl"), path.join(dir, name));
}

// The PC's CLAUDE.md, rules and the skills this chat used become the agent's own (one Claude turn runs
// at a time, so this never changes under a running turn).
function installInstructions(ctx: HandoffContext) {
  const claudeHome = path.join(os.homedir(), ".claude");
  const home = ctx.instructions.find((i) => /[\\/]CLAUDE\.md$/i.test(i.path) && /Users[\\/][^\\/]+[\\/]CLAUDE\.md$/i.test(i.path));
  if (home) {
    fs.writeFileSync(
      path.join(claudeHome, "CLAUDE.md"),
      `${home.text.trim()}\n\n## On the VPS (agent-dashboard runner)\n\nWhen this runs on Lind's VPS (Linux, user agent): Windows paths above describe his PC; here the shell is bash, repos are git worktrees under ${WORK_DIR}/wt/<job>, and you are already on the VPS (no ssh needed). Not available: Chrome/DevTools MCP, the PC D: drive, Windows tools. Never push, merge or deploy yourself — the runner pushes your branch and opens a PR. A handed-off chat has a .handoff/ folder next to the code: read .handoff/DOSSIER.md first.\n`,
    );
  }
  const rules = ctx.instructions.filter((i) => /[\\/]rules[\\/][^\\/]+\.md$/i.test(i.path));
  if (rules.length) writeFiles(path.join(claudeHome, "rules"), Object.fromEntries(rules.map((r) => [path.basename(r.path.replace(/\\/g, "/")), r.text])));
  for (const [name, files] of Object.entries(ctx.skills ?? {})) {
    if (/^[\w-]+$/.test(name)) writeFiles(path.join(claudeHome, "skills", name), files);
  }
}

async function sh(cwd: string, cmd: string, args: string[]): Promise<string> {
  try {
    return (await exec(cmd, args, { cwd, timeout: 60_000, maxBuffer: 8 * 1024 * 1024 })).stdout;
  } catch {
    return "";
  }
}

async function githubJSON<T>(url: string): Promise<T | null> {
  const token = process.env.GITHUB_READ_TOKEN ?? process.env.GITHUB_TOKEN;
  const res = await fetch(`https://api.github.com${url}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" } }).catch(() => null);
  return res?.ok ? ((await res.json().catch(() => null)) as T) : null;
}

const readCap = (f: string, n: number) => {
  try {
    const t = fs.readFileSync(f, "utf8");
    return t.length > n ? `${t.slice(0, n)}\n…(truncated)` : t;
  } catch {
    return "";
  }
};

// Project sources gathered on the VPS: repo docs, commits, PRs, vault pages.
async function projectSources(job: Job, cwd: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (job.repo) {
    for (const f of ["CLAUDE.md", "AGENTS.md", "README.md", "PLAN.md", "PRODUCT.md", "DESIGN.md"]) {
      const t = readCap(path.join(cwd, f), 30_000);
      if (t) out[`repo-${f}`] = t;
    }
    const log = await sh(cwd, "git", ["log", "-n", "120", "--date=short", "--format=%h %ad %s"]);
    if (log) out["commits.md"] = `# Recent commits on ${job.branch} (from the PC snapshot)\n\n${log}`;
    const prs = await githubJSON<{ number: number; title: string; state: string; merged_at: string | null; created_at: string; body: string | null; html_url: string }[]>(
      `/repos/${job.repo}/pulls?state=all&per_page=30&sort=updated&direction=desc`,
    );
    if (prs?.length) {
      out["pull-requests.md"] = `# Pull requests (latest 30)\n\n${prs
        .map((p) => `- #${p.number} ${p.title} — ${p.merged_at ? `merged ${p.merged_at.slice(0, 10)}` : p.state} · ${p.html_url}${p.body ? `\n  ${p.body.replace(/\s+/g, " ").slice(0, 300)}` : ""}`)
        .join("\n")}`;
    }
  }
  // Vault pages about this project (file names mentioning the repo), from the Obsidian brain.
  const vault = process.env.MEMORY_VAULT_DIR;
  const key = job.repo ? repoShort(job.repo).replace(/^-/, "").toLowerCase() : "";
  if (vault && key) {
    const hits: string[] = [];
    const walk = (d: string, depth: number) => {
      if (depth > 4 || hits.length >= 4) return;
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (e.name.startsWith(".")) continue;
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p, depth + 1);
        else if (e.name.endsWith(".md") && e.name.toLowerCase().includes(key)) hits.push(p);
      }
    };
    try {
      walk(vault, 0);
    } catch {
      /* vault not readable */
    }
    for (const h of hits) out[`vault-${path.basename(h)}`] = readCap(h, 15_000);
  }
  return out;
}

const SECTIONS = [
  "Goal & architecture",
  "Timeline (dated: what was built, fixed, shipped)",
  "Decisions (each with the reason, and what Lind rejected)",
  "How it runs (servers, paths, services, deploy, env vars by name — never values)",
  "Traps & lessons (bugs hit, root causes, things that must not be repeated)",
  "Lind's preferences & corrections",
  "Open work & to-dos (newest state)",
];

function chunks(text: string, size: number): string[] {
  const out: string[] = [];
  let cur = "";
  for (const part of text.split(/\n(?=## )/)) {
    if (cur && cur.length + part.length > size) {
      out.push(cur);
      cur = "";
    }
    cur += (cur ? "\n" : "") + part;
    while (cur.length > size) {
      out.push(cur.slice(0, size));
      cur = cur.slice(size);
    }
  }
  if (cur.trim()) out.push(cur);
  return out;
}

async function buildDossier(job: Job, ctx: HandoffContext, project: Record<string, string>, onProgress: (s: string) => void): Promise<string> {
  const map = `You read part of Lind's work history for one software project and extract durable knowledge.
Lind is a CS student who builds AI products (agent dashboard, a Kosovo news site, trading tools) with Claude Code and Codex.
Output markdown with exactly these headings (skip a heading if nothing applies):
${SECTIONS.map((s) => `## ${s}`).join("\n")}
Rules: only facts stated in the text; be specific — file paths, commands, branch names, commit ids, URLs, numbers, dates;
prefix timeline bullets with the date; note when something was later reversed; never copy secrets or token values.`;
  const parts: { label: string; text: string }[] = [];
  for (const c of chunks(ctx.thisChat.text, 60_000)) parts.push({ label: "the handed-off chat", text: c });
  let relatedBudget = 600_000;
  for (const r of ctx.related) {
    for (const c of chunks(r.text, 60_000)) {
      if (relatedBudget <= 0) break;
      relatedBudget -= c.length;
      parts.push({ label: `a related ${r.agent} chat "${r.title}" (${r.updated.slice(0, 10)})`, text: c });
    }
  }
  const memo = Object.entries(ctx.memory?.[ctx.projectMemoryDir] ?? {})
    .map(([f, t]) => `### memory/${f}\n${t}`)
    .join("\n\n");
  const proj = Object.entries(project)
    .map(([f, t]) => `### ${f}\n${t}`)
    .join("\n\n");
  for (const c of chunks(`${memo}\n\n${proj}`, 60_000)) parts.push({ label: "project sources (memory notes, repo docs, commits, PRs, vault)", text: c });

  let done = 0;
  const notes = await limited(
    4,
    parts.map((p) => async () => {
      const n = await nemotron(map, `Source: ${p.label}\n\n${p.text}`, { maxTokens: 3500 }).catch((e) => `(failed to read this part: ${e.message})`);
      onProgress(`read ${++done}/${parts.length} parts`);
      return `<!-- ${p.label} -->\n${n}`;
    }),
  );

  const reduce = `You merge extracted notes about one project into a single dossier for an AI coding agent that is taking over Lind's work.
Write markdown starting with "# Dossier: ${job.title.replace(/"/g, "'")}" and a 3-sentence "Where things stand" paragraph, then these sections:
${SECTIONS.map((s) => `## ${s}`).join("\n")}
Merge duplicates, keep every specific detail (paths, commands, ids, dates), order the timeline by date, and when notes conflict keep the newest and say what changed.
End with "## Where to look" listing that the full chats are in .handoff/chats/ (grep them for details) and memory notes in .handoff/memory/. Never include secrets.`;
  // Reduce in two levels if the notes are large.
  let merged = notes.join("\n\n");
  if (merged.length > 150_000) {
    const groups = chunks(merged, 120_000);
    merged = (await limited(3, groups.map((g) => () => nemotron(reduce, g, { maxTokens: 6000 })))).join("\n\n");
  }
  onProgress("writing the dossier");
  return nemotron(reduce, merged, { maxTokens: 8000 });
}

// Everything after the job exists: code, context folder, transcript install, dossier.
export async function prepareHandoff(
  job: Job,
  ensureCode: () => Promise<string>, // returns the cwd (worktree) — throws on git failure
  update: (patch: Partial<NonNullable<Job["imported"]>>, logText?: string) => void,
) {
  const imp = job.imported!;
  const hdir = path.join(HANDOFF_DIR(), "sessions", imp.sessionId, imp.generation);
  const meta = readJSON<HandoffMeta>(path.join(hdir, "meta.json"))!;
  const ctx = readJSON<HandoffContext>(path.join(hdir, "context.json"));
  let cwd: string;
  if (job.repo) {
    cwd = await ensureCode();
  } else {
    cwd = path.join(WORK_DIR, "conv", job.id);
    fs.mkdirSync(cwd, { recursive: true });
  }
  const ctxDir = path.join(cwd, ".handoff");
  fs.mkdirSync(ctxDir, { recursive: true });
  update({ contextDir: ctxDir });

  const sources: SourceInfo[] = [];
  const add = (kind: string, label: string, text?: string, detail?: string) => sources.push({ kind, label, detail, bytes: text ? Buffer.byteLength(text) : undefined });

  if (ctx) {
    const chats: Record<string, string> = { "this-chat.md": `# ${ctx.thisChat.title}\n\n${ctx.thisChat.text}` };
    add("chat", `This chat: ${ctx.thisChat.title}`, ctx.thisChat.text, `${ctx.thisChat.agent} · condensed, secrets removed`);
    for (const r of ctx.related) {
      chats[`${r.updated.slice(0, 10)}-${r.agent}-${r.id.slice(0, 8)}.md`] = `# ${r.title}\n\n(${r.agent}, last active ${r.updated}, ${r.cwd})\n\n${r.text}`;
      add("related", r.title, r.text, `${r.agent} · ${r.updated.slice(0, 10)}`);
    }
    writeFiles(path.join(ctxDir, "chats"), chats);
    const own = ctx.memory?.[ctx.projectMemoryDir] ?? {};
    writeFiles(path.join(ctxDir, "memory"), own);
    add("memory", `${Object.keys(own).length} memory notes`, Object.values(own).join(""), ctx.projectMemoryDir);
    for (const [dir, files] of Object.entries(ctx.memory ?? {})) {
      if (dir === ctx.projectMemoryDir || !Object.keys(files).length) continue;
      writeFiles(path.join(ctxDir, "memory", "other", dir.replace(/[^\w-]/g, "_")), files);
      add("memory", `${Object.keys(files).length} notes from ${dir}`, Object.values(files).join(""));
    }
    writeFiles(
      path.join(ctxDir, "instructions"),
      Object.fromEntries(ctx.instructions.map((i) => [i.path.replace(/[:\\/]+/g, "_"), i.text])),
    );
    for (const i of ctx.instructions) add("instructions", i.path, i.text);
    for (const name of Object.keys(ctx.skills ?? {})) add("skill", name, Object.values(ctx.skills[name]).join(""));
    installInstructions(ctx);
  }

  if (imp.mode === "native") {
    if (job.agent === "codex") installCodex(job, hdir, meta);
    else installClaude(job, hdir, cwd, ctx);
    add("session", "The live chat itself", fs.readFileSync(path.join(hdir, "transcript.jsonl"), "utf8"), `resumes as ${job.agent} session ${imp.sessionId}`);
  }
  if (imp.snapshot) add("code", `Branch ${job.branch}`, undefined, `PC snapshot ${imp.snapshot.sha.slice(0, 7)}${imp.snapshot.pcBranch ? ` of ${imp.snapshot.pcBranch}` : ""} · ${imp.snapshot.boundary}`);

  const project = await projectSources(job, cwd);
  writeFiles(path.join(ctxDir, "project"), project);
  for (const [f, t] of Object.entries(project)) add("project", f, t);

  const write = (status: "ready" | "failed", extra: Record<string, unknown> = {}) =>
    fs.writeFileSync(path.join(ctxDir, "sources.json"), JSON.stringify({ builtAt: new Date().toISOString(), model: nvidiaModel(), dossier: status, sources, ...extra }, null, 2));

  if (!ctx || !nvidiaReady()) {
    const why = !ctx ? "the hand-off had no context bundle" : "NVIDIA_API_KEY isn't set on the VPS";
    write("failed", { error: why });
    update({ dossier: "failed", dossierError: why }, `Context ready without a dossier (${why}) — the full chats and memory notes are in .handoff/.`);
    return;
  }
  const t0 = Date.now();
  try {
    const dossier = await buildDossier(job, ctx, project, (s) => update({}, `Dossier: ${s}`));
    const clean = redact(dossier).text;
    fs.writeFileSync(path.join(ctxDir, "DOSSIER.md"), clean);
    add("dossier", "Project dossier", clean, `${nvidiaModel()} · ${Math.round((Date.now() - t0) / 1000)}s`);
    write("ready");
    update({ dossier: "ready", dossierError: undefined }, `Context ready: dossier written from ${sources.length} sources in ${Math.round((Date.now() - t0) / 1000)}s.`);
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    write("failed", { error: why });
    update({ dossier: "failed", dossierError: why }, `Dossier failed (${why}) — the full chats and memory notes are still in .handoff/.`);
  }
}

// Sent ahead of Lind's first message from the phone.
export function handoffPreamble(job: Job): string {
  const imp = job.imported!;
  const dossier = imp.dossier === "ready";
  const lines = [
    `You are continuing ${imp.mode === "native" ? "this exact conversation" : "work from one of Lind's PC chats"} on his VPS (Linux, user agent), handed off from the PC with /handoff. Lind is now on his phone at agents.383ks.com.`,
    job.repo
      ? `The repo ${job.repo} is checked out in your current directory on branch ${job.branch}, created from his PC state (${imp.snapshot?.boundary ?? "snapshot"}). PC paths under ${imp.pcCwd} map to this directory.`
      : "This chat had no repo; your current directory is a scratch folder.",
    `Project context is in .handoff/ next to you:${dossier ? " .handoff/DOSSIER.md (read it first — it covers the whole project, not just this chat)," : ""} .handoff/chats/ (this chat and related chats in full, condensed — grep them before guessing about anything older), .handoff/memory/ (Lind's memory notes), .handoff/project/ (repo docs, commits, PRs, vault pages), .handoff/instructions/ (his CLAUDE.md files and rules).`,
    "Not available here: Chrome/DevTools MCP, the PC's D: drive and scratchpad, Windows tools. You are already on the VPS, so run commands locally instead of over ssh.",
    "The runner pushes your branch and opens a PR after each turn; never push, merge or deploy yourself.",
  ];
  if (imp.mode === "summary") {
    lines.push("This is a summary hand-off: you don't have the original session, so rely on .handoff/ for history.");
  }
  return lines.join("\n");
}

