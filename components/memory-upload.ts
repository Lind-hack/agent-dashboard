import type { LibraryItem } from "@/lib/library";

// Sends one file to Memory in 8 MB chunks (the proxy buffers ~10 MB per request). A chunk the
// server didn't expect gets resent from where it says to resume; anything else throws.
const CHUNK = 8 * 1024 * 1024;

export async function uploadToMemory(file: Blob, opts: { name?: string; voice?: boolean; note?: string; onProgress?: (f: number) => void } = {}): Promise<LibraryItem> {
  if (file.size > 200 * 1024 * 1024) throw new Error("Files up to 200 MB.");
  const id = crypto.randomUUID();
  const count = Math.max(1, Math.ceil(file.size / CHUNK));
  let i = 0;
  let retries = 0;
  while (i < count) {
    const res = await fetch("/api/memory/upload", {
      method: "POST",
      headers: {
        "x-upload": id,
        "x-index": String(i),
        "x-count": String(count),
        "x-name": encodeURIComponent(opts.name ?? (file instanceof File ? file.name : "")),
        "x-type": file.type || "application/octet-stream",
        "x-voice": opts.voice ? "1" : "0",
        ...(i === count - 1 && opts.note ? { "x-note": encodeURIComponent(opts.note) } : {}),
      },
      body: file.slice(i * CHUNK, (i + 1) * CHUNK),
    }).catch(() => null);
    const body = (await res?.json().catch(() => null)) as { item?: LibraryItem; expected?: number; error?: string } | null;
    if (res?.status === 409 && typeof body?.expected === "number" && retries++ < 3) {
      i = body.expected;
      continue;
    }
    if (!res) {
      if (retries++ < 3) continue; // dropped connection: resend this chunk
      throw new Error("Upload interrupted — check the connection.");
    }
    if (!res.ok) throw new Error(body?.error ?? `upload failed (${res.status})`);
    i++;
    opts.onProgress?.(i / count);
    if (body?.item) return body.item;
  }
  throw new Error("Upload didn't finish.");
}
