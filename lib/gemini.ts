// Gemini (Google AI Studio free tier) — the one free vision model that answers reliably (checked
// 2026-10-30: Groq has no vision model left, NVIDIA's VL models were gone or timing out).
// https://ai.google.dev/api/generate-content — images go inline as base64.

export const geminiKey = () => process.env.GEMINI_API_KEY ?? process.env.GOOGLE_AI_API_KEY ?? "";
export const geminiReady = () => !!geminiKey();
const model = () => process.env.GEMINI_MODEL ?? "gemini-3.5-flash-lite";

export type InlineImage = { mime: string; data: Buffer };

// One JSON answer about some images (and optional text). Throws with a readable reason.
export async function geminiJSON<T>(prompt: string, images: InlineImage[]): Promise<Partial<T>> {
  const key = geminiKey();
  if (!key) throw new Error("GEMINI_API_KEY isn't set on the VPS");
  let last = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 1500 * 2 ** attempt));
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model()}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }, ...images.map((i) => ({ inline_data: { mime_type: i.mime, data: i.data.toString("base64") } }))] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0.2 },
      }),
      signal: AbortSignal.timeout(90_000),
    }).catch((e: unknown) => {
      last = e instanceof Error ? e.message : String(e);
      return null;
    });
    if (!res) continue;
    const body = (await res.json().catch(() => null)) as { candidates?: { content?: { parts?: { text?: string }[] } }[]; error?: { message?: string } } | null;
    if (!res.ok) {
      last = `${res.status} ${body?.error?.message ?? ""}`.trim();
      if (res.status < 500 && res.status !== 429) break;
      continue;
    }
    const text = body?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    try {
      return JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, "")) as Partial<T>;
    } catch {
      last = "Gemini returned malformed JSON";
    }
  }
  throw new Error(`Gemini: ${last || "no answer"}`);
}
