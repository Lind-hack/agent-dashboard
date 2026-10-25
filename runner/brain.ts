import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { BRAIN_DIR, brainInbox, ITEM_KEY, queueBrainItem, readBrainStatus, type BrainItem, type BrainStatus } from "../lib/brain";
import { codexBin } from "../lib/config";
import { limited, nemotron, nvidiaModel, nvidiaReady } from "../lib/nvidia";
import { redact } from "../lib/redact";
import { listJobs } from "../lib/store";

// The brain, VPS side (plan §D). Writes into the Obsidian vault (MEMORY_VAULT_DIR, Syncthing-shared with
// the PC), following the vault's AGENTS.md (LLM-Wiki layers, append-only log.md, provenance):
//   wiki/sources/chats/<date> <agent> <id8> <slug>.md   one page per chat, regenerated when it changes
//   wiki/sources/commits/<repo> <date>.md               nightly, from GitHub (read-only token)
//   wiki/sources/graphs/<repo> <date>.md                graphify reports from the PC
//   wiki/entities/Project - <name>.md                   "Recent work" bullets, append-only
//   wiki/concepts/Lind — working style.md                corrections & preferences, append-only
//   log.md, index.md                                     append-only entries
//   wiki/maintenance/brain-status.md                     rewritten each run
// Every appended entry carries <!-- brain:<id> --> and is recorded in a ledger first-come, so retries and
// crashes never double-append. Only the weekly Luna pass edits existing pages, and only owned ones.

const vault = () => process.env.MEMORY_VAULT_DIR ?? "";
const stateFile = () => path.join(BRAIN_DIR(), "state.json");
const ledgerFile = () => path.join(BRAIN_DIR(), "ledger.ndjson");
const today = () => new Date().toISOString().slice(0, 10);
const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
const log = (...a: unknown[]) => console.log(new Date().toISOString(), "brain:", ...a);

type State = {
  pages: Record<string, string>; // item key → vault-relative page path
  github: Record<string, Record<string, string>>; // repo → branch → last seen tip
  seenShas: Record<string, string[]>;
  lastNightly?: string; // date
  lastWeekly?: string; // date
  dashboardCursor?: string; // ISO time
};

function readState(): State {
  try {
    const s = JSON.parse(fs.readFileSync(stateFile(), "utf8")) as Partial<State>;
    return { pages: s?.pages ?? {}, github: s?.github ?? {}, seenShas: s?.seenShas ?? {}, lastNightly: s?.lastNightly, lastWeekly: s?.lastWeekly, dashboardCursor: s?.dashboardCursor };
  } catch {
    return { pages: {}, github: {}, seenShas: {} };
  }
}
function writeState(s: State) {
  fs.mkdirSync(BRAIN_DIR(), { recursive: true });
  fs.writeFileSync(`${stateFile()}.tmp`, JSON.stringify(s));
  fs.renameSync(`${stateFile()}.tmp`, stateFile());
}

// ---------- status ----------

function setStatus(source: string, patch: { ok?: boolean; error?: string; items?: number; note?: string }) {
  const s: BrainStatus = readBrainStatus();
  const cur = s.sources[source] ?? {};
  const now = new Date().toISOString();
  s.sources[source] = {
    ...cur,
    lastRun: now,
    ...(patch.ok ? { lastOk: now, failures: 0, lastError: undefined } : {}),
    ...(patch.error ? { failures: (cur.failures ?? 0) + 1, lastError: patch.error.slice(0, 400) } : {}),
    ...(patch.items !== undefined ? { items: (cur.items ?? 0) + patch.items } : {}),
    ...(patch.note !== undefined ? { note: patch.note } : {}),
  };
  s.updatedAt = now;
  s.queue = queued().length;
  fs.mkdirSync(BRAIN_DIR(), { recursive: true });
  fs.writeFileSync(path.join(BRAIN_DIR(), "status.json.tmp"), JSON.stringify(s, null, 2));
  fs.renameSync(path.join(BRAIN_DIR(), "status.json.tmp"), path.join(BRAIN_DIR(), "status.json"));
}

