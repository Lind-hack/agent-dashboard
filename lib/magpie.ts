// GPU speech via the dashboard's existing NVIDIA account. Keep credentials on the server.
// https://build.nvidia.com/nvidia/magpie-tts-multilingual/api
const ENDPOINT = "https://877104f7-e885-42b9-8de8-f6e4c6303969.invocation.api.nvcf.nvidia.com/v1/audio/synthesize";
let retryAfter = 0;
export const magpieReady = () => !!process.env.NVIDIA_API_KEY && Date.now() >= retryAfter;

export async function magpieWav(text: string, signal?: AbortSignal): Promise<Buffer | null> {
  if (!magpieReady() || signal?.aborted) return null;
  const form = new FormData();
  for (const [key, value] of Object.entries({ text, language: "en-US", voice: "Magpie-Multilingual.EN-US.Aria", encoding: "LINEAR_PCM", sample_rate_hz: "22050" })) form.set(key, value);
  try {
    const timeout = AbortSignal.timeout(1500);
    const res = await fetch(ENDPOINT, {
      method: "POST", headers: { Authorization: `Bearer ${process.env.NVIDIA_API_KEY}` }, body: form,
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (!res.ok) throw new Error(`Speech HTTP ${res.status}`);
    const wav = Buffer.from(await res.arrayBuffer());
    if (wav.length < 44 || wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE") throw new Error("Invalid speech audio");
    return wav;
  } catch {
    // A slow/unavailable provider must not add this timeout to every subsequent turn.
    if (!signal?.aborted) retryAfter = Date.now() + 60_000;
    return null;
  }
}
