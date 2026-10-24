import { spawn, type ChildProcess } from "node:child_process";
import { claudeBin, claudeModel, jobTimeoutMs } from "../lib/config";

// Headless Claude Code (https://code.claude.com/docs/en/headless): one `claude -p` per turn,
// `--resume <session>` for follow-ups, stream-json so the dashboard can show progress live.

export type TurnResult = { ok: boolean; sessionId?: string; result: string; costUsd?: number };

// Secrets the runner needs but Claude doesn't. NODE_ENV=production (for the services) would make
// `npm ci` in the repo skip devDependencies, so typecheck/build fail inside the worktree.
const HIDDEN_ENV = ["GITHUB_TOKEN", "LINEAR_API_KEY", "GROQ_API_KEY", "SESSION_SECRET", "DASHBOARD_PASSWORD", "NODE_ENV"];

type StreamEvent = {
  type?: string;
  subtype?: string;
  session_id?: string;
  is_error?: boolean;
  result?: string;
  total_cost_usd?: number;
  message?: { content?: { type?: string; text?: string; name?: string; input?: Record<string, unknown> }[] };
};

function summarizeTool(name: string, input: Record<string, unknown> = {}): string {
  const v = input.command ?? input.file_path ?? input.pattern ?? input.path ?? input.url ?? input.description ?? "";
  return `${name}${v ? ` ${String(v).slice(0, 160)}` : ""}`;
}

export function runClaude(opts: {
  cwd: string;
  prompt: string;
  resume?: string;
  onEvent: (e: Record<string, unknown>) => void;
  onChild: (child: ChildProcess) => void;
}): Promise<TurnResult> {
  const args = ["-p", opts.prompt, "--output-format", "stream-json", "--verbose", "--permission-mode", "bypassPermissions"];
  if (opts.resume) args.push("--resume", opts.resume);
  if (claudeModel()) args.push("--model", claudeModel());

  const env = { ...process.env };
  for (const k of HIDDEN_ENV) delete env[k];

  return new Promise((resolve) => {
    const child = spawn(claudeBin(), args, { cwd: opts.cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    opts.onChild(child);
    let sessionId = opts.resume;
    let final: TurnResult | null = null;
    let lastText = "";
    let buf = "";
    let stderr = "";

    const timer = setTimeout(() => {
      opts.onEvent({ kind: "error", text: `Timed out after ${jobTimeoutMs() / 60_000} min` });
      child.kill("SIGTERM");
    }, jobTimeoutMs());

    child.stdout!.on("data", (chunk: Buffer) => {
      buf += chunk.toString();
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let e: StreamEvent;
        try {
          e = JSON.parse(line);
        } catch {
          continue;
        }
        if (e.session_id) sessionId = e.session_id;
        if (e.type === "system" && e.subtype === "init") opts.onEvent({ kind: "init", sessionId });
        if (e.type === "assistant") {
          for (const c of e.message?.content ?? []) {
            if (c?.type === "text" && c.text?.trim()) {
              lastText = c.text;
              opts.onEvent({ kind: "text", text: c.text });
            }
            if (c?.type === "tool_use") opts.onEvent({ kind: "tool", text: summarizeTool(c.name ?? "tool", c.input) });
          }
        }
        if (e.type === "result") {
          final = { ok: !e.is_error, sessionId, result: e.result ?? lastText, costUsd: e.total_cost_usd };
          opts.onEvent({ kind: "result", ok: final.ok, text: final.result, costUsd: final.costUsd });
        }
      }
    });
    child.stderr!.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-4000);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (final) return resolve(final);
      const why = signal ? `killed (${signal})` : `exit code ${code}`;
      if (stderr.trim()) opts.onEvent({ kind: "error", text: stderr.trim() });
      resolve({ ok: false, sessionId, result: `Claude stopped without a result: ${why}. ${stderr.trim().slice(-500)}` });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ ok: false, sessionId, result: `Could not start Claude: ${err.message}` });
    });
  });
}
