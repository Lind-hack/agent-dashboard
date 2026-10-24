import path from "node:path";

function env(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === "") throw new Error(`Missing env ${name}`);
  return value;
}

export const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), "data");
export const WORK_DIR = process.env.WORK_DIR ?? path.join(DATA_DIR, "work");

export type RepoKey = "383" | "agent-dashboard";

// Repos agents may work on. Keys double as the `repo:<key>` label in Linear.
export const REPOS: Record<RepoKey, { github: string; base: string; notes: string }> = {
  "383": {
    github: "Lind-hack/383lajme",
    base: "main",
    notes:
      "383lajme is the live Kosovo news site. main deploys to production on Railway automatically, so never push to main or merge — open a PR only. Read CLAUDE.md and AGENTS.md first.",
  },
  "agent-dashboard": {
    github: "Lind-hack/agent-dashboard",
    base: "main",
    notes: "This is the agent dashboard itself (Next.js 16 + runner). Read README.md first.",
  },
};

export const REPO_KEYS = Object.keys(REPOS) as RepoKey[];

export type AgentKey = "claude" | "codex";

export const LABELS = {
  agent: (a: AgentKey) => `agent:${a}`,
  repo: (r: RepoKey) => `repo:${r}`,
};

// Comments carrying this marker were written by the runner, so it never answers itself.
export const BOT_MARK = "🤖";
// A Linear comment that starts with this continues the Claude session for that issue.
export const REPLY_PREFIX = "@claude";

export const linearKey = () => env("LINEAR_API_KEY");
export const linearTeamKey = () => process.env.LINEAR_TEAM_KEY ?? "";
export const groqKey = () => env("GROQ_API_KEY");
export const groqModel = () => process.env.GROQ_MODEL ?? "openai/gpt-oss-120b";
export const githubToken = () => env("GITHUB_TOKEN");
export const sessionSecret = () => env("SESSION_SECRET");
export const dashboardPassword = () => env("DASHBOARD_PASSWORD");
export const claudeBin = () => process.env.CLAUDE_BIN ?? "claude";
export const claudeModel = () => process.env.CLAUDE_MODEL ?? "";
export const jobTimeoutMs = () => Number(process.env.JOB_TIMEOUT_MIN ?? 45) * 60_000;
