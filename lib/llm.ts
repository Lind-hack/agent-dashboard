import fs from "node:fs";
import path from "node:path";
import { geminiJSON } from "./gemini";
import { dataDir, personalize } from "./tenant";
import { apiKey, type KeyName } from "./user-keys";

// The providers a user can bring. Groq stays the first choice for the owner (lib/groq.ts); other users get
// whichever of their own keys works, their chosen one first. Every call returns parsed JSON or null.
export const PROVIDERS = ["gemini", "groq", "anthropic", "openai", "openrouter"] as const;
export type Provider = (typeof PROVIDERS)[number];

export const PROVIDER_KEY: Record<Provider, KeyName> = {
  gemini: "GEMINI_API_KEY",
  groq: "GROQ_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
};

export const DEFAULT_MODELS: Record<Provider, string> = {
  gemini: process.env.GEMINI_MODEL ?? "gemini-3.5-flash-lite",
  groq: process.env.GROQ_MODEL ?? "openai/gpt-oss-120b",
  anthropic: "claude-haiku-5-5",
  openai: "gpt-5-mini",
  openrouter: "openrouter/auto",
};

export const PROVIDER_LABEL: Record<Provider, string> = { gemini: "Gemini", groq: "Groq", anthropic: "Claude", openai: "ChatGPT", openrouter: "OpenRouter" };

export type AiPrefs = { first?: Provider; models?: Partial<Record<Provider, string>> };
const prefsFile = () => path.join(dataDir(), "ai.json");

export function aiPrefs(): AiPrefs {
  try {
    const raw = JSON.parse(fs.readFileSync(prefsFile(), "utf8")) as AiPrefs;
    return {
      first: PROVIDERS.includes(raw?.first as Provider) ? raw.first : undefined,
      models: raw?.models && typeof raw.models === "object" ? raw.models : {},
    };
  } catch {
    return {};
  }
}

export function saveAiPrefs(p: AiPrefs) {
  const models = Object.fromEntries(
    Object.entries(p.models ?? {}).filter(([k, v]) => PROVIDERS.includes(k as Provider) && typeof v === "string" && /^[\w./:-]{1,100}$/.test(v)),
  );
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.writeFileSync(prefsFile(), JSON.stringify({ first: PROVIDERS.includes(p.first as Provider) ? p.first : undefined, models }, null, 2));
}

export const modelFor = (p: Provider) => aiPrefs().models?.[p] || DEFAULT_MODELS[p];

// Providers with a key, the user's chosen one first.
export function providerOrder(): Provider[] {
  const first = aiPrefs().first;
  const order = first ? [first, ...PROVIDERS.filter((p) => p !== first)] : [...PROVIDERS];
  return order.filter((p) => !!apiKey(PROVIDER_KEY[p]));
}

function parse<T>(text: string | undefined): Partial<T> | null {
  if (!text?.trim()) return null;
  const t = text.replace(/^```(?:json)?\s*|\s*```$/g, "");
  try {
    return JSON.parse(t) as Partial<T>;
  } catch {
    const a = t.indexOf("{");
    const b = t.lastIndexOf("}");
    if (a < 0 || b <= a) return null;
    try {
      return JSON.parse(t.slice(a, b + 1)) as Partial<T>;
    } catch {
      return null;
    }
  }
}

type Opts = { maxTokens?: number; temperature?: number; timeoutMs?: number; signal?: AbortSignal };
const signalOf = (o: Opts) => (o.signal ? AbortSignal.any([o.signal, AbortSignal.timeout(o.timeoutMs ?? 60_000)]) : AbortSignal.timeout(o.timeoutMs ?? 60_000));

