import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { githubToken, REPOS, WORK_DIR, type RepoKey } from "../lib/config";

const exec = promisify(execFile);

// The token only ever travels as a per-command header — it is never written to a remote URL
// or git config, so Claude (which runs in the same checkout) can't read it back.
function authArgs(): string[] {
  const basic = Buffer.from(`x-access-token:${githubToken()}`).toString("base64");
  return ["-c", `http.https://github.com/.extraheader=Authorization: Basic ${basic}`];
}

export async function git(cwd: string, args: string[], withAuth = false): Promise<string> {
  const { stdout } = await exec("git", [...(withAuth ? authArgs() : []), ...args], {
    cwd,
    timeout: 5 * 60_000,
    maxBuffer: 20 * 1024 * 1024,
  });
  return stdout.trim();
}

const repoDir = (repo: RepoKey) => path.join(WORK_DIR, "repos", repo);
export const worktreeDir = (jobId: string) => path.join(WORK_DIR, "wt", jobId);

export async function ensureWorktree(repo: RepoKey, jobId: string, branch: string): Promise<string> {
  const { github, base } = REPOS[repo];
  const dir = repoDir(repo);
  if (!fs.existsSync(path.join(dir, ".git"))) {
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    await git(path.dirname(dir), ["clone", `https://github.com/${github}.git`, dir], true);
  }
  await git(dir, ["fetch", "--prune", "origin"], true);
  const wt = worktreeDir(jobId);
  if (!fs.existsSync(wt)) {
    fs.mkdirSync(path.dirname(wt), { recursive: true });
    await git(dir, ["worktree", "prune"]);
    await git(dir, ["worktree", "add", "-B", branch, wt, `origin/${base}`]);
  }
  return wt;
}

export async function removeWorktree(repo: RepoKey, jobId: string) {
  const wt = worktreeDir(jobId);
  if (!fs.existsSync(wt)) return;
  await git(repoDir(repo), ["worktree", "remove", "--force", wt]).catch(() => fs.rmSync(wt, { recursive: true, force: true }));
}

// Commits anything Claude left uncommitted, then pushes the branch. Returns false when there is nothing to push.
export async function pushBranch(repo: RepoKey, wt: string, branch: string, jobId: string): Promise<boolean> {
  const { base } = REPOS[repo];
  if (await git(wt, ["status", "--porcelain"])) {
    await git(wt, ["add", "-A"]);
    await git(wt, ["commit", "-m", `${jobId}: uncommitted agent changes`]);
  }
  const ahead = Number(await git(wt, ["rev-list", "--count", `origin/${base}..HEAD`]));
  if (!ahead) return false;
  await git(wt, ["push", "origin", `HEAD:refs/heads/${branch}`], true);
  return true;
}

export async function ensurePullRequest(repo: RepoKey, branch: string, title: string, body: string): Promise<string | null> {
  const { github, base } = REPOS[repo];
  const headers = {
    Authorization: `Bearer ${githubToken()}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const owner = github.split("/")[0];
  const existing = await fetch(`https://api.github.com/repos/${github}/pulls?head=${owner}:${branch}&state=open`, { headers });
  const open = (await existing.json().catch(() => [])) as { html_url?: string }[];
  if (Array.isArray(open) && open[0]?.html_url) return open[0].html_url;
  const res = await fetch(`https://api.github.com/repos/${github}/pulls`, {
    method: "POST",
    headers,
    body: JSON.stringify({ title, head: branch, base, body, draft: false }),
  });
  const pr = (await res.json().catch(() => null)) as { html_url?: string; message?: string } | null;
  if (!res.ok) throw new Error(`GitHub PR: ${pr?.message ?? res.status}`);
  return pr?.html_url ?? null;
}
