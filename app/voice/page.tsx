"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { cn } from "@/lib/utils";

type Result = {
  transcript: string;
  draft: { title: string; agent: string; repo: string };
  issue: { identifier: string; url: string };
  note?: string;
};

const AGENTS = ["auto", "claude", "codex"] as const;
const REPOS = ["auto", "383", "agent-dashboard"] as const;

// iOS Safari records mp4/aac, Chrome/Android webm/opus — Whisper takes both.
function pickMime(): string {
  for (const m of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m)) return m;
  }
  return "";
}

function Choice<T extends string>({ value, options, onChange }: { value: T; options: readonly T[]; onChange: (v: T) => void }) {
  return (
    <div className="flex rounded-lg border border-line p-0.5 text-sm">
      {options.map((o) => (
        <button key={o} onClick={() => onChange(o)} className={cn("flex-1 rounded-md px-3 py-1.5", value === o ? "bg-white/10 text-text" : "text-muted")}>
          {o}
        </button>
      ))}
    </div>
  );
}

export default function VoicePage() {
  const [agent, setAgent] = useState<(typeof AGENTS)[number]>("auto");
  const [repo, setRepo] = useState<(typeof REPOS)[number]>("auto");
  const [text, setText] = useState("");
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  async function send(audio?: Blob) {
    setBusy(true);
    setError("");
    setResult(null);
    const form = new FormData();
    form.set("agent", agent);
    form.set("repo", repo);
    form.set("text", text);
    if (audio) form.set("audio", audio, audio.type.includes("mp4") ? "note.mp4" : "note.webm");
    const res = await fetch("/api/tasks", { method: "POST", body: form }).catch(() => null);
    const body = await res?.json().catch(() => null);
    setBusy(false);
    if (!res?.ok) return setError(body?.error ?? "Couldn't reach the server");
    setResult(body);
    setText("");
  }

  async function toggle() {
    if (recording) {
      recorder.current?.stop();
      return;
    }
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = pickMime();
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunks.current = [];
      rec.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        if (timer.current) clearInterval(timer.current);
        setRecording(false);
        void send(new Blob(chunks.current, { type: rec.mimeType || mime || "audio/webm" }));
      };
      rec.start();
      recorder.current = rec;
      setSeconds(0);
      timer.current = setInterval(() => setSeconds((s) => s + 1), 1000);
      setRecording(true);
    } catch {
      setError("Microphone blocked — allow it for this site, or type instead.");
    }
  }

  return (
    <div className="mx-auto flex max-w-md flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Choice value={agent} options={AGENTS} onChange={setAgent} />
        <Choice value={repo} options={REPOS} onChange={setRepo} />
      </div>

      <button
        onClick={toggle}
        disabled={busy}
        className={cn(
          "mx-auto mt-4 flex h-44 w-44 flex-col items-center justify-center rounded-full border-2 text-sm font-medium transition",
          recording ? "animate-pulse border-bad bg-bad/15 text-bad" : "border-accent bg-accent/10 text-accent",
          busy && "opacity-40",
        )}
      >
        {busy ? "Creating task…" : recording ? `Stop · ${seconds}s` : "Tap to talk"}
      </button>

      <div className="flex gap-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          placeholder="…or type the task"
          className="min-w-0 flex-1 resize-none rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none focus:border-accent"
        />
        <button onClick={() => send()} disabled={busy || recording || !text.trim()} className="rounded-lg bg-accent px-4 text-sm font-medium text-bg disabled:opacity-40">
          Add
        </button>
      </div>

      {error && <p className="text-sm text-bad">{error}</p>}
      {result && (
        <div className="rounded-xl border border-line bg-panel p-4 text-sm">
          <p className="mb-1 font-mono text-xs text-muted">
            {result.issue.identifier} · {result.draft.agent} · {result.draft.repo}
          </p>
          <p className="mb-3 font-medium">{result.draft.title}</p>
          <p className="mb-3 text-muted">“{result.transcript}”</p>
          {result.note && <p className="mb-3 text-warn">{result.note}</p>}
          <div className="flex gap-4">
            <a href={result.issue.url} target="_blank" rel="noreferrer" className="text-accent">
              Open in Linear ↗
            </a>
            {result.draft.agent === "claude" && (
              <Link href={`/jobs/${result.issue.identifier}`} className="text-accent">
                Watch Claude →
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
