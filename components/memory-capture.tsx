"use client";

import { ImagePlus, LoaderCircle, Mic, Paperclip, Send, Square, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { LibraryItem } from "@/lib/library";
import { cn } from "@/lib/utils";
import { uploadToMemory } from "./memory-upload";
import { useRecorder } from "./use-recorder";

// The capture dock: type, talk, attach, drop, or just paste (Ctrl/⌘+V an image or a file from the
// clipboard anywhere on the page — no saving it first). Everything goes to the Library; the
// automation files it.

type Pending = { key: string; file: File; url?: string; progress: number; error?: string };

export function CaptureDock({ onAdded }: { onAdded: (it: LibraryItem) => void }) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<Pending[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);

  const add = (list: FileList | File[]) => {
    const next = [...list].slice(0, 12).map((file) => ({
      key: `${file.name}-${file.size}-${Math.random().toString(36).slice(2, 7)}`,
      file,
      url: file.type.startsWith("image/") || file.type.startsWith("video/") ? URL.createObjectURL(file) : undefined,
      progress: 0,
    }));
    previews.current.push(...next.flatMap((n) => (n.url ? [n.url] : [])));
    if (next.length) setFiles((f) => [...f, ...next]);
  };

  // Paste anywhere on the page: images/files from the clipboard become attachments; text pasted
  // outside an input goes into the box.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const fs = [...(e.clipboardData?.files ?? [])];
      if (fs.length) {
        e.preventDefault();
        add(fs);
        setNote(`${fs.length === 1 ? "Pasted 1 file" : `Pasted ${fs.length} files`} — add a note or press Remember.`);
        area.current?.focus();
        return;
      }
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable]")) return;
      const t = e.clipboardData?.getData("text") ?? "";
      if (t) {
        e.preventDefault();
        setText((x) => (x ? `${x}\n${t}` : t));
        area.current?.focus();
      }
    };
    const over = (e: DragEvent) => {
      if (![...(e.dataTransfer?.types ?? [])].includes("Files")) return;
      e.preventDefault();
      setDrag(true);
    };
    const leave = (e: DragEvent) => {
      if (!e.relatedTarget) setDrag(false);
    };
    const drop = (e: DragEvent) => {
      if (!e.dataTransfer?.files?.length) return;
      e.preventDefault();
      setDrag(false);
      add(e.dataTransfer.files);
    };
    window.addEventListener("paste", onPaste);
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("paste", onPaste);
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, []);

  // Previews are freed when the dock goes away (not on every change — they're still on screen).
  const previews = useRef<string[]>([]);
  useEffect(() => () => previews.current.forEach((u) => URL.revokeObjectURL(u)), []);

  const voice = useRecorder(async (audio) => {
    setBusy(true);
    setNote("Saving the voice note…");
    try {
      onAdded(await uploadToMemory(audio, { voice: true, name: audio.type.includes("mp4") ? "voice.m4a" : "voice.webm" }));
      setNote("Voice note saved — transcribing and filing it.");
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Couldn't save the voice note.");
    } finally {
      setBusy(false);
    }
  });

  async function submit() {
    const body = text.trim();
    if (!body && !files.length) return;
    setBusy(true);
    setNote("");
    let failed = 0;
    try {
      // Files carry the typed text as their note; text alone becomes a note of its own.
      for (const p of files) {
        try {
          const it = await uploadToMemory(p.file, { note: body, onProgress: (f) => setFiles((all) => all.map((x) => (x.key === p.key ? { ...x, progress: f } : x))) });
          onAdded(it);
          setFiles((all) => all.filter((x) => x.key !== p.key));
        } catch (e) {
          failed++;
          setFiles((all) => all.map((x) => (x.key === p.key ? { ...x, error: e instanceof Error ? e.message : "failed" } : x)));
        }
      }
      if (!files.length && body) {
        const res = await fetch("/api/memory/items", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: body }) });
        const out = await res.json().catch(() => null);
        if (!res.ok || !out?.item) throw new Error(out?.error ?? `error ${res.status}`);
        onAdded(out.item);
      }
      if (!failed) setText("");
      setNote(failed ? `${failed} didn't upload — tap Remember to retry.` : "Remembered — the Core is filing it.");
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Couldn't save that.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={cn("panel relative mb-6 overflow-hidden p-3 transition-shadow duration-300 sm:p-4", drag && "drop-glow")} aria-label="Add to memory">
      {drag && <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center bg-[#0b0712]/80 text-sm text-text backdrop-blur-sm">Drop to remember</div>}
      <textarea
        ref={area}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void submit();
          }
        }}
        rows={2}
        placeholder="Remember anything — type, paste a screenshot, drop a video, or hold the mic…"
        aria-label="What to remember"
        className="bare-field block max-h-48 min-h-[52px] w-full resize-none bg-transparent px-2 py-1.5 text-[15px] leading-relaxed placeholder:text-faint focus:outline-none"
      />

      {files.length > 0 && (
        <ul className="flex gap-2 overflow-x-auto px-1 pt-2 pb-1">
          {files.map((p) => (
            <li key={p.key} className="land relative h-20 w-20 shrink-0 overflow-hidden rounded-[12px] border border-line bg-white/[0.03]">
              {p.url && p.file.type.startsWith("image/") ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.url} alt="" className="h-full w-full object-cover" />
              ) : p.url ? (
                <video src={p.url} muted className="h-full w-full object-cover" />
              ) : (
                <span className="grid h-full w-full place-items-center px-1 text-center text-[10px] break-all text-muted">{p.file.name}</span>
              )}
              {busy && p.progress < 1 && !p.error && (
                <span className="absolute inset-x-0 bottom-0 h-1 bg-black/50">
                  <span className="block h-full bg-hermes transition-[width] duration-300" style={{ width: `${Math.max(6, p.progress * 100)}%` }} />
                </span>
              )}
              {p.error && <span className="absolute inset-x-0 bottom-0 bg-bad/80 px-1 text-[9px] text-white">{p.error}</span>}
              <button
                onClick={() => setFiles((f) => f.filter((x) => x.key !== p.key))}
                aria-label={`Remove ${p.file.name}`}
                className="absolute top-1 right-1 grid h-6 w-6 place-items-center rounded-full bg-black/70 text-white"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-2 flex items-center gap-1.5">
        <input ref={input} type="file" multiple accept="image/*,video/*,audio/*,application/pdf,.txt,.md,.csv,.json" className="hidden" onChange={(e) => e.target.files && add(e.target.files)} />
        <button onClick={() => input.current?.click()} className="press flex h-10 items-center gap-2 rounded-[11px] px-3 text-sm text-muted hover:bg-white/5 hover:text-text" aria-label="Attach photos, videos or files">
          <ImagePlus className="h-4 w-4" /> <span className="hidden sm:inline">Photo / video</span>
        </button>
        <button onClick={() => input.current?.click()} className="press hidden h-10 items-center gap-2 rounded-[11px] px-3 text-sm text-muted hover:bg-white/5 hover:text-text sm:flex" aria-label="Attach a file">
          <Paperclip className="h-4 w-4" /> File
        </button>
        <button
          onClick={voice.toggle}
          disabled={busy && !voice.recording}
          aria-label={voice.recording ? "Stop and save the voice note" : "Record a voice note"}
          className={cn("press flex h-10 items-center gap-2 rounded-[11px] px-3 text-sm transition-colors", voice.recording ? "bg-bad/15 text-bad" : "text-muted hover:bg-white/5 hover:text-text")}
        >
          {voice.recording ? <Square className="h-3.5 w-3.5 fill-current" /> : <Mic className="h-4 w-4" />}
          {voice.recording ? <span className="tnum font-mono text-xs">{voice.seconds}s · stop</span> : <span className="hidden sm:inline">Voice</span>}
        </button>
        <p className="mx-2 hidden min-w-0 flex-1 truncate text-xs text-faint md:block" aria-live="polite">
          {voice.error || note || "Paste images straight from the clipboard · ⌘/Ctrl+Enter to save"}
        </p>
        <button
          onClick={() => void submit()}
          disabled={busy || (!text.trim() && !files.length)}
          className="press ml-auto flex h-10 items-center gap-2 rounded-[11px] bg-text px-4 text-sm font-medium text-bg transition-opacity disabled:opacity-30"
        >
          {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Remember
        </button>
      </div>
      <p className="mt-1 px-2 text-xs text-faint md:hidden" aria-live="polite">
        {voice.error || note}
      </p>
    </section>
  );
}
