import { spawn, type ChildProcess } from "node:child_process";
import { claudeBin, claudeModel, codexBin, codexModel, jobTimeoutMs, type AgentKey } from "../lib/config";

const opencodeBin = () => process.env.OPENCODE_BIN ?? "opencode";
// Free on OpenCode while it lasts; only answers inside the OpenCode client, which is what runs here.
const opencodeModel = () => process.env.OPENCODE_MODEL ?? "opencode/deepseek-v4.1-flash-free";

// One CLI run per turn, normalised into the log events the dashboard renders (init / text / tool /
// result / error):
// - Claude Code: `claude -p … --resume <session>`, stream-json (code.claude.com/docs/en/headless)
// - Codex: `codex exec --json … resume <thread>` (learn.chatgpt.com/docs/non-interactive-mode)
// - OpenCode: `opencode run --format json --session <id>` (opencode.ai/docs/cli)
// - Hermes: `sudo -n /usr/local/bin/ask-hermes [session]`, prompt on stdin, plain text back
//   (deploy/hermes-bridge.sh installs that one helper; it runs Hermes as the hermes user).

export type TurnResult = { ok: boolean; sessionId?: string; result: string; costUsd?: number };

// Agents run in their own process group (spawned detached) so a stop or timeout also ends the tools
// they started, not just the CLI.
export function killTree(child: ChildProcess | undefined, signal: NodeJS.Signals = "SIGTERM") {
  if (!child?.pid) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    child.kill(signal);
  }
}

type Emit = (e: Record<string, unknown>) => void;

// Secrets the runner needs but the agents don't. NODE_ENV=production (for the services) would make
// `npm ci` in a repo skip devDependencies, so typecheck/build fail inside the worktree.
// Debaters also lose every other credential the runner holds.
const READONLY_HIDDEN = ["NVIDIA_API_KEY", "GITHUB_READ_TOKEN", "MONITOR_TOKEN", "GOOGLE_CLIENT_SECRET"];
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

function opencodeParser(resume?: string): Parser {
  let sessionId = resume;
  let final: TurnResult | null = null;
  let lastText = "";
  let announced = false;
  return {
    sessionId: () => sessionId,
    finish: () => final,
    onLine: (e, emit) => {
      if (e.sessionID) sessionId = e.sessionID;
      if (!announced && sessionId) {
        announced = true;
        emit({ kind: "init", sessionId });
      }
      const part = e.part ?? {};
      if (e.type === "text" && part.text?.trim()) {
        lastText = part.text;
        emit({ kind: "text", text: part.text });
      }
      if ((e.type === "tool_use" || part.type === "tool") && part.state?.status === "completed") {
        const i = part.state?.input ?? {};
        const v = i.command ?? i.filePath ?? i.path ?? i.pattern ?? i.url ?? "";
        emit({ kind: "tool", text: `${part.tool ?? "tool"}${v ? ` ${clip(v)}` : ""}` });
      }
      if (e.type === "step_finish" && part.reason === "stop") {
        final = { ok: true, sessionId, result: lastText, costUsd: typeof part.cost === "number" ? part.cost : undefined };
        emit({ kind: "result", ok: true, text: lastText });
      }
      if (e.type === "error") {
        const msg = e.error?.data?.message ?? e.error?.message ?? e.message ?? "OpenCode failed";
        final = { ok: false, sessionId, result: msg };
        emit({ kind: "error", text: msg });
      }
    },
  };
}

