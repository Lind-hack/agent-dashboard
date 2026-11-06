import { geminiJSON, geminiReady } from "./gemini";
import { groqJSON } from "./groq";
import { nemotron, nvidiaReady } from "./nvidia";

// One JSON answer for work that mustn't fail on a quota (v5.5): the Groq key is shared and runs out, and
// a long dictation is the worst moment. Groq, then Gemini, then Nemotron; `good` says what counts as an
// answer. null means every model failed, which is not the same as "nothing to do".
export async function askJSON<T>(system: string, user: string, opts: { maxTokens: number; temperature: number; good: (out: Partial<T>) => boolean }): Promise<Partial<T> | null> {
  const ok = (out: Partial<T> | null | undefined): out is Partial<T> => !!out && opts.good(out);
  const groq = await groqJSON<T>(system, user, opts.temperature, { maxTokens: opts.maxTokens, timeoutMs: 40_000, reasoningEffort: "low" }).catch(() => null);
  if (ok(groq)) return groq;
  if (geminiReady()) {
    const gemini = await geminiJSON<T>(`${system}\n\n${user}`, []).catch(() => null);
    if (ok(gemini)) return gemini;
  }
  if (nvidiaReady()) {
    const raw = await nemotron(`${system}\nReturn ONLY the JSON object.`, user, { maxTokens: opts.maxTokens, temperature: opts.temperature }).catch(() => "");
    try {
      const out = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as Partial<T>;
      if (ok(out)) return out;
    } catch {
      /* every model failed */
    }
  }
  return null;
}
