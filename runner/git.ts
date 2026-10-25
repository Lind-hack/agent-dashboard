import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { githubToken, WORK_DIR, type RepoKey } from "../lib/config";

const exec = promisify(execFile);

// The token only ever travels as a per-command header — it is never written to a remote URL
// or git config, so the agent (which runs in the same checkout) can't read it back from there.
function authArgs(): string[] {
  const basic = Buffer.from(`x-access-token:${githubToken()}`).toString("base64");
  return ["-c", `http.https://github.com/.extraheader=Authorization: Basic ${basic}`];
}

// Error messages from execFile include the full command line — which carries the auth header — so
// they are rebuilt from the subcommand and a scrubbed stderr before they can reach logs, the UI or Linear.
const scrub = (s: string) => s.replace(/(extraheader=)?Authorization: Basic [A-Za-z0-9+/=]+/g, "[redacted]").replace(/(gh[pousr]_|github_pat_)[A-Za-z0-9_]+/g, "[redacted]");

export async function git(cwd: string, args: string[], withAuth = false): Promise<string> {
  try {
    const { stdout } = await exec("git", [...(withAuth ? authArgs() : []), ...args], {
      cwd,
      timeout: 5 * 60_000,
      maxBuffer: 20 * 1024 * 1024,
    });
    return stdout.trim();
  } catch (err) {
    const stderr = String((err as { stderr?: string })?.stderr ?? "").trim();
    throw new Error(scrub(`git ${args[0]} failed${stderr ? `: ${stderr.slice(-600)}` : ""}`));
  }
}

// One clone/fetch/worktree change per repo at a time: Ask-all starts several agents on the same repo
// at once, and concurrent `git clone`/`fetch` into one directory collide.
const repoLocks = new Map<string, Promise<unknown>>();
function withRepoLock<T>(repo: string, fn: () => Promise<T>): Promise<T> {
  const prev = repoLocks.get(repo) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  repoLocks.set(repo, next);
  return next;
}

const repoDir = (repo: RepoKey) => path.join(WORK_DIR, "repos", repo.replace("/", "__"));
export const worktreeDir = (jobId: string) => path.join(WORK_DIR, "wt", jobId);

// New work branches off `base`; a hand-off continues `fromBranch` exactly where the PC left it, or (v2)
// starts at `fromSha`, the PC snapshot commit published under the hidden ref `fetchRef`.
type WorktreeOpts = { repo: RepoKey; base: string; jobId: string; branch: string; fromBranch?: string; fromSha?: string; fetchRef?: string };

export function ensureWorktree(opts: WorktreeOpts) {
  return withRepoLock(opts.repo, () => ensureWorktreeLocked(opts));
}

async function ensureWorktreeLocked(opts: WorktreeOpts) {
  const dir = repoDir(opts.repo);
  if (!fs.existsSync(path.join(dir, ".git"))) {
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    await git(path.dirname(dir), ["clone", `https://github.com/${opts.repo}.git`, dir], true);
  }
  await git(dir, ["fetch", "--prune", "origin"], true);
  if (opts.fetchRef && /^refs\/agent-handoff\/[\w-]+\/\d+$/.test(opts.fetchRef)) {
    await git(dir, ["fetch", "origin", `+${opts.fetchRef}:${opts.fetchRef}`], true);
  }
  // Hand-off context lives beside the code and must never be committed.
  const exclude = path.join(dir, ".git", "info", "exclude");
  if (!fs.existsSync(exclude) || !fs.readFileSync(exclude, "utf8").includes(".handoff/")) {
    fs.mkdirSync(path.dirname(exclude), { recursive: true });
    fs.appendFileSync(exclude, "\n.handoff/\n");
  }
  const wt = worktreeDir(opts.jobId);
  if (!fs.existsSync(wt)) {
    fs.mkdirSync(path.dirname(wt), { recursive: true });
    await git(dir, ["worktree", "prune"]);
    const start = opts.fromSha && /^[0-9a-f]{40}$/.test(opts.fromSha) ? opts.fromSha : `origin/${opts.fromBranch ?? opts.base}`;
    await git(dir, ["worktree", "add", "-B", opts.branch, wt, start]);
  }
  return wt;
}

export async function removeWorktree(repo: RepoKey, jobId: string) {
  const wt = worktreeDir(jobId);
  if (!fs.existsSync(wt)) return;
  await git(repoDir(repo), ["worktree", "remove", "--force", wt]).catch(() => fs.rmSync(wt, { recursive: true, force: true }));
}

// Commits anything the agent left uncommitted, then pushes the branch. Returns false when there is nothing to push.
export async function pushBranch(wt: string, base: string, branch: string, jobId: string): Promise<boolean> {
  if (await git(wt, ["status", "--porcelain"])) {
    await git(wt, ["add", "-A"]);
    await git(wt, ["commit", "-m", `${jobId}: uncommitted agent changes`]);
  }
  const ahead = Number(await git(wt, ["rev-list", "--count", `origin/${base}..HEAD`]));
  if (!ahead) return false;
  await git(wt, ["push", "origin", `HEAD:refs/heads/${branch}`], true);
  return true;
}

export async function ensurePullRequest(opts: { repo: RepoKey; base: string; branch: string; title: string; body: string }): Promise<string | null> {
  const headers = {
    Authorization: `Bearer ${githubToken()}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const owner = opts.repo.split("/")[0];
  const existing = await fetch(`https://api.github.com/repos/${opts.repo}/pulls?head=${owner}:${opts.branch}&state=open`, { headers });
  const open = (await existing.json().catch(() => [])) as { html_url?: string }[];
  if (Array.isArray(open) && open[0]?.html_url) return open[0].html_url;
  const res = await fetch(`https://api.github.com/repos/${opts.repo}/pulls`, {
    method: "POST",
    headers,
    body: JSON.stringify({ title: opts.title, head: opts.branch, base: opts.base, body: opts.body }),
  });
  const pr = (await res.json().catch(() => null)) as { html_url?: string; message?: string } | null;
  if (!res.ok) throw new Error(`GitHub PR: ${pr?.message ?? res.status}`);
  return pr?.html_url ?? null;
}