// Hermes answers in one block: the reply, then a "session_id: …" line.
function runHermes(opts: { prompt: string; resume?: string; onEvent: Emit; onChild: (c: ChildProcess) => void; timeoutMs?: number }): Promise<TurnResult> {
  return new Promise((resolve) => {
    const child = spawn("sudo", ["-n", "/usr/local/bin/ask-hermes", ...(opts.resume ? [opts.resume] : [])], { stdio: ["pipe", "pipe", "pipe"], detached: true });
    opts.onChild(child);
    let out = "";
    let err = "";
    const timer = setTimeout(() => killTree(child), opts.timeoutMs ?? jobTimeoutMs());
    child.stdout!.on("data", (c: Buffer) => (out += c.toString()));
    child.stderr!.on("data", (c: Buffer) => (err = (err + c.toString()).slice(-4000)));
    child.stdin!.end(opts.prompt);
    child.on("close", (code) => {
      clearTimeout(timer);
      // `-Q` prints the session id on stderr; older builds appended it to stdout.
      const m = out.match(/\n?\s*session_id:\s*(\S+)\s*$/);
      const sessionId = m?.[1] ?? err.match(/session_id:\s*(\S+)/)?.[1] ?? opts.resume;
      const text = (m ? out.slice(0, m.index) : out).trim();
      if (sessionId && !opts.resume) opts.onEvent({ kind: "init", sessionId });
      if (code === 0 && text) {
        opts.onEvent({ kind: "result", ok: true, text });
        return resolve({ ok: true, sessionId, result: text });
      }
      const why = /password is required|a terminal is required|not allowed/i.test(err)
        ? "The Hermes bridge isn't installed yet — run deploy/hermes-bridge.sh on the VPS once."
        : `Hermes stopped (exit ${code}). ${err.trim().slice(-500)}`;
      opts.onEvent({ kind: "error", text: why });
      resolve({ ok: false, sessionId, result: why });
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      opts.onEvent({ kind: "error", text: `Could not start Hermes: ${e.message}` });
      resolve({ ok: false, result: `Could not start Hermes: ${e.message}` });
    });
  });
}

// `readonly` = a Roast debater: no tools at all (Claude), a read-only sandbox that fails closed on this
// VPS (Codex), no auto-approved permissions (OpenCode). Debaters reason from the evidence in the prompt.
function command(agent: AgentKey, prompt: string, resume?: string, readonly = false): { bin: string; args: string[]; parser: Parser } {
  if (agent === "opencode") {
    const args = ["run", "--format", "json", ...(readonly ? [] : ["--auto"]), "-m", opencodeModel()];
    if (resume) args.push("--session", resume);
    args.push(prompt);
    return { bin: opencodeBin(), args, parser: opencodeParser(resume) };
  }
  if (agent === "codex") {
    // The agent user has no sudo and the worktree is disposable, so Codex gets full access like Claude.
    // `codex exec resume` takes its own copy of the flags, so they go after the subcommand.
    const flags = ["--json", ...(readonly ? ["-s", "read-only"] : ["--dangerously-bypass-approvals-and-sandbox"]), "--skip-git-repo-check"];
    if (codexModel()) flags.push("-m", codexModel());
    const args = resume ? ["exec", "resume", ...flags, resume, prompt] : ["exec", ...flags, prompt];
    return { bin: codexBin(), args, parser: codexParser(resume) };
  }
  const args = readonly
    ? ["-p", prompt, "--output-format", "stream-json", "--verbose", "--tools", "", "--strict-mcp-config", "--max-turns", "2"]
    : ["-p", prompt, "--output-format", "stream-json", "--verbose", "--permission-mode", "bypassPermissions"];
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
  readonly?: boolean;
  timeoutMs?: number;
}): Promise<TurnResult> {
  if (opts.agent === "hermes") return runHermes(opts);
  const { bin, args, parser } = command(opts.agent, opts.prompt, opts.resume, opts.readonly);
  const env = { ...process.env };
  for (const k of [...HIDDEN_ENV, ...(opts.readonly ? READONLY_HIDDEN : [])]) delete env[k];
  const limit = opts.timeoutMs ?? jobTimeoutMs();

  return new Promise((resolve) => {
    const child = spawn(bin, args, { cwd: opts.cwd, env, stdio: ["ignore", "pipe", "pipe"], detached: true });
    opts.onChild(child);
    let buf = "";
    let stderr = "";

    const timer = setTimeout(() => {
      opts.onEvent({ kind: "error", text: `Timed out after ${Math.round(limit / 60_000)} min` });
      killTree(child);
    }, limit);

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
      // A parsed result only counts if the CLI also exited cleanly.
      if (final && code === 0) return resolve(final);
      if (final) return resolve({ ...final, ok: false, result: `${final.result}

(${opts.agent} exited ${signal ? `on ${signal}` : `with code ${code}`} after its result)` });
      const why = signal ? `killed (${signal})` : `exit code ${code}`;
      if (stderr.trim()) opts.onEvent({ kind: "error", text: stderr.trim() });
      resolve({ ok: false, sessionId: parser.sessionId(), result: `${opts.agent} stopped without a result: ${why}. ${stderr.trim().slice(-500)}` });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      const msg = `Could not start ${opts.agent}: ${err.message}`;
      opts.onEvent({ kind: "error", text: msg }); // otherwise a failed start leaves nothing in the chat
      resolve({ ok: false, sessionId: parser.sessionId(), result: msg });
    });
  });
}
