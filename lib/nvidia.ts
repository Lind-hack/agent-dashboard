// NVIDIA NIM (build.nvidia.com), OpenAI-compatible, free tier (~40 requests/min). Used for the bulk
// reading work — hand-off dossiers now, the brain later. Model: Nemotron 3 Ultra.

export const nvidiaModel = () => process.env.NVIDIA_MODEL ?? "nvidia/nemotron-3-ultra-550b-a55b";
export const nvidiaReady = () => !!process.env.NVIDIA_API_KEY;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// One completion with retries on rate limits / server errors. Reasoning text is stripped.
export async function nemotron(system: string, user: string, opts: { maxTokens?: number; temperature?: number } = {}): Promise<string> {
  const key = process.env.NVIDIA_API_KEY;
  if (!key) throw new Error("NVIDIA_API_KEY is not set on the VPS");
  let lastErr = "";
  for (let attempt = 0; attempt < 4; attempt++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 240_000);
    try {
      const res = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
        method: "POST",
        signal: ctl.signal,
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: nvidiaModel(),
          temperature: opts.temperature ?? 0.2,
          max_tokens: opts.maxTokens ?? 4000,
          messages: [
            { role: "system", content: `detailed thinking off\n\n${system}` },
            { role: "user", content: user },
          ],
        }),
      });
      const body = (await res.json().catch(() => null)) as { choices?: { message?: { content?: string } }[]; detail?: string; error?: { message?: string } } | null;
      if (res.ok) {
        const text = (body?.choices?.[0]?.message?.content ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
        if (text) return text;
        lastErr = "empty reply";
      } else {
        lastErr = `${res.status} ${body?.detail ?? body?.error?.message ?? ""}`.trim();
        if (res.status < 500 && res.status !== 429) break; // bad request — retrying won't help
      }
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
    } finally {
      clearTimeout(timer);
    }
    await sleep(2000 * 2 ** attempt);
  }
  throw new Error(`Nemotron: ${lastErr}`);
}

// Runs fns with at most `n` in flight (the free tier is rate-limited).
export async function limited<T>(n: number, fns: (() => Promise<T>)[]): Promise<T[]> {
  const out: T[] = new Array(fns.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, fns.length) }, async () => {
      while (next < fns.length) {
        const i = next++;
        out[i] = await fns[i]();
      }
    }),
  );
  return out;
}
