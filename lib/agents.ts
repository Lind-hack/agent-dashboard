// Client-safe (no node imports): shared by pages and the server.

// claude / codex run on the VPS through the runner; codex-cloud is "Codex for Linear".
export type AgentKey = "claude" | "codex";
export type TaskAgent = AgentKey | "codex-cloud";
export const AGENT_LABELS: Record<TaskAgent, string> = { claude: "Claude", codex: "Codex", "codex-cloud": "Codex cloud" };
