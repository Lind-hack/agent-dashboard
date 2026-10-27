// Client-safe (no node imports): shared by pages and the server.

// Run on the VPS through the runner. codex-cloud is "Codex for Linear" (OpenAI's cloud).
export type AgentKey = "claude" | "codex" | "opencode" | "hermes";
export type TaskAgent = AgentKey | "codex-cloud";
export const VPS_AGENTS: AgentKey[] = ["claude", "codex", "opencode", "hermes"];

export const AGENT_LABELS: Record<TaskAgent, string> = {
  claude: "Claude",
  codex: "Codex",
  "codex-cloud": "Codex cloud",
  opencode: "OpenCode",
  hermes: "Hermes",
};

export const AGENT_META: Record<TaskAgent, { color: string; hint: string; repo: boolean }> = {
  claude: { color: "var(--color-claude)", hint: "Claude Code on your VPS", repo: true },
  codex: { color: "var(--color-codex)", hint: "Codex CLI on your VPS", repo: true },
  "codex-cloud": { color: "var(--color-hermes)", hint: "Codex in OpenAI's cloud, via Linear", repo: true },
  opencode: { color: "var(--color-opencode)", hint: "OpenCode · free DeepSeek V4.1 Flash", repo: true },
  // Hermes works inside its own container (383 pipelines, skills), not in a repo checkout.
  hermes: { color: "#c9b6ff", hint: "Hermes on the VPS · free Nemotron 3 Ultra", repo: false },
};

// Exact colours for canvas drawing (the Core), mirroring the CSS tokens.
export const AGENT_HEX: Record<TaskAgent, string> = {
  claude: "#e2825f",
  codex: "#7c98ff",
  "codex-cloud": "#b392f0",
  opencode: "#5fd3a6",
  hermes: "#b392f0",
};

// Dot tone used by kit <Dot>.
export const AGENT_TONE: Record<TaskAgent, string> = {
  claude: "claude",
  codex: "codex",
  "codex-cloud": "hermes",
  opencode: "opencode",
  hermes: "hermes",
};

// How each agent shows up in its own chat: what it's doing while it works, and the one-line voice of
// its empty state. (Voices live in lib/voices.ts.)
export const AGENT_PERSONA: Record<TaskAgent, { verb: string; idle: string }> = {
  claude: { verb: "thinking", idle: "Claude reads the repo first, then edits — ask for a plan if you want one before code." },
  codex: { verb: "working", idle: "Codex runs commands and tests as it goes — say what done looks like." },
  "codex-cloud": { verb: "working in the cloud", idle: "Codex cloud picks this up from Linear and opens a PR." },
  opencode: { verb: "coding", idle: "OpenCode on free DeepSeek — quick fixes and small features." },
  hermes: { verb: "running", idle: "Hermes works in its own container: pipelines, scraping, skills." },
};

export type GroupKind = "ask" | "relay";
// Relay = plan → build → review across agents on one branch.
export const RELAY_STEPS = ["Plan", "Build", "Review"] as const;
