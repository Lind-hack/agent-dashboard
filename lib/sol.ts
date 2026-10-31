import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { codexBin } from "./config";

// gpt-6.1-sol through the Codex CLI on Lind's ChatGPT login (v5): the Roast room judge and the Day
// assistant's plans/briefings. Tool-free and read-only — the model only reads the prompt on stdin and
// writes its last message to a file. One call at a time, so a room and a briefing never pile up on
// the plan's limits. Runs wherever CODEX_HOME is set (the runner; the web app has it too).

export const SOL_MODEL = () => process.env.SOL_MODEL ?? "gpt-6.1-sol";
export const SOL_EFFORT = () => process.env.SOL_EFFORT ?? "medium";
export const solLabel = () => `${SOL_MODEL()} · ${SOL_EFFORT()}`;
export const solEnabled = () => process.env.SOL_ENABLED !== "0";

const TOOLS_OFF = ["shell_tool", "unified_exec", "apps", "plugins", "browser_use", "image_generation", "view_image"].flatMap((f) => ["--disable", f]);

let chain: Promise<unknown> = Promise.resolve();

function once(prompt: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sol-"));
    const out = path.join(dir, "last.txt");
    const child = spawn(
      codexBin(),
      // mcp_servers={} drops any MCP servers from the shared Codex config: Sol gets no tools at all.
      ["exec", "-m", SOL_MODEL(), "-c", `model_reasoning_effort=${SOL_EFFORT()}`, "-c", "mcp_servers={}", "-s", "read-only", ...TOOLS_OFF, "--skip-git-repo-check", "-o", out, "-"],
      { cwd: dir, env: process.env, stdio: ["pipe", "ignore", "pipe"] },
    );
    let err = "";
    child.stderr.on("data", (d) => (err = (err + d).slice(-2000)));
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("error", (e) => {
      clearTimeout(timer);
      fs.rmSync(dir, { recursive: true, force: true });
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      let text = "";
      try {
        text = fs.readFileSync(out, "utf8").trim();
      } catch {
        /* no answer written */
      }
      fs.rmSync(dir, { recursive: true, force: true });
      if (text) resolve(text);
      else reject(new Error(`${SOL_MODEL()} gave no answer (exit ${code}): ${err.split("\n").filter(Boolean).slice(-2).join(" ").slice(0, 300)}`));
    });
    child.stdin.end(prompt);
  });
}

// Plain text from Sol, queued behind any call already running.
export function sol(system: string, user: string, timeoutMs = 6 * 60_000): Promise<string> {
  if (!solEnabled()) return Promise.reject(new Error("Sol is turned off (SOL_ENABLED=0)."));
  const id = crypto.randomBytes(4).toString("hex");
  const prompt = `${system}\n\n----- input ${id} -----\n${user}\n----- end of input ${id} -----`;
  const run = chain.then(() => once(prompt, timeoutMs));
  chain = run.catch(() => null);
  return run;
}

// Sol asked for one JSON object; null when it answered something else or failed.
export async function solJSON<T>(system: string, user: string, timeoutMs?: number): Promise<Partial<T> | null> {
  const raw = await sol(`${system}\nReturn ONLY one JSON object — no prose, no code fences.`, user, timeoutMs).catch(() => "");
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]) as Partial<T>;
  } catch {
    return null;
  }
}
