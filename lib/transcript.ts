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
