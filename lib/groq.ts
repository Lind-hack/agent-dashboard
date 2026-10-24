import { groqKey, groqModel, REPO_KEYS, type AgentKey, type RepoKey } from "./config";

// Groq free tier: Whisper for speech-to-text, gpt-oss for turning a ramble into a ticket.
// https://console.groq.com/docs/speech-to-text — OpenAI-compatible endpoints.

export async function transcribe(audio: Blob, filename: string): Promise<string> {
  const form = new FormData();
  form.append("file", audio, filename);
  form.append("model", "whisper-large-v3-turbo");
  form.append("response_format", "json");
  const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${groqKey()}` },
    body: form,
  });
  const body = (await res.json().catch(() => null)) as { text?: string; error?: { message?: string } } | null;
  if (!res.ok) throw new Error(`Whisper: ${body?.error?.message ?? res.status}`);
  return (body?.text ?? "").trim();
}

const FALLBACK_MODELS = ["llama-3.3-70b-versatile", "openai/gpt-oss-20b"];

export type TaskDraft ={ title: string; description: string; agent: AgentKey; repo: RepoKey };

export async function draftTask(
  text: string,
  defaults: { agent?: AgentKey; repo?: RepoKey },
): Promise<TaskDraft> {
  const system = `You turn a dictated voice note into one Linear issue for a coding agent.
Return JSON: {"title": string, "description": string, "agent": "claude"|"codex"|null, "repo": ${REPO_KEYS.map((r) => `"${r}"`).join("|")}|null}.
- title: imperative, under 80 chars.
- description: markdown. Restate exactly what to build or fix, with every concrete detail from the note (names, numbers, pages, behaviour). Add an "Acceptance" checklist. Do not invent requirements.
- Keep the note's language (Albanian stays Albanian, English stays English).
- agent: "codex" only if the note asks for Codex, "claude" if it asks for Claude, else null.
- repo: "383" for the 383 / 383lajme news site, "agent-dashboard" for this agent dashboard, else null.`;
  // The Groq key is shared with other tools, so a model's daily quota can be gone. Each model has
  // its own quota — walk the ladder, and if every model fails, file the raw note rather than lose it.
  let parsed: Partial<{ title: string; description: string; agent: string | null; repo: string | null }> = {};
  for (const model of [...new Set([groqModel(), ...FALLBACK_MODELS])]) {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${groqKey()}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: text },
        ],
      }),
    }).catch(() => null);
    const body = (await res?.json().catch(() => null)) as { choices?: { message?: { content?: string } }[] } | null;
    if (!res?.ok) continue;
    try {
      parsed = JSON.parse(body?.choices?.[0]?.message?.content ?? "{}") ?? {};
      break;
    } catch {
      // malformed JSON — try the next model
    }
  }
  const agent =
    parsed?.agent === "codex" || parsed?.agent === "claude" ? parsed.agent : /\bcodex\b/i.test(text) ? "codex" : /\bclaude\b/i.test(text) ? "claude" : null;
  const repo = REPO_KEYS.includes(parsed?.repo as RepoKey)
    ? (parsed?.repo as RepoKey)
    : /\bdashboard\b/i.test(text)
      ? "agent-dashboard"
      : null;
  return {
    title: (parsed?.title || text.slice(0, 80)).trim(),
    description: (parsed?.description || text).trim() + `\n\n---\n_Voice note:_ ${text}`,
    // An explicit choice in the UI wins over what the model guessed.
    agent: defaults.agent ?? agent ?? "claude",
    repo: defaults.repo ?? repo ?? "383",
  };
}
