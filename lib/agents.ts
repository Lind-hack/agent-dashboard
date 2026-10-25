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

// Dot tone used by kit <Dot>.
export const AGENT_TONE: Record<TaskAgent, string> = {
  claude: "claude",
  codex: "codex",
  "codex-cloud": "hermes",
  opencode: "opencode",
  hermes: "hermes",
};

export type GroupKind = "ask" | "relay";
// Relay = plan → build → review across agents on one branch.
export const RELAY_STEPS = ["Plan", "Build", "Review"] as const;
