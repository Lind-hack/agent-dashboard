import { parseGithubUrl } from "../lib/skills";
import { githubFailed, installFromGithub } from "./skills-sync";

// "Add a skill from GitHub" (Settings): installs skills straight from a GitHub URL, no PC needed.
//   https://github.com/<owner>/<repo>                         every skill in the repo (folders with a SKILL.md)
//   https://github.com/<owner>/<repo>/tree/<ref>/<path>        that folder — one skill, or a pack of them
//   https://github.com/<owner>/<repo>/blob/<ref>/<path>/SKILL.md
// The ref is resolved to a commit first, so every file comes from the same snapshot; the commit is
// recorded. Nothing updates by itself — pasting the URL again installs the newer version. Files go
// through the same validation and atomic install as the PC sync (runner/skills-sync.ts).

const MAX_SKILLS = 60;
const MAX_FILES = 600; // per install, across all skills
const FILE_BYTES = 256 * 1024;
const TEXT = /\.(md|mdx|txt|json|ya?ml|toml|js|mjs|cjs|ts|tsx|jsx|py|sh|ps1|html|css|svg|csv|xml)$/i;

class NotFound extends Error {}

async function gh<T>(url: string): Promise<T> {
  const token = process.env.GITHUB_READ_TOKEN ?? process.env.GITHUB_TOKEN;
  const res = await fetch(`https://api.github.com${url}`, {
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
    signal: AbortSignal.timeout(30_000),
  });
  if (res.status === 404 || res.status === 422) throw new NotFound("not found (or the token can't see that repo)");
  if (!res.ok) throw new Error(`GitHub HTTP ${res.status}`);
  return (await res.json()) as T;
}

type Tree = { truncated: boolean; tree: { path: string; type: string; mode: string; sha: string; size?: number }[] };

// "<ref>/<path>" where the ref may itself contain slashes: the shortest prefix GitHub knows is the ref.
async function resolve(base: string, rest: string[] | undefined): Promise<{ commit: string; path: string }> {
  if (!rest) {
    const ref = (await gh<{ default_branch: string }>(base)).default_branch;
    return { commit: (await gh<{ sha: string }>(`${base}/commits/${encodeURIComponent(ref)}`)).sha, path: "" };
  }
  for (let i = 1; i <= Math.min(rest.length, 6); i++) {
    try {
      const c = await gh<{ sha: string }>(`${base}/commits/${encodeURIComponent(rest.slice(0, i).join("/"))}`);
      return { commit: c.sha, path: rest.slice(i).join("/") };
    } catch (e) {
      if (!(e instanceof NotFound)) throw e;
    }
  }
  throw new Error("branch or tag not found");
}

export async function installSkillsFromGithub(url: string) {
  try {
    const t = parseGithubUrl(url);
    if (!t) throw new Error("not a GitHub repo or folder URL");
    const base = `/repos/${t.owner}/${t.repo}`;
    const { commit, path: dirPath } = await resolve(base, t.rest);
    // Only the chosen folder's tree, so a narrow link into a huge repo still works.
    let treeSha = commit;
    if (dirPath) {
      const parent = dirPath.split("/").slice(0, -1).join("/");
      const name = dirPath.split("/").pop();
      const list = await gh<{ name: string; type: string; sha: string }[]>(`${base}/contents/${parent.split("/").map(encodeURIComponent).join("/")}?ref=${commit}`);
      const dir = Array.isArray(list) ? list.find((e) => e.name === name && e.type === "dir") : undefined;
      if (!dir) throw new Error("folder not found at that commit");
      treeSha = dir.sha;
    }
    const tree = await gh<Tree>(`${base}/git/trees/${treeSha}?recursive=1`);
    if (tree.truncated) throw new Error("too many files to list — paste the skill's own folder");
    // Plain files only (no symlinks or submodules); paths relative to the chosen folder.
    const files = tree.tree.filter((e) => e.type === "blob" && e.mode !== "120000");
    // Each folder holding a SKILL.md is a skill; a skill folder nested inside another skill belongs to it.
    const roots = files
      .filter((e) => e.path.split("/").pop() === "SKILL.md")
      .map((e) => e.path.slice(0, -"SKILL.md".length).replace(/\/$/, ""))
      .sort((a, b) => a.length - b.length)
      .filter((d, i, all) => !all.slice(0, i).some((p) => p === "" || d.startsWith(`${p}/`)));
    if (!roots.length) throw new Error("no SKILL.md in that folder");
    if (roots.length > MAX_SKILLS) throw new Error(`${roots.length} skills there — paste a narrower folder (max ${MAX_SKILLS})`);
    const skills: Record<string, Record<string, string>> = {};
    let fetched = 0;
    for (const dir of roots) {
      const out: Record<string, string> = {};
      for (const e of files) {
        if (dir && !e.path.startsWith(`${dir}/`)) continue;
        const rel = dir ? e.path.slice(dir.length + 1) : e.path;
        if (!TEXT.test(rel) || (e.size ?? Infinity) > FILE_BYTES) continue; // SKILL.md included: the size cap applies before download
        if (++fetched > MAX_FILES) throw new Error(`more than ${MAX_FILES} files — paste a narrower folder`);
        const blob = await gh<{ content: string; encoding: string }>(`${base}/git/blobs/${e.sha}`);
        out[rel] = blob.encoding === "base64" ? Buffer.from(blob.content, "base64").toString("utf8") : blob.content;
      }
      // Skills inside this one's subfolders (excluded from roots above) stay part of this one.
      skills[skillName(out["SKILL.md"], dirPath ? `${dirPath}/${dir}` : dir, t.repo)] = out;
    }
    installFromGithub(skills, { url: url.trim(), commit });
  } catch (e) {
    githubFailed(url.trim().slice(0, 300), e instanceof Error ? e.message : String(e));
  }
}

// The SKILL.md's own name wins (that's what the agents invoke); else the folder name; else the repo name.
function skillName(md: string | undefined, dir: string, repo: string): string {
  const fm = md?.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1];
  const n = fm?.match(/^name:\s*["']?([\w.-]+)["']?\s*$/m)?.[1];
  return n ?? (dir.replace(/\/+$/, "").split("/").pop() || repo);
}
