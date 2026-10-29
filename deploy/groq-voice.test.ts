import assert from "node:assert/strict";
import { test } from "node:test";
import { groqJSON } from "../lib/groq";

test("fast JSON transport keeps provider-specific reasoning options compatible across fallbacks", async (t) => {
  const oldKey = process.env.GROQ_API_KEY; process.env.GROQ_API_KEY = "test-key";
  t.after(() => { if (oldKey === undefined) delete process.env.GROQ_API_KEY; else process.env.GROQ_API_KEY = oldKey; });
  const calls: Record<string, unknown>[] = [];
  t.mock.method(globalThis, "fetch", async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)); calls.push(body);
    if (calls.length === 1) return new Response("{}", { status: 429 });
    return Response.json({ choices: [{ message: { content: '{"say":"Ready.","lang":"en"}' } }] });
  });
  const answer = await groqJSON<{ say: string }>("System", "Question", 0.3, { models: ["qwen/qwen3.8-27b", "openai/gpt-oss-20b"], maxTokens: 800, reasoningEffort: "none", timeoutMs: 1800 });
  assert.equal(answer?.say, "Ready."); assert.equal(calls.length, 2);
  assert.equal(calls[0].reasoning_effort, "none"); assert.equal(calls[1].reasoning_effort, "low");
  assert.equal(calls[0].max_completion_tokens, 800);
});

test("a slow voice model cannot hold a ready backup response, and the loser is cancelled", async (t) => {
  const previous = { key: process.env.GROQ_API_KEY, model: process.env.GROQ_VOICE_MODEL };
  process.env.GROQ_API_KEY = "test-key"; process.env.GROQ_VOICE_MODEL = "qwen/qwen3.8-27b";
  t.after(() => { if (previous.key === undefined) delete process.env.GROQ_API_KEY; else process.env.GROQ_API_KEY = previous.key; if (previous.model === undefined) delete process.env.GROQ_VOICE_MODEL; else process.env.GROQ_VOICE_MODEL = previous.model; });
  let aborted = false;
  t.mock.method(globalThis, "fetch", async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    if (body.model.startsWith("qwen/")) return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => { aborted = true; reject(new Error("cancelled")); }, { once: true });
    });
    return Response.json({ choices: [{ message: { content: '{"say":"The backup is ready.","lang":"en"}' } }] });
  });
  const { voiceJSON } = await import("../lib/voice-brain");
  const result = await voiceJSON<{ say: string }>("System", "Question", 0.3);
  assert.equal(result?.say, "The backup is ready."); assert.equal(aborted, true);
});
