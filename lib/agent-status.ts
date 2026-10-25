import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { AgentKey } from "./agents";
import { listJobs } from "./store";

const run = promisify(execFile);

export type AgentStatus = { agent: AgentKey; ready: boolean; note: string; lastUsed?: string; busy: boolean };

const exists = (p: string) => {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
};

const home = () => os.homedir();

// Is each agent installed and logged in for the `agent` user? Read-only checks, cached briefly.
async function readiness(): Promise<Record<AgentKey, { ready: boolean; note: string }>> {
  const hermes = await run("sudo", ["-n", "-l", "/usr/local/bin/ask-hermes"], { timeout: 5000 })
    .then(() => ({ ready: true, note: "Bridge installed" }))
    .catch(() => ({ ready: false, note: "Run deploy/hermes-bridge.sh on the VPS once" }));
  const codexHome = process.env.CODEX_HOME ?? path.join(home(), ".codex");
  return {
    claude: exists(path.join(home(), ".claude", ".credentials.json"))
      ? { ready: true, note: "Logged in with your Claude plan" }
      : { ready: false, note: "sudo -iu agent claude, then /login" },
    codex: exists(path.join(codexHome, "auth.json"))
      ? { ready: true, note: "Logged in with your ChatGPT plan" }
      : { ready: false, note: "Log in with codex login over an SSH tunnel" },
    opencode: exists(process.env.OPENCODE_BIN ?? path.join(home(), ".local", "bin", "opencode"))
      ? { ready: true, note: "Free DeepSeek V4.1 Flash" }
      : { ready: false, note: "OpenCode isn't installed for the agent user" },
    hermes,
  };
}

let cache: { at: number; value: Awaited<ReturnType<typeof readiness>> } | null = null;

export async function agentStatuses(): Promise<AgentStatus[]> {
  if (!cache || Date.now() - cache.at > 60_000) cache = { at: Date.now(), value: await readiness() };
  const jobs = listJobs();
  return (Object.keys(cache.value) as AgentKey[]).map((agent) => {
    const mine = jobs.filter((j) => j.agent === agent);
    return {
      agent,
      ...cache!.value[agent],
      lastUsed: mine[0]?.updatedAt,
      busy: mine.some((j) => j.status === "running"),
    };
  });
}
