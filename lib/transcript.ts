import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

// Reads Claude Code transcripts (~/.claude/projects/*/<id>.jsonl) and Codex rollouts
// (~/.codex/sessions/**/rollout-*.jsonl) into plain conversation items. Shared by the PC hand-off
// script (Node 24 runs this directly — keep it erasable TypeScript) and the VPS (history view, dossier).

export type Item = { role: "you" | "agent" | "tool"; text: string; at?: string };

const SYSTEM_NOISE = [
  /<system-reminder>[\s\S]*?<\/system-reminder>/g,
  /<local-command-caveat>[\s\S]*?<\/local-command-caveat>/g,
  /<local-command-stdout>[\s\S]*?<\/local-command-stdout>/g,
  /<command-message>[\s\S]*?<\/command-message>/g,
  /<task-notification>[\s\S]*?<\/task-notification>/g,
  /<external_[a-z_]+>[\s\S]*?<\/external_[a-z_]+>/g, // Codex app UI state
  /<in-app-browser-context[\s\S]*?<\/in-app-browser-context>/g,
];

function clean(text: string): string {
  let t = text;
  for (const re of SYSTEM_NOISE) t = t.replace(re, "");
  // "<command-name>/handoff</command-name> <command-args>x</command-args>" → "/handoff x"
  t = t.replace(/<command-name>([\s\S]*?)<\/command-name>\s*(?:<command-args>([\s\S]*?)<\/command-args>)?/g, (_m: string, n: string, a?: string) => `${n.trim()} ${a?.trim() ?? ""}`.trim());
  return t.trim();
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

function toolLine(name: string, input: Record<string, unknown>): string {
  const v = input.command ?? input.file_path ?? input.path ?? input.pattern ?? input.url ?? input.query ?? input.description ?? input.skill ?? "";
  return `${name}${v ? ` ${clip(String(v).replace(/\s+/g, " "), 160)}` : ""}`;
}

type Rec = Record<string, any>;

function claudeItems(r: Rec): Item[] {
  if (r.isSidechain || r.isMeta) return [];
  const at = typeof r.timestamp === "string" ? r.timestamp : undefined;
  const content = r.message?.content;
  if (r.type === "user") {
    if (typeof content === "string") {
      const t = clean(content);
      return t ? [{ role: "you", text: t, at }] : [];
    }
    const out: Item[] = [];
    for (const c of Array.isArray(content) ? content : []) {
      if (c?.type === "text") {
        const t = clean(c.text ?? "");
        if (t) out.push({ role: "you", text: t, at });
      } else if (c?.type === "tool_result" && c.is_error) {
        const t = typeof c.content === "string" ? c.content : (c.content ?? []).map((x: Rec) => x?.text ?? "").join(" ");
        if (t.trim()) out.push({ role: "tool", text: `error: ${clip(t.trim().split("\n")[0], 200)}`, at });
      }
    }
    return out;
  }
  if (r.type === "assistant") {
    const out: Item[] = [];
    for (const c of Array.isArray(content) ? content : []) {
      if (c?.type === "text" && c.text?.trim()) out.push({ role: "agent", text: c.text.trim(), at });
      if (c?.type === "tool_use") out.push({ role: "tool", text: toolLine(c.name ?? "tool", c.input ?? {}), at });
    }
    return out;
  }
  return [];
}

function codexItems(r: Rec): Item[] {
  const at = typeof r.timestamp === "string" ? r.timestamp : undefined;
  const p = r.payload ?? {};
  if (r.type !== "response_item") return [];
  if (p.type === "message" && (p.role === "user" || p.role === "assistant")) {
    const text = clean((p.content ?? []).map((c: Rec) => c?.text ?? "").join("\n"));
    // Codex injects AGENTS.md, environment context and skill lists as user messages.
    if (!text || /^(<environment_context>|<user_instructions>|# AGENTS\.md|<skills_instructions>|<permissions)/.test(text)) return [];
    return [{ role: p.role === "user" ? "you" : "agent", text, at }];
  }
  if (p.type === "function_call" || p.type === "custom_tool_call" || p.type === "local_shell_call") {
    let input: Rec = {};
    try {
      input = typeof p.arguments === "string" ? JSON.parse(p.arguments) : (p.arguments ?? p.action ?? p.input ?? {});
    } catch {
      input = { command: String(p.arguments ?? "") };
    }
    if (Array.isArray(input.command)) input.command = input.command.join(" ");
    return [{ role: "tool", text: toolLine(p.name ?? "shell", input), at }];
  }
  return [];
}

// Parses either format; unknown/partial lines are skipped.
export function parseTranscript(raw: string, agent: "claude" | "codex"): Item[] {
  const out: Item[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let r: Rec;
    try {
      r = JSON.parse(line);
    } catch {
      continue;
    }
    out.push(...(agent === "codex" ? codexItems(r) : claudeItems(r)));
  }
  return out;
}

// Plain-text rendering for search files and the dossier: your words in full, the agent's text in
// full, tool calls as one-liners.
export function condense(items: Item[]): string {
  return items
    .map((i) => {
      const day = i.at ? `[${i.at.slice(0, 16).replace("T", " ")}] ` : "";
      if (i.role === "you") return `\n## ${day}Lind\n${i.text}`;
      if (i.role === "agent") return `\n${day}Agent: ${i.text}`;
      return `  · ${i.text}`;
    })
    .join("\n")
    .trim();
}

// The first real thing Lind asked — used as a title.
export function titleOf(items: Item[]): string {
  const first = items.find((i) => i.role === "you" && !i.text.startsWith("/"))?.text ?? items.find((i) => i.role === "you")?.text ?? "";
  // Paste wrappers and app markup aren't words Lind typed.
  const plain = first.replace(/<\/?[a-z_]+(?:\s[^>]*)?>/gi, " ").replace(/\[\$([\w-]+)\]\([^)]*\)/g, "$$$1");
  return clip(plain.replace(/\s+/g, " ").trim(), 90) || "(untitled chat)";
}

// Local chat discovery shared with the self-updating PC collector. Keep these helpers in this
// existing shipped library: older collectors can only bootstrap updates to known library names.
// Shared by the runner (tsx) and the PC collector (Node 24, erasable TypeScript).
// OpenCode uses its supported JSON export; Hermes is opened read-only through Python's sqlite3.

const exec = promisify(execFile);
export type LocalChat = { kind: "chat"; id: string; agent: string; title: string; project: string; firstAt: string; lastAt: string; text: string; source: string };
const quiet = (at: string) => Number.isFinite(Date.parse(at)) && Date.parse(at) < Date.now() - 20 * 60_000;
const date = (value: unknown) => {
  const n = typeof value === "number" ? (value < 1e12 ? value * 1000 : value) : String(value ?? "");
  const d = new Date(n);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
};
const content = (value: unknown): string => typeof value === "string" ? value : Array.isArray(value) ? value.map((p) => p?.type === "text" ? p.text ?? "" : "").join("\n") : "";
const cap = (s: string) => s.length > 3_500_000 ? `${s.slice(0, 875_000)}\n[Middle omitted]\n${s.slice(-2_625_000)}` : s;

export function openCodeChat(data: any, source: string): LocalChat | null {
  const info = data?.info;
  if (!info?.id || !Array.isArray(data.messages)) return null;
  const at = date(info.time?.updated);
  if (!quiet(at)) return null;
  const messages = data.messages.map((m: any) => ({ role: m.info?.role ?? m.info?.type, text: (m.parts ?? []).filter((p: any) => p.type === "text" && !p.synthetic).map((p: any) => p.text ?? "").join("\n") }));
  if (!messages.some((m: any) => m.role === "user") || !messages.some((m: any) => m.role === "assistant")) return null;
  return { kind: "chat", id: `opencode-${info.id}`, agent: "opencode", title: String(info.title ?? info.id), project: path.basename(info.directory ?? "") || "misc", firstAt: date(info.time?.created) || at, lastAt: at, text: cap(messages.filter((m: any) => ["user", "assistant"].includes(m.role)).map((m: any) => `${m.role}: ${m.text}`).join("\n\n")), source };
}

const HERMES_READ = String.raw`
import sqlite3, json, sys, pathlib
con = sqlite3.connect(pathlib.Path(sys.argv[1]).resolve().as_uri() + '?mode=ro', uri=True, timeout=5)
con.row_factory = sqlite3.Row
con.execute('PRAGMA query_only=ON')
seen = json.loads(sys.argv[2])
budget = 0
for s in con.execute('SELECT id, title, started_at FROM sessions ORDER BY started_at DESC'):
    sid = s['id']
    stats = con.execute('SELECT MAX(timestamp) AS last_at, COUNT(*) AS n FROM messages WHERE session_id=?', (sid,)).fetchone()
    version = str(stats['last_at']) + ':' + str(stats['n'])
    if seen.get(sid) == version: continue
    if not stats['last_at'] or float(stats['last_at']) > float(sys.argv[3]): continue
    messages = [dict(m) for m in con.execute("SELECT role, content FROM messages WHERE session_id=? AND role IN ('user','assistant') ORDER BY timestamp,id", (sid,))]
    for m in messages:
        if isinstance(m['content'], str): m['content'] = m['content'][:50000]
    while sum(len(str(m['content'] or '')) for m in messages) > 3500000 and len(messages) > 2:
        messages.pop(len(messages)//2)
    payload = json.dumps(dict(s) | {'last_at': stats['last_at'], 'version': version, 'messages': messages})
    if budget + len(payload) > 16000000: break
    print(payload)
    budget += len(payload)
con.close()
`;

export async function* databaseChats(seen: Record<string, string>, onError: (source: string, error: string) => void): AsyncGenerator<LocalChat> {
  const home = os.homedir();
  const oc = process.env.OPENCODE_BIN ?? "opencode";
  try {
    const { stdout } = await exec(oc, ["session", "list", "--format", "json"], { timeout: 30_000, maxBuffer: 8 * 1024 * 1024, windowsHide: true });
    const sessions = JSON.parse(stdout);
    for (const s of sessions) {
      if (!quiet(date(s.time?.updated ?? s.updated))) continue;
      const version = String(s.time?.updated ?? s.updated);
      if (seen[`opencode:${s.id}`] === version) continue;
      try {
        const { stdout: raw } = await exec(oc, ["export", String(s.id)], { timeout: 60_000, maxBuffer: 32 * 1024 * 1024, windowsHide: true });
        const chat = openCodeChat(JSON.parse(raw), `opencode export ${s.id}`);
        if (chat) {
          yield chat;
          // Only acknowledged uploads advance the caller's cursor (after yield).
          seen[`opencode:${s.id}`] = version;
        }
      } catch (e) { onError("opencode", e instanceof Error ? e.message : String(e)); }
    }
  } catch (e) {
    // An absent optional CLI isn't a failure; other errors must remain visible.
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") onError("opencode", e instanceof Error ? e.message : String(e));
  }
  const hermesHome = process.env.HERMES_HOME ?? (process.platform === "win32" && process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "hermes") : path.join(home, ".hermes"));
  const db = process.env.MEMORY_HERMES_DB ?? path.join(hermesHome, "state.db");
  // This is an external runtime history store, never a build asset.
  if (!fs.existsSync(/*turbopackIgnore: true*/ db)) return;
  try {
    const prefix = `hermes:${db}:`;
    const versions = Object.fromEntries(Object.entries(seen).filter(([k]) => k.startsWith(prefix)).map(([k, v]) => [k.slice(prefix.length), v]));
    const { stdout } = await exec(process.env.MEMORY_PYTHON_BIN ?? (process.platform === "win32" ? "python" : "python3"), ["-c", HERMES_READ, db, JSON.stringify(versions), String((Date.now() - 20 * 60_000) / 1000)], { timeout: 60_000, maxBuffer: 64 * 1024 * 1024, windowsHide: true });
    for (const line of stdout.split("\n").filter(Boolean)) {
      const s = JSON.parse(line);
      if (!s.messages.some((m: any) => m.role === "user") || !s.messages.some((m: any) => m.role === "assistant")) continue;
      const text = cap(s.messages.map((m: any) => `${m.role}: ${content(m.content)}`).join("\n\n"));
      const id = crypto.createHash("sha256").update(`${db}:${s.id}`).digest("hex").slice(0, 32);
      yield { kind: "chat", id: `hermes-${id}`, agent: "hermes", title: s.title || s.id, project: "hermes", firstAt: date(s.started_at), lastAt: date(s.last_at), text, source: `${db}#${s.id}` };
      seen[`${prefix}${s.id}`] = s.version;
    }
  } catch (e) { onError("hermes", e instanceof Error ? e.message : String(e)); }
}

function walk(dir: string, depth: number): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const f = path.join(dir, e.name);
    return e.isDirectory() && depth > 0 && e.name !== "subagents" ? walk(f, depth - 1) : e.isFile() && e.name.endsWith(".jsonl") ? [f] : [];
  });
}

export async function* fileChats(seen: Record<string, string>, onError: (source: string, error: string) => void): AsyncGenerator<LocalChat> {
  for (const agent of ["claude", "codex"] as const) {
    const root = agent === "claude" ? path.join(process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), ".claude"), "projects") : path.join(process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex"), "sessions");
    try {
      for (const f of walk(root, agent === "claude" ? 1 : 3)) {
        const st = fs.statSync(f);
        const version = `${st.size}:${st.mtimeMs}`;
        if (seen[f] === version || !quiet(st.mtime.toISOString()) || st.size > 100 * 1024 * 1024) continue;
        const raw = fs.readFileSync(f, "utf8");
        const items = parseTranscript(raw, agent);
        if (!items.some((m: any) => m.role === "you") || !items.some((m: any) => m.role === "agent")) continue;
        const id = `${agent}-${path.basename(f, ".jsonl")}`;
        yield { kind: "chat", id, agent, title: titleOf(items), project: path.basename(path.dirname(f)), firstAt: items[0]?.at ?? st.birthtime.toISOString(), lastAt: st.mtime.toISOString(), text: cap(condense(items)), source: f };
        seen[f] = version;
      }
    } catch (e) { onError(agent, e instanceof Error ? e.message : String(e)); }
  }
}
