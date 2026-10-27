import path from "node:path";

function env(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === "") throw new Error(`Missing env ${name}`);
  return value;
}

export const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), "data");
export const WORK_DIR = process.env.WORK_DIR ?? path.join(DATA_DIR, "work");

// A repo is its GitHub full name ("Lind-hack/383lajme"). Which repos exist is decided by the
// AGENT_REPOS allowlist, filtered by GitHub token visibility (lib/github.ts).
export type RepoKey = string;

// Extra rules for specific repos, added to the agent's brief.
const REPO_NOTES: Record<string, string> = {
  "Lind-hack/383lajme":
    "383lajme is the live Kosovo news site. main deploys to production on Railway automatically. Follow Lind's delivery preference in the brief, verify before publishing, and read CLAUDE.md and AGENTS.md first.",
  "Lind-hack/agent-dashboard": "This is the agent dashboard itself (Next.js 16 + runner). Read README.md first.",
  "Lind-hack/learning-lab": "This is Lind's daily computer-science Learning Lab. Read README.md and any CLAUDE.md / AGENTS.md first. Follow Lind's delivery preference in the brief and verify the repo's deployment workflow before publishing.",
};

export const repoNotes = (repo: RepoKey) =>
  REPO_NOTES[repo] ?? "Read the repo's CLAUDE.md / AGENTS.md / README first and follow them. Follow Lind's delivery preference in the brief and verify the repo's deployment workflow before publishing.";

// Linear labels carry the short name (repo:383lajme). Older issues used these aliases.
const REPO_ALIASES: Record<string, RepoKey> = {
  "383": "Lind-hack/383lajme",
  "agent-dashboard": "Lind-hack/agent-dashboard",
};
export const GITHUB_OWNER = process.env.GITHUB_OWNER ?? "Lind-hack";

export function repoFromLabel(name: string): RepoKey | null {
  if (!name.startsWith("repo:")) return null;
  const short = name.slice(5);
  return REPO_ALIASES[short] ?? (short.includes("/") ? short : `${GITHUB_OWNER}/${short}`);
}

export const repoShort = (repo: RepoKey) => repo.split("/").pop() ?? repo;

export { AGENT_LABELS, type AgentKey, type TaskAgent } from "./agents";
import type { AgentKey, TaskAgent } from "./agents";

export const LABELS = {
  agent: (a: TaskAgent) => `agent:${a}`,
  repo: (r: RepoKey) => `repo:${repoShort(r)}`,
};

// Comments carrying this marker were written by the runner, so it never answers itself.
export const BOT_MARK = "🤖";
// A Linear comment that starts with "@claude" / "@codex" continues the VPS session for that issue.
export const replyPrefix = (a: AgentKey) => `@${a}`;

export const linearKey = () => env("LINEAR_API_KEY");
export const linearTeamKey = () => process.env.LINEAR_TEAM_KEY ?? "";
export const groqKey = () => env("GROQ_API_KEY");
export const groqModel = () => process.env.GROQ_MODEL ?? "openai/gpt-oss-120b";
export const githubToken = () => env("GITHUB_TOKEN");
export const sessionSecret = () => env("SESSION_SECRET");
export const dashboardPassword = () => env("DASHBOARD_PASSWORD");
export const handoffToken = () => process.env.HANDOFF_TOKEN ?? "";
export const claudeBin = () => process.env.CLAUDE_BIN ?? "claude";
export const claudeModel = () => process.env.CLAUDE_MODEL ?? "";
export const codexBin = () => process.env.CODEX_BIN ?? "codex";
export const codexModel = () => process.env.CODEX_MODEL ?? "";
export const jobTimeoutMs = () => Number(process.env.JOB_TIMEOUT_MIN ?? 45) * 60_000;
