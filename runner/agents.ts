import { spawn, type ChildProcess } from "node:child_process";
import { claudeBin, claudeModel, codexBin, codexModel, jobTimeoutMs, type AgentKey } from "../lib/config";

// One CLI run per turn. Claude Code: `claude -p … --resume <session>` with stream-json
// (https://code.claude.com/docs/en/headless). Codex: `codex exec --json … resume <thread>`
// (https://learn.chatgpt.com/docs/non-interactive-mode). Both stream JSONL, normalised here into
// the log events the dashboard renders: init / text / tool / result / error.

export type TurnResult = { ok: boolean; sessionId?: string; result: string; costUsd?: number };

type Emit = (e: Record<string, unknown>) => void;

// Secrets the runner needs but the agents don't. NODE_ENV=production (for the services) would make
// `npm ci` in a repo skip devDependencies, so typecheck/build fail inside the worktree.
const HIDDEN_ENV = ["GITHUB_TOKEN", "LINEAR_API_KEY", "GROQ_API_KEY", "SESSION_SECRET", "DASHBOARD_PASSWORD", "HANDOFF_TOKEN", "NODE_ENV"];

const clip = (v: unknown, n = 160) => String(v ?? "").replace(/\s+/g, " ").slice(0, n);

type Parser = { onLine: (e: Record<string, any>, emit: Emit) => void; finish: () => TurnResult | null; sessionId: () => string | undefined };

function claudeParser(resume?: string): Parser {
  let sessionId = resume;
  let final: TurnResult | null = null;
  let lastText = "";
  return {
    sessionId: () => sessionId,
    finish: () => final,
    onLine: (e, emit) => {
      if (e.session_id) sessionId = e.session_id;
      if (e.type === "system" && e.subtype === "init") emit({ kind: "init", sessionId });
      // Plan-usage updates; the runner stores these for the dashboard meters instead of logging them.
      if (e.type === "rate_limit_event" && e.rate_limit_info) emit({ kind: "usage", info: e.rate_limit_info });
      if (e.type === "assistant") {
        for (const c of e.message?.content ?? []) {
          if (c?.type === "text" && c.text?.trim()) {
            lastText = c.text;
            emit({ kind: "text", text: c.text });
          }
          if (c?.type === "tool_use") {
            const i = c.input ?? {};
            const v = i.command ?? i.file_path ?? i.pattern ?? i.path ?? i.url ?? i.description ?? "";
            emit({ kind: "tool", text: `${c.name ?? "tool"}${v ? ` ${clip(v)}` : ""}` });
          }
        }
      }
      if (e.type === "result") {
        final = { ok: !e.is_error, sessionId, result: e.result ?? lastText, costUsd: e.total_cost_usd };
        emit({ kind: "result", ok: final.ok, text: final.result, costUsd: final.costUsd });
      }
    },
  };
}

function codexParser(resume?: string): Parser {
  let sessionId = resume;
  let final: TurnResult | null = null;
  let lastText = "";
  return {
    sessionId: () => sessionId,
    finish: () => final,
    onLine: (e, emit) => {
      if (e.type === "thread.started") {
        sessionId = e.thread_id ?? sessionId;
        emit({ kind: "init", sessionId });
      }
      if (e.type === "item.completed") {
        const it = e.item ?? {};
        if (it.type === "agent_message" && it.text?.trim()) {
          lastText = it.text;
          emit({ kind: "text", text: it.text });
        } else if (it.type === "command_execution") {
          emit({ kind: "tool", text: `Bash ${clip(it.command)}${it.exit_code ? ` (exit ${it.exit_code})` : ""}` });
        } else if (it.type === "file_change") {
          for (const c of it.changes ?? []) emit({ kind: "tool", text: `${c?.kind ?? "edit"} ${clip(c?.path)}` });
        } else if (it.type === "web_search") {
          emit({ kind: "tool", text: `WebSearch ${clip(it.query)}` });
        } else if (it.type === "mcp_tool_call") {
          emit({ kind: "tool", text: `${it.server ?? "mcp"}.${it.tool ?? "tool"}` });
        }
      }
      if (e.type === "turn.completed") {
        final = { ok: true, sessionId, result: lastText };
        emit({ kind: "result", ok: true, text: lastText });
      }
      if (e.type === "turn.failed" || e.type === "error") {
        const msg = e.error?.message ?? e.message ?? "Codex failed";
        final = { ok: false, sessionId, result: msg };
        emit({ kind: "error", text: msg });
      }
    },
  };
}

function command(agent: AgentKey, prompt: string, resume?: string): { bin: string; args: string[]; parser: Parser } {
  if (agent === "codex") {
    // The agent user has no sudo and the worktree is disposable, so Codex gets full access like Claude.
    // `codex exec resume` takes its own copy of the flags, so they go after the subcommand.
    const flags = ["--json", "--dangerously-bypass-approvals-and-sandbox", "--skip-git-repo-check"];
    if (codexModel()) flags.push("-m", codexModel());
    const args = resume ? ["exec", "resume", ...flags, resume, prompt] : ["exec", ...flags, prompt];
    return { bin: codexBin(), args, parser: codexParser(resume) };
  }
  const args = ["-p", prompt, "--output-format", "stream-json", "--verbose", "--permission-mode", "bypassPermissions"];
  if (resume) args.push("--resume", resume);
  if (claudeModel()) args.push("--model", claudeModel());
  return { bin: claudeBin(), args, parser: claudeParser(resume) };
}

export function runAgent(opts: {
  agent: AgentKey;
  cwd: string;
  prompt: string;
  resume?: string;
  onEvent: Emit;
  onChild: (child: ChildProcess) => void;
}): Promise<TurnResult> {
  const { bin, args, parser } = command(opts.agent, opts.prompt, opts.resume);
  const env = { ...process.env };
  for (const k of HIDDEN_ENV) delete env[k];

  return new Promise((resolve) => {
    const child = spawn(bin, args, { cwd: opts.cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    opts.onChild(child);
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
        try {
          parser.onLine(JSON.parse(line), opts.onEvent);
        } catch {
          // not a JSON event line
        }
      }
    });
    child.stderr!.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-4000);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      const final = parser.finish();
      if (final) return resolve(final);
      const why = signal ? `killed (${signal})` : `exit code ${code}`;
      if (stderr.trim()) opts.onEvent({ kind: "error", text: stderr.trim() });
      resolve({ ok: false, sessionId: parser.sessionId(), result: `${opts.agent} stopped without a result: ${why}. ${stderr.trim().slice(-500)}` });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ ok: false, sessionId: parser.sessionId(), result: `Could not start ${opts.agent}: ${err.message}` });
    });
  });
}
