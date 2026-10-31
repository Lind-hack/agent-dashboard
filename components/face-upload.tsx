"use client";

import { ImageUp, LoaderCircle, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

// Picks the face behind the mirror and the morning push (v5.2). Stays on Lind's own server.
export function FaceUpload({ set }: { set: boolean }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function upload(file: File) {
    setBusy(true);
    setErr("");
    const form = new FormData();
    form.append("image", file);
    const r = await fetch("/api/mirror/face", { method: "POST", body: form }).catch(() => null);
    const out = await r?.json().catch(() => null);
    if (!r?.ok) setErr(out?.error ?? "Upload failed.");
    setBusy(false);
    router.refresh();
  }

  async function remove() {
    await fetch("/api/mirror/face", { method: "DELETE" }).catch(() => null);
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,image/avif" className="hidden" onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
      <button onClick={() => input.current?.click()} disabled={busy} className="press flex h-10 items-center gap-2 rounded-[11px] border border-white/15 bg-black/40 px-3.5 text-sm text-white/80 backdrop-blur hover:text-white">
        {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ImageUp className="h-4 w-4" />} {set ? "Change the face" : "Set the face"}
      </button>
      {set && (
        <button onClick={() => void remove()} aria-label="Remove the face" className="press grid h-10 w-10 place-items-center rounded-[11px] border border-white/15 bg-black/40 text-white/60 backdrop-blur hover:text-white">
          <Trash2 className="h-4 w-4" />
        </button>
      )}
      {err && <span className="text-[12.5px] text-bad">{err}</span>}
    </div>
  );
}
