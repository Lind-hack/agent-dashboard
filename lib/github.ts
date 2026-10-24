import { githubToken, type RepoKey } from "./config";

// Repos agents may work on = AGENT_REPOS (comma-separated full names), checked against what the
// token can see. The allowlist is needed because a fine-grained token can *read* every public repo
// and GitHub reports the owner's permissions, not the token's — so "visible" ≠ "can push".
// To add a repo: grant it on the token AND add it to AGENT_REPOS. Cached 5 min.

export type RepoInfo = { name: RepoKey; base: string; private: boolean };

let cache: { at: number; repos: RepoInfo[] } | null = null;

export async function listRepos(): Promise<RepoInfo[]> {
  if (cache && Date.now() - cache.at < 5 * 60_000) return cache.repos;
  const res = await fetch("https://api.github.com/user/repos?per_page=100&sort=pushed", {
    headers: {
      Authorization: `Bearer ${githubToken()}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    cache: "no-store",
  });
  const body = (await res.json().catch(() => null)) as
    | { full_name?: string; default_branch?: string; private?: boolean; archived?: boolean }[]
    | { message?: string }
    | null;
  if (!res.ok || !Array.isArray(body)) {
    throw new Error(`GitHub repos: ${(body as { message?: string } | null)?.message ?? res.status}`);
  }
  const allow = (process.env.AGENT_REPOS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const repos = body
    .filter((r) => r?.full_name && !r.archived && (!allow.length || allow.includes(r.full_name.toLowerCase())))
    .map((r) => ({ name: r.full_name!, base: r.default_branch ?? "main", private: !!r.private }));
  cache = { at: Date.now(), repos };
  return repos;
}

export async function repoBase(repo: RepoKey): Promise<string> {
  const found = (await listRepos().catch(() => [])).find((r) => r.name === repo);
  return found?.base ?? "main";
}