// OpenAI, Groq and OpenRouter speak the same chat API.
async function openaiStyle<T>(url: string, key: string, model: string, system: string, user: string, o: Opts, jsonMode = true): Promise<Partial<T> | null> {
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      ...(o.temperature !== undefined && !model.startsWith("gpt-5") ? { temperature: o.temperature } : {}),
      ...(o.maxTokens ? { max_completion_tokens: o.maxTokens } : {}),
      ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
      messages: [
        { role: "system", content: `${system}\nReturn ONLY one JSON object.` },
        { role: "user", content: user },
      ],
    }),
    signal: signalOf(o),
  }).catch(() => null);
  if (!res?.ok) return null;
  const body = (await res.json().catch(() => null)) as { choices?: { message?: { content?: string } }[] } | null;
  return parse<T>(body?.choices?.[0]?.message?.content);
}

// https://docs.anthropic.com/en/api/messages
async function anthropic<T>(key: string, model: string, system: string, user: string, o: Opts): Promise<Partial<T> | null> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model,
      max_tokens: o.maxTokens ?? 4000,
      ...(o.temperature !== undefined ? { temperature: o.temperature } : {}),
      system: `${system}\nReturn ONLY one JSON object, no prose.`,
      messages: [{ role: "user", content: user }],
    }),
    signal: signalOf(o),
  }).catch(() => null);
  if (!res?.ok) return null;
  const body = (await res.json().catch(() => null)) as { content?: { type?: string; text?: string }[] } | null;
  return parse<T>(body?.content?.filter((c) => c.type === "text").map((c) => c.text ?? "").join(""));
}

export async function providerJSON<T>(p: Provider, rawSystem: string, rawUser: string, o: Opts = {}): Promise<Partial<T> | null> {
  const key = apiKey(PROVIDER_KEY[p]);
  if (!key) return null;
  const system = personalize(rawSystem, true);
  const user = personalize(rawUser);
  const model = modelFor(p);
  switch (p) {
    case "gemini":
      return geminiJSON<T>(`${rawSystem}\n\n${rawUser}`, []).catch(() => null); // geminiJSON personalizes itself
    case "groq":
      return openaiStyle<T>("https://api.groq.com/openai/v1/chat/completions", key, model, system, user, o);
    case "openai":
      return openaiStyle<T>("https://api.openai.com/v1/chat/completions", key, model, system, user, o);
    case "openrouter":
      return openaiStyle<T>("https://openrouter.ai/api/v1/chat/completions", key, model, system, user, o);
    case "anthropic":
      return anthropic<T>(key, model, system, user, o);
  }
}

// The first provider that answers. `skip` leaves one out (the caller already tried it).
export async function anyJSON<T>(system: string, user: string, o: Opts = {}, skip?: Provider): Promise<Partial<T> | null> {
  for (const p of providerOrder()) {
    if (p === skip) continue;
    const out = await providerJSON<T>(p, system, user, o);
    if (out) return out;
  }
  return null;
}

// Checks a pasted key with the cheapest call each provider has. true = the key works.
export async function testKey(p: Provider, key: string): Promise<{ ok: boolean; why?: string }> {
  const get = async (url: string, headers: Record<string, string>) => {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) }).catch(() => null);
    if (!res) return { ok: false, why: "Couldn't reach the provider" };
    if (res.ok) return { ok: true };
    return { ok: false, why: res.status === 401 || res.status === 403 || res.status === 400 ? "The provider rejected this key" : `The provider answered ${res.status}` };
  };
  switch (p) {
    case "gemini":
      return get("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1", { "x-goog-api-key": key });
    case "groq":
      return get("https://api.groq.com/openai/v1/models", { Authorization: `Bearer ${key}` });
    case "openai":
      return get("https://api.openai.com/v1/models", { Authorization: `Bearer ${key}` });
    case "openrouter":
      return get("https://openrouter.ai/api/v1/key", { Authorization: `Bearer ${key}` });
    case "anthropic":
      return get("https://api.anthropic.com/v1/models?limit=1", { "x-api-key": key, "anthropic-version": "2023-06-01" });
  }
}
