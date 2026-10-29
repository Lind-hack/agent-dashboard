import { groqKey, groqModel, repoShort, type RepoKey, type TaskAgent } from "./config";

// Groq free tier: Whisper for speech-to-text, gpt-oss for turning a ramble into a ticket.
// https://console.groq.com/docs/speech-to-text — OpenAI-compatible endpoints.

export type Transcription = { text: string; language: string };

export async function transcribeDetailed(audio: Blob, filename: string): Promise<Transcription> {
  // Language is left on auto-detect so Albanian and English both transcribe as spoken (Whisper
  // translates nothing on this endpoint). One retry covers a dropped connection or a cold model.
  let last = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 400));
    const form = new FormData();
    form.append("file", audio, filename);
    form.append("model", "whisper-large-v3-turbo");
    form.append("response_format", "verbose_json");
    form.append("temperature", "0");
    const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${groqKey()}` },
      body: form,
      signal: AbortSignal.timeout(30_000),
    }).catch(() => null);
    const body = (await res?.json().catch(() => null)) as { text?: string; language?: string; error?: { message?: string } } | null;
    if (res?.ok) return { text: (body?.text ?? "").trim(), language: body?.language ?? "" };
    last = `Whisper: ${body?.error?.message ?? res?.status ?? "unreachable"}`;
    if (res && res.status < 500 && res.status !== 429) break; // a real request error won't fix itself
  }
  throw new Error(last);
}

export async function transcribe(audio: Blob, filename: string): Promise<string> {
  return (await transcribeDetailed(audio, filename)).text;
}

// llama-3.3-70b was retired on Groq; qwen3.8 has its own daily quota.
const FALLBACK_MODELS = ["qwen/qwen3.8-27b", "openai/gpt-oss-20b"];

// One JSON answer from the first model on the ladder that still has quota; null if all fail.
export async function groqJSON<T>(system: string, user: string, temperature = 0.2, options: { models?: string[]; maxTokens?: number; reasoningEffort?: "none" | "low" | "medium" | "high"; timeoutMs?: number; signal?: AbortSignal } = {}): Promise<Partial<T> | null> {
  for (const model of [...new Set(options.models ?? [groqModel(), ...FALLBACK_MODELS])]) {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${groqKey()}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        temperature,
        ...(options.maxTokens ? { max_completion_tokens: options.maxTokens } : {}),
        ...(options.reasoningEffort && (model.startsWith("openai/gpt-oss-") || model.startsWith("qwen/")) ? { reasoning_effort: model.startsWith("openai/gpt-oss-") && options.reasoningEffort === "none" ? "low" : options.reasoningEffort } : {}),
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
      signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(options.timeoutMs ?? 20_000)]) : AbortSignal.timeout(options.timeoutMs ?? 20_000),
    }).catch(() => null);
    const body = (await res?.json().catch(() => null)) as { choices?: { message?: { content?: string } }[] } | null;
    if (!res?.ok) continue;
    try {
      return (JSON.parse(body?.choices?.[0]?.message?.content ?? "{}") ?? {}) as Partial<T>;
    } catch {
      // malformed JSON — try the next model
    }
  }
  return null;
}

export type TaskDraft = { title: string; description: string; agent: TaskAgent; repo: RepoKey };

// `repos` = what the picker offers; the model may only choose among those.
export async function draftTask(
  text: string,
  defaults: { agent?: TaskAgent; repo?: RepoKey; repos: RepoKey[]; fallbackRepo: RepoKey },
): Promise<TaskDraft> {
  const shorts = defaults.repos.map(repoShort);
  const system = `You turn a dictated voice note into one Linear issue for a coding agent.
Return JSON: {"title": string, "description": string, "agent": "claude"|"codex"|"codex-cloud"|null, "repo": string|null}.
- title: imperative, under 80 chars.
- description: markdown. Restate exactly what to build or fix, with every concrete detail from the note (names, numbers, pages, behaviour). Add an "Acceptance" checklist. Do not invent requirements.
- Keep the note's language (Albanian stays Albanian, English stays English).
- agent: "codex-cloud" if the note asks for Codex cloud, "codex" if it asks for Codex, "claude" if it asks for Claude, else null.
- repo: one of ${JSON.stringify(shorts)} if the note names it (383 / the news site = "383lajme"), else null.`;
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
      signal: AbortSignal.timeout(20_000),
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
  const agents: TaskAgent[] = ["claude", "codex", "codex-cloud"];
  const agent = agents.includes(parsed?.agent as TaskAgent)
    ? (parsed?.agent as TaskAgent)
    : /\bcodex\b/i.test(text)
      ? "codex"
      : /\bclaude\b/i.test(text)
        ? "claude"
        : null;
  const repo = defaults.repos.find((r) => repoShort(r) === parsed?.repo) ?? null;
  return {
    title: (parsed?.title || text.slice(0, 80)).trim(),
    description: (parsed?.description || text).trim() + `\n\n---\n_Voice note:_ ${text}`,
    // An explicit choice in the UI wins over what the model guessed.
    agent: defaults.agent ?? agent ?? "claude",
    repo: defaults.repo ?? repo ?? defaults.fallbackRepo,
  };
}