let statusPageAt = 0;
function writeStatusPage(force = false) {
  if (!force && Date.now() - statusPageAt < 10 * 60_000) return;
  statusPageAt = Date.now();
  const s = readBrainStatus();
  const rows = Object.entries(s.sources)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `| ${k} | ${v.lastOk?.slice(0, 16).replace("T", " ") ?? "never"} | ${v.items ?? 0} | ${v.failures ?? 0} | ${(v.lastError ?? v.note ?? "").replace(/\|/g, "/").replace(/\n/g, " ").slice(0, 160)} |`);
  writeVault(
    "wiki/maintenance/brain-status.md",
    `---\ntype: maintenance\ngenerated: true\nupdated: ${today()}\n---\n> [!info] Rewritten by the brain (agent dashboard runner). Don't edit.\n\n# Brain status\n\nUpdated ${s.updatedAt ?? "-"} · queue ${s.queue ?? 0} · bulk model ${nvidiaModel()} · weekly gpt-6-luna (max)\n\n| Source | Last success (UTC) | Items | Failures in a row | Last error / note |\n|---|---|---|---|---|\n${rows.join("\n")}\n`,
  );
}

// ---------- vault writes ----------

function vaultPath(rel: string) {
  const root = path.resolve(vault());
  const p = path.resolve(root, rel);
  if (!p.startsWith(root + path.sep)) throw new Error(`refusing to write outside the vault: ${rel}`);
  return p;
}

// Atomic replace. The temp name follows Syncthing's own pattern, so Syncthing never ships it.
function writeVault(rel: string, text: string) {
  const p = vaultPath(rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = path.join(path.dirname(p), `.syncthing.${path.basename(p)}.tmp`);
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, p);
}

const readVault = (rel: string) => {
  try {
    return fs.readFileSync(vaultPath(rel), "utf8");
  } catch {
    return null;
  }
};

let ledger: Set<string> | null = null;
function inLedger(id: string) {
  if (!ledger) {
    ledger = new Set();
    try {
      for (const l of fs.readFileSync(ledgerFile(), "utf8").split("\n")) if (l.trim()) ledger.add(l.trim());
    } catch {
      /* first run */
    }
  }
  return ledger.has(id);
}

// Appends `text` once per entry id: skipped if the ledger or the page already has it.
function appendOnce(rel: string, id: string, text: string, header?: string) {
  if (inLedger(id)) return;
  const cur = readVault(rel);
  const marker = `<!-- brain:${id} -->`;
  if (!cur?.includes(marker)) {
    const p = vaultPath(rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    if (cur === null && header) writeVault(rel, header);
    const lead = cur && !cur.endsWith("\n") ? "\n" : "";
    fs.appendFileSync(p, `${lead}${text.trimEnd()} ${marker}\n`);
  }
  const fd = fs.openSync(ledgerFile(), "a");
  fs.writeSync(fd, `${id}\n`);
  fs.fsyncSync(fd);
  fs.closeSync(fd);
  ledger!.add(id);
}

export function vaultWritable(): string | null {
  if (!vault()) return "MEMORY_VAULT_DIR isn't set";
  try {
    fs.mkdirSync(vaultPath("wiki/sources/chats"), { recursive: true });
    fs.accessSync(vaultPath("wiki/sources/chats"), fs.constants.W_OK);
    fs.accessSync(vaultPath("log.md"), fs.constants.W_OK);
    fs.accessSync(vaultPath("index.md"), fs.constants.W_OK);
    return null;
  } catch {
    return "the dashboard can't write the vault's wiki/, log.md and index.md yet — run deploy/vault-access.sh on the VPS";
  }
}

// ---------- pages ----------

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "chat";
const safeName = (s: string) => s.replace(/[\\/:*?"<>|#^[\]]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
const yamlStr = (s: string) => JSON.stringify(s);

const SECTIONS = [
  "Summary",
  "Goals",
  "Decisions (with reasons)",
  "Lind's corrections & preferences",
  "Built & verified",
  "Failures & fixes",
  "Commands, files, commits, URLs",
  "People & services",
  "Open threads",
];

function chunks(text: string, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

const ABOUT = "Lind is a CS student in Kosovo who builds AI products (an agent dashboard, a Kosovo news site, trading tools, content automation) with Claude Code and Codex.";

async function summarize(item: BrainItem): Promise<string> {
  const what = item.kind === "graph" ? "a graphify knowledge-graph report of a code repository" : `a ${item.agent} chat between Lind and an AI coding agent`;
  const page = `You turn ${what} into a page for Lind's second brain. ${ABOUT}
Write markdown with exactly these "## " headings, in order (skip one only if nothing applies):
${SECTIONS.map((s) => `## ${s}`).join("\n")}
"## Summary" is 2–4 sentences: what this was about and how it ended. Bullets everywhere else.
Rules: only facts from the text; be specific — file paths, commands, branch names, commit ids, URLs, numbers, dates;
under corrections & preferences, write each as a durable rule about how Lind wants things done ("Lind wants …");
note when something was later reversed; never copy secrets, tokens or keys; don't add a title.`;
  const parts = chunks(item.text, 60_000);
  if (parts.length === 1) return nemotron(page, `Title: ${item.title}\nProject: ${item.project}\n\n${item.text}`, { maxTokens: 4000 });
  const map = `You read one part of ${what} and extract notes for Lind's second brain. ${ABOUT}
Use these "## " headings (skip empty ones): ${SECTIONS.slice(1).join(" · ")}.
Only facts from the text, specific (paths, commands, ids, URLs, dates), never secrets.`;
  const notes = await limited(
    3,
    parts.map((p, i) => () => nemotron(map, `Part ${i + 1} of ${parts.length} — ${item.title}\n\n${p}`, { maxTokens: 3000 }).catch((e) => `(part ${i + 1} unreadable: ${e.message})`)),
  );
  let merged = notes.map((n, i) => `<!-- part ${i + 1} -->\n${n}`).join("\n\n");
  if (merged.length > 150_000) merged = merged.slice(0, 150_000);
  return nemotron(`${page}\nYou are given extracted notes from all parts, in order — merge them, keeping every specific detail.`, `Title: ${item.title}\nProject: ${item.project}\n\n${merged}`, { maxTokens: 6000 });
}

const sectionOf = (md: string, heading: string) => {
  const block = md.split(/^## /m).find((b) => b.toLowerCase().startsWith(heading.toLowerCase()));
  return block ? block.slice(block.indexOf("\n") + 1).trim() : "";
};

function projectPage(project: string) {
  return `wiki/entities/Project - ${safeName(project) || "misc"}.md`;
}
const projectHeader = (project: string) =>
  `---\ntype: entity\nstatus: seed\ngenerated: true\ncreated: ${today()}\nupdated: ${today()}\ntags:\n  - project\n  - brain\n---\n> [!info] Created by the brain. "Recent work" is appended automatically; the weekly synthesis rewrites "Current state". Edit freely above "Recent work".\n\n# ${project}\n\n## Current state\n\n_(Filled in by the weekly synthesis.)_\n\n## Recent work\n`;
const STYLE_PAGE = "wiki/concepts/Lind — working style.md";
const styleHeader = `---\ntype: concept\nstatus: active\ngenerated: true\ncreated: ${today()}\nupdated: ${today()}\ntags:\n  - lind\n  - preferences\n  - brain\n---\n> [!info] How Lind wants agents to work, learned from his chats. Appended by the brain; the weekly synthesis consolidates it.\n\n# Lind — working style\n\n## Learned from chats\n`;

async function processItem(item: BrainItem, state: State) {
  const key = ITEM_KEY(item);
  const body = redact(await summarize(item)).text;
  const date = (item.firstAt || item.lastAt || new Date().toISOString()).slice(0, 10);
  const folder = item.kind === "graph" ? "graphs" : "chats";
  const fileName =
    item.kind === "graph" ? `${safeName(item.project)} ${(item.lastAt || new Date().toISOString()).slice(0, 10)}` : `${date} ${item.kind === "dashboard" ? "dashboard" : item.agent} ${item.id.slice(0, 8)} ${slug(item.title)}`;
  const rel = state.pages[key] ?? `wiki/sources/${folder}/${fileName}.md`;
  const isNew = !state.pages[key];
  const fm = [
    "---",
    "type: source",
    `source_kind: ${item.kind === "graph" ? "code-graph" : item.kind === "dashboard" ? "dashboard-chat" : "agent-chat"}`,
    "generated: true",
    `agent: ${yamlStr(item.agent)}`,
    `id: ${yamlStr(item.id)}`,
    `project: ${yamlStr(item.project)}`,
    `title: ${yamlStr(item.title)}`,
    `created: ${date}`,
    `updated: ${(item.lastAt || new Date().toISOString()).slice(0, 10)}`,
    ...(item.source ? [`origin: ${yamlStr(item.source)}`] : []),
    "tags:",
    "  - brain",
    `  - ${item.kind === "graph" ? "code-graph" : "agent-chat"}`,
    "---",
  ].join("\n");
  writeVault(
    rel,
    `${fm}\n> [!info] Generated by the brain (${nvidiaModel()}) from a condensed, redacted ${item.kind === "graph" ? "graph report" : "chat"}; regenerated when it changes. Edit [[${projectPage(item.project).replace(/\.md$/, "")}|the project page]] instead.\n\n# ${item.title || item.id}\n\n${body}\n`,
  );
  state.pages[key] = rel;
  writeState(state);

  const link = `[[${rel.replace(/\.md$/, "")}|${(item.title || item.id).replace(/[|\]]/g, " ").slice(0, 90)}]]`;
  const oneLine = sectionOf(body, "Summary").replace(/\s+/g, " ").slice(0, 300);
  const version = sha(item.lastAt + item.text.length).slice(0, 8);
  appendOnce("log.md", `log-${key}-${version}`, `\n## [${today()}] ingest | ${item.kind === "graph" ? "Graph" : "Chat"}: ${(item.title || item.id).replace(/\n/g, " ").slice(0, 120)}\n${isNew ? "New" : "Updated"} ${link} (${item.project}). ${oneLine}`);
  if (isNew) appendOnce("index.md", `index-${key}`, `- ${link} — ${item.kind === "graph" ? "code graph" : `${item.agent} chat`}, ${item.project}, ${date}`, undefined);
  appendOnce(projectPage(item.project), `recent-${key}-${version}`, `- ${(item.lastAt || date).slice(0, 10)} · ${link} — ${oneLine.slice(0, 200)}`, projectHeader(item.project));

  for (const line of sectionOf(body, "Lind's corrections & preferences").split("\n")) {
    const t = line.replace(/^\s*[-*]\s+/, "").trim();
    if (t.length < 12 || /^none|^no (corrections|preferences)/i.test(t)) continue;
    appendOnce(STYLE_PAGE, `style-${sha(t.toLowerCase().replace(/\W+/g, " ")).slice(0, 16)}`, `- ${t} (from ${link})`, styleHeader);
  }
}

const queued = () => {
  try {
    return fs
      .readdirSync(brainInbox())
      .filter((f) => f.endsWith(".json"))
      .map((f) => path.join(brainInbox(), f));
  } catch {
    return [];
  }
};

// ---------- GitHub commits (nightly) ----------

async function gh<T>(url: string): Promise<{ ok: boolean; status: number; body: T | null }> {
  const token = process.env.GITHUB_READ_TOKEN ?? process.env.GITHUB_TOKEN;
  const res = await fetch(`https://api.github.com${url}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" } });
  return { ok: res.ok, status: res.status, body: (await res.json().catch(() => null)) as T | null };
}

type GhCommit = { sha: string; commit: { message: string; author?: { name?: string; date?: string } } };

async function collectCommits(state: State) {
  const repos = await gh<{ full_name: string; archived: boolean; pushed_at: string }[]>("/user/repos?per_page=100&affiliation=owner,collaborator&sort=pushed");
  if (!repos.ok || !Array.isArray(repos.body)) throw new Error(`GitHub repo list: HTTP ${repos.status}`);
  let total = 0;
  for (const r of repos.body) {
    const tips = (state.github[r.full_name] ??= {});
    // Untouched since our last look: skip the branch calls.
    if (Object.keys(tips).length && state.lastNightly && r.pushed_at.slice(0, 10) < state.lastNightly) continue;
    const branches = await gh<{ name: string; commit: { sha: string } }[]>(`/repos/${r.full_name}/branches?per_page=100`);
    if (!branches.ok || !Array.isArray(branches.body)) continue;
    const seen = new Set(state.seenShas[r.full_name] ?? []);
    const found: { sha: string; branch: string; date: string; author: string; message: string; forced?: boolean }[] = [];
    for (const b of branches.body) {
      const old = tips[b.name];
      if (old === b.commit.sha) continue;
      let commits: GhCommit[] = [];
      let forced = false;
      if (old) {
        const cmp = await gh<{ status: string; commits: GhCommit[] }>(`/repos/${r.full_name}/compare/${old}...${b.commit.sha}`);
        if (cmp.ok && cmp.body) {
          commits = cmp.body.commits ?? [];
          forced = cmp.body.status === "diverged" || cmp.body.status === "behind";
        }
      }
      if (!old || !commits.length) {
        const since = new Date(Date.now() - (old ? 3 : 14) * 86400_000).toISOString();
        const list = await gh<GhCommit[]>(`/repos/${r.full_name}/commits?sha=${encodeURIComponent(b.name)}&since=${since}&per_page=100`);
        commits = Array.isArray(list.body) ? list.body : [];
      }
      for (const c of commits.slice(-500)) {
        if (seen.has(c.sha)) continue;
        seen.add(c.sha);
        found.push({ sha: c.sha, branch: b.name, date: c.commit.author?.date ?? "", author: c.commit.author?.name ?? "", message: redact(c.commit.message).text, forced });
      }
    }
    if (found.length) {
      found.sort((a, b) => a.date.localeCompare(b.date));
      const repoName = r.full_name.split("/")[1];
      const rel = `wiki/sources/commits/${safeName(repoName)} ${today()}.md`;
      const lines = found.map((c) => {
        const [subject, ...rest] = c.message.split("\n");
        const body = rest.join(" ").replace(/\s+/g, " ").trim().slice(0, 300);
        return `- \`${c.sha.slice(0, 7)}\` ${c.date.slice(0, 16).replace("T", " ")} · ${c.branch}${c.forced ? " (after a force-push)" : ""} — ${subject.trim()}${body ? `\n  ${body}` : ""}`;
      });
      const existing = readVault(rel);
      writeVault(
        rel,
        existing
          ? `${existing.trimEnd()}\n\n## Run ${new Date().toISOString().slice(11, 16)} UTC\n${lines.join("\n")}\n`
          : `---\ntype: source\nsource_kind: git-commits\ngenerated: true\nrepo: ${yamlStr(r.full_name)}\ncreated: ${today()}\nupdated: ${today()}\ntags:\n  - brain\n  - commits\n---\n> [!info] Commits pushed to GitHub, collected nightly by the brain.\n\n# ${repoName} — commits ${today()}\n\n${lines.join("\n")}\n`,
      );
      const link = `[[${rel.replace(/\.md$/, "")}|${repoName} commits ${today()}]]`;
      const branchesTouched = [...new Set(found.map((c) => c.branch))].slice(0, 5).join(", ");
      appendOnce("log.md", `log-commits-${r.full_name}-${today()}-${found[0].sha.slice(0, 8)}`, `\n## [${today()}] ingest | Commits: ${repoName} (${found.length})\n${link} on ${branchesTouched}: ${found.slice(-3).map((c) => c.message.split("\n")[0].slice(0, 80)).join(" · ")}`);
      appendOnce(projectPage(repoName), `recent-commits-${r.full_name}-${today()}-${found[0].sha.slice(0, 8)}`, `- ${today()} · ${found.length} commit${found.length > 1 ? "s" : ""} on ${branchesTouched} (${link})`, projectHeader(repoName));
      total += found.length;
    }
    // Cursor moves only after the page is written.
    for (const b of branches.body) tips[b.name] = b.commit.sha;
    state.seenShas[r.full_name] = [...seen].slice(-3000);
    writeState(state);
  }
  return total;
}

// ---------- dashboard chats (nightly) ----------

function queueDashboardChats(state: State) {
  const since = state.dashboardCursor ?? new Date(Date.now() - 14 * 86400_000).toISOString();
  const quiet = Date.now() - 20 * 60_000;
  let n = 0;
  let newest = since;
  for (const job of listJobs()) {
    if (job.updatedAt <= since || new Date(job.updatedAt).getTime() > quiet || !job.turns.length || job.status === "running" || job.status === "preparing") continue;
    const text = job.turns
      .map((t) => `## Lind (${t.startedAt?.slice(0, 16) ?? ""})\n${t.prompt.slice(0, 20_000)}\n\n## ${job.agent}${t.ok === false ? " (failed)" : ""}\n${(t.result ?? "").slice(0, 40_000)}`)
      .join("\n\n");
    queueBrainItem({
      kind: "dashboard",
      id: job.id,
      agent: job.agent,
      title: job.title,
      project: job.repo ? job.repo.split("/")[1] : "dashboard",
      firstAt: job.createdAt,
      lastAt: job.updatedAt,
      text: redact(`${job.description ? `Task: ${job.description}\n\n` : ""}${text}`).text,
      source: `agents.383ks.com/jobs/${job.id}`,
    });
    n++;
    if (job.updatedAt > newest) newest = job.updatedAt;
  }
  state.dashboardCursor = newest;
  writeState(state);
  return n;
}

// ---------- weekly synthesis (Luna) ----------

// Paths the weekly pass may change; everything else in its diff is discarded and listed.
const WEEKLY_OWNED = [/^wiki\/entities\/[^/]+\.md$/, /^wiki\/synthesis\.md$/, /^index\.md$/, /^wiki\/maintenance\/Open Questions\.md$/, /^wiki\/concepts\/Lind — working style\.md$/];

function listFiles(root: string, rel = ""): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.name.startsWith(".")) continue;
    if (e.isDirectory()) out.push(...listFiles(root, r));
    else if (e.isFile() && e.name.endsWith(".md")) out.push(r);
  }
  return out;
}

function runCodex(cwd: string, prompt: string, timeoutMs: number): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    const args = ["exec", "--json", "--dangerously-bypass-approvals-and-sandbox", "--skip-git-repo-check", "-m", process.env.BRAIN_WEEKLY_MODEL ?? "gpt-6-luna", "-c", 'model_reasoning_effort="max"', prompt];
    const child = spawn(codexBin(), args, { cwd, stdio: ["ignore", "pipe", "pipe"], detached: true });
    let out = "";
    let err = "";
    child.stdout.on("data", (b: Buffer) => (out = (out + b.toString()).slice(-20_000)));
    child.stderr.on("data", (b: Buffer) => (err = (err + b.toString()).slice(-4000)));
    const timer = setTimeout(() => {
      try {
        process.kill(-child.pid!, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    }, timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      const failed = /"type":"(error|turn\.failed)"/.test(out);
      resolve({ ok: code === 0 && !failed, out: code === 0 && !failed ? out : `exit ${code}: ${(out.match(/"message":"([^"]{0,300})/)?.[1] ?? err).slice(-400)}` });
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ ok: false, out: e.message });
    });
  });
}

async function weeklySynthesis(): Promise<string> {
  const root = path.resolve(vault());
  const stage = path.join(BRAIN_DIR(), "weekly", today());
  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(stage, { recursive: true });
  for (const f of ["AGENTS.md", "index.md", "log.md"]) if (fs.existsSync(path.join(root, f))) fs.copyFileSync(path.join(root, f), path.join(stage, f));
  fs.cpSync(path.join(root, "wiki"), path.join(stage, "wiki"), { recursive: true, filter: (s) => !path.basename(s).startsWith(".syncthing.") });
  const pre = new Map(listFiles(stage).map((f) => [f, sha(fs.readFileSync(path.join(stage, f), "utf8"))]));

  const prompt = `You are the weekly editor of Lind's second brain — an Obsidian vault that follows AGENTS.md in this folder (read it first; it is the contract).
During the week an automated "brain" appended raw material: chat pages in wiki/sources/chats/, commit pages in wiki/sources/commits/, graph reports in wiki/sources/graphs/, "Recent work" bullets on wiki/entities/Project - *.md pages, and lines in "wiki/concepts/Lind — working style.md". See log.md entries from the last 7 days (marked <!-- brain:… -->).
Your job, at maximum care:
1. For every "wiki/entities/Project - *.md" page touched this week: rewrite its "## Current state" section into an accurate, dense picture (goal, architecture, how it runs, recent decisions with reasons, open work, traps), citing the source pages with [[links]]. Keep "## Recent work" as is (you may trim bullets older than 60 days).
2. Consolidate "wiki/concepts/Lind — working style.md": merge duplicates, group by theme, keep each rule specific, keep source links.
3. Update wiki/synthesis.md with what changed in the overall picture this week, and wiki/maintenance/Open Questions.md with genuinely open questions or contradictions you found.
4. Update index.md so every page above is listed.
Only edit those files (and create new entity pages if a clearly distinct project/person/system appears). Do not edit or delete source pages, raw/, log.md or anything else — other changes are discarded. Never write secrets. Be faithful to the sources; label uncertainty.`;
  const res = await runCodex(stage, prompt, 90 * 60_000);
  if (!res.ok) throw new Error(`Luna: ${res.out}`);

  const applied: string[] = [];
  const skipped: string[] = [];
  for (const f of listFiles(stage)) {
    const now = sha(fs.readFileSync(path.join(stage, f), "utf8"));
    if (pre.get(f) === now) continue;
    if (!WEEKLY_OWNED.some((re) => re.test(f))) {
      skipped.push(`${f} (not an owned path)`);
      continue;
    }
    const live = readVault(f);
    if (pre.has(f) && (live === null || sha(live) !== pre.get(f))) {
      skipped.push(`${f} (changed in the vault meanwhile)`);
      continue;
    }
    if (!pre.has(f) && live !== null) {
      skipped.push(`${f} (created in the vault meanwhile)`);
      continue;
    }
    writeVault(f, fs.readFileSync(path.join(stage, f), "utf8"));
    applied.push(f);
  }
  appendOnce(
    "log.md",
    `log-weekly-${today()}`,
    `\n## [${today()}] lint | Weekly synthesis (gpt-6-luna, max reasoning)\nUpdated ${applied.length} page${applied.length === 1 ? "" : "s"}: ${applied.map((f) => `[[${f.replace(/\.md$/, "")}]]`).join(", ") || "none"}.${skipped.length ? ` Discarded: ${skipped.join("; ")}.` : ""}`,
  );
  fs.rmSync(stage, { recursive: true, force: true });
  return `${applied.length} pages updated${skipped.length ? `, ${skipped.length} changes discarded` : ""}`;
}

// ---------- the loop ----------

let busy = false;

// Called every runner tick. Does at most one unit of work at a time, in the background.
// `codexSlot` claims the runner's Codex slot for the weekly pass (one Codex context user at a time).
export function brainTick(codexSlot: { take: () => boolean; release: () => void }) {
  if (busy || process.env.BRAIN_ENABLED === "0") return;
  busy = true;
  void step(codexSlot)
    .catch((e) => log(e instanceof Error ? e.message : e))
    .finally(() => {
      busy = false;
    });
}

async function step(codexSlot: { take: () => boolean; release: () => void }) {
  const blocked = vaultWritable();
  if (blocked) {
    const s = readBrainStatus().sources.vault;
    if (s?.lastError !== blocked || Date.now() - new Date(s?.lastRun ?? 0).getTime() > 6 * 3600_000) setStatus("vault", { error: blocked });
    return;
  }
  if (readBrainStatus().sources.vault?.failures) setStatus("vault", { ok: true, note: "writable" });
  const state = readState();
  const now = new Date();

  // Nightly at 02:30 UTC: GitHub commits + dashboard chats into the queue.
  if (state.lastNightly !== today() && (now.getUTCHours() > 2 || (now.getUTCHours() === 2 && now.getUTCMinutes() >= 30))) {
    state.lastNightly = today(); // one attempt per day; failures show in the status and the Inbox
    writeState(state);
    try {
      const n = await collectCommits(state);
      setStatus("github", { ok: true, items: n });
    } catch (e) {
      setStatus("github", { error: e instanceof Error ? e.message : String(e) });
    }
    try {
      setStatus("dashboard", { ok: true, items: queueDashboardChats(state) });
    } catch (e) {
      setStatus("dashboard", { error: e instanceof Error ? e.message : String(e) });
    }
    writeStatusPage(true);
    return;
  }

  // Weekly on Sunday from 18:00 UTC: Luna edits a staging copy; owned changes are applied.
  if (now.getUTCDay() === 0 && now.getUTCHours() >= 18 && state.lastWeekly !== today() && codexSlot.take()) {
    state.lastWeekly = today();
    writeState(state);
    try {
      setStatus("weekly", { ok: true, items: 1, note: await weeklySynthesis() });
    } catch (e) {
      setStatus("weekly", { error: e instanceof Error ? e.message : String(e) });
    } finally {
      codexSlot.release();
    }
    writeStatusPage(true);
    return;
  }

  // Otherwise: the next queued chat / graph / dashboard chat.
  // A file's mtime is when it's due: failed items are pushed into the future (backoff).
  const next = queued()
    .map((f) => ({ f, due: fs.statSync(f).mtimeMs }))
    .filter((x) => x.due <= Date.now())
    .sort((a, b) => a.due - b.due)[0]?.f;
  if (!next) return writeStatusPage();
  if (!nvidiaReady()) return setStatus("nemotron", { error: "NVIDIA_API_KEY isn't set on the VPS" });
  const raw = fs.readFileSync(next, "utf8");
  const item = JSON.parse(raw) as BrainItem;
  const source = item.kind === "dashboard" ? "dashboard" : item.kind === "graph" ? "graphify" : `${item.agent}-chats`;
  try {
    await processItem(item, state);
    // A newer upload of the same chat may have replaced the file meanwhile — keep that one queued.
    if (fs.existsSync(next) && fs.readFileSync(next, "utf8") === raw) fs.rmSync(next);
    fs.rmSync(`${next}.fails`, { force: true });
    setStatus(source, { ok: true, items: 1 });
    log("page", ITEM_KEY(item));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    setStatus(source, { error: `${item.title || item.id}: ${msg}` });
    // Retry later (20 min, 40, 80, 160), then park it in failed/ so one bad chat can't block the queue.
    const fails = (Number(fs.existsSync(`${next}.fails`) ? fs.readFileSync(`${next}.fails`, "utf8") : 0) || 0) + 1;
    if (fails >= 5) {
      fs.mkdirSync(path.join(BRAIN_DIR(), "failed"), { recursive: true });
      fs.renameSync(next, path.join(BRAIN_DIR(), "failed", path.basename(next)));
      fs.rmSync(`${next}.fails`, { force: true });
    } else {
      fs.writeFileSync(`${next}.fails`, String(fails));
      const due = new Date(Date.now() + 20 * 60_000 * 2 ** (fails - 1));
      fs.utimesSync(next, due, due);
    }
  }
  writeStatusPage();
}
