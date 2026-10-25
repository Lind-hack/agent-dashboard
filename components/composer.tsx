"use client";

import { Check, GitBranch, LoaderCircle, Mic, SendHorizontal, Square } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { audioFilename, useRecorder } from "@/components/use-recorder";
import { AGENT_LABELS, AGENT_META, type TaskAgent } from "@/lib/agents";
import { cn } from "@/lib/utils";

type Repo = { name: string; base: string; private: boolean };

const AGENTS = (["claude", "codex", "opencode", "hermes", "codex-cloud"] as TaskAgent[]).map((key) => ({ key, ...AGENT_META[key] }));

// Remembered per device so the phone opens on the last choice.
function useRemembered<T extends string>(key: string, fallback: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(fallback);
  useEffect(() => {
    try {
      const v = localStorage.getItem(key);
      if (v) setValue(v as T);
    } catch {}
  }, [key]);
  return [
    value,
    (v: T) => {
      setValue(v);
      try {
        localStorage.setItem(key, v);
      } catch {}
    },
  ];
}

// Start a chat: pick who and where, then talk (tap the orb) or type. Used as the /voice page and
// inside the global Talk sheet.
export function Composer({ autoFocusText = false, onStarted }: { autoFocusText?: boolean; onStarted?: () => void }) {
  const router = useRouter();
  const [agent, setAgent] = useRemembered<TaskAgent>("ad.agent", "claude");
  const [repo, setRepo] = useRemembered<string>("ad.repo", "");
  const [linear, setLinear] = useRemembered<"1" | "0">("ad.linear", "0");
  const [repos, setRepos] = useState<Repo[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/repos")
      .then((r) => r.json())
      .then((b: { repos?: Repo[]; error?: string }) => {
        setRepos(b?.repos ?? []);
        if (b?.error) setError(`GitHub: ${b.error}`);
      })
      .catch(() => setError("Couldn't load your repos — check the connection and reopen."));
  }, []);

  // Fall back to the first repo when nothing (or a repo the token lost) is remembered.
  const selectedRepo = repos.some((r) => r.name === repo) ? repo : (repos[0]?.name ?? "");
  const tracked = agent === "codex-cloud" || linear === "1";
  const color = AGENTS.find((a) => a.key === agent)?.color ?? "var(--color-claude)";

  async function send(audio?: Blob) {
    setBusy(true);
    setError("");
    const form = new FormData();
    form.set("agent", agent);
    form.set("repo", selectedRepo);
    form.set("linear", tracked ? "1" : "0");
    form.set("text", text);
    if (audio) form.set("audio", audio, audioFilename(audio));
    const res = await fetch("/api/tasks", { method: "POST", body: form }).catch(() => null);
    const body = await res?.json().catch(() => null);
    if (!res?.ok) {
      setBusy(false);
      return setError(body?.error ?? "Couldn't reach the dashboard — try again.");
    }
    if (body?.note) {
      // e.g. Codex for Linear isn't installed: the issue exists but nobody will pick it up.
      setBusy(false);
      return setError(`${body.id}: ${body.note}`);
    }
    onStarted?.();
    router.push(body.href);
  }

  const mic = useRecorder((audio) => void send(audio));

  return (
    <div className="flex flex-col gap-5">
      <div role="radiogroup" aria-label="Agent" className="-mx-1 flex gap-1.5 overflow-x-auto rounded-2xl border border-line bg-white/[0.02] p-1.5">
        {AGENTS.map((a) => {
          const on = agent === a.key;
          return (
            <button
              key={a.key}
              role="radio"
              aria-checked={on}
              onClick={() => setAgent(a.key)}
              className={cn(
                "flex shrink-0 items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm transition-colors duration-200",
                on ? "bg-white/[0.08] text-text" : "text-muted hover:text-text",
              )}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: a.color, opacity: on ? 1 : 0.5 }} />
              {AGENT_LABELS[a.key]}
            </button>
          );
        })}
      </div>

      <div className={cn("flex flex-wrap items-center gap-2", !AGENT_META[agent].repo && "hidden")}>
        <label className="relative flex min-w-0 flex-1 items-center">
          <GitBranch className="pointer-events-none absolute left-3 h-4 w-4 text-faint" aria-hidden />
          <span className="sr-only">Repository</span>
          <select
            value={selectedRepo}
            onChange={(e) => setRepo(e.target.value)}
            className="w-full appearance-none rounded-xl border border-line bg-white/[0.02] py-2.5 pl-9 pr-3 text-sm outline-none transition-colors focus:border-line-hi"
          >
            {repos.length === 0 && <option value="">Loading repos…</option>}
            {repos.map((r) => (
              <option key={r.name} value={r.name}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <button
          role="switch"
          aria-checked={tracked}
          disabled={agent === "codex-cloud"}
          onClick={() => setLinear(linear === "1" ? "0" : "1")}
          className={cn(
            "flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm transition-colors disabled:opacity-60",
            tracked ? "border-line-hi bg-white/[0.06] text-text" : "border-line text-muted",
          )}
        >
          <span className={cn("flex h-4 w-4 items-center justify-center rounded-[5px] border", tracked ? "border-transparent bg-text text-bg" : "border-line-hi")}>
            {tracked && <Check className="h-3 w-3" strokeWidth={3} />}
          </span>
          Linear issue
        </button>
      </div>

      <div className="flex flex-col items-center gap-3 py-2">
        <button
          onClick={mic.toggle}
          disabled={busy || (AGENT_META[agent].repo && !selectedRepo)}
          aria-label={mic.recording ? "Stop and send" : "Tap to talk"}
          className="group relative grid h-36 w-36 place-items-center rounded-full disabled:opacity-40"
        >
          <span
            className={cn("absolute inset-0 rounded-full transition-transform duration-500 ease-[var(--ease-out-expo)]", mic.recording ? "scale-110" : "group-hover:scale-105")}
            style={{
              background: `radial-gradient(circle at 35% 30%, color-mix(in oklab, ${color}, white 55%), ${color} 38%, color-mix(in oklab, ${color}, black 65%) 78%)`,
              boxShadow: `0 0 0 1px rgb(255 255 255 / 0.08) inset, 0 20px 60px -10px color-mix(in oklab, ${color}, transparent 30%)`,
            }}
          />
          {mic.recording && <span className="absolute inset-0 animate-ping rounded-full opacity-30" style={{ background: color }} />}
          <span className="relative grid place-items-center text-bg">
            {busy ? <LoaderCircle className="h-8 w-8 animate-spin" /> : mic.recording ? <Square className="h-7 w-7 fill-current" /> : <Mic className="h-9 w-9" />}
          </span>
        </button>
        <p className="tnum text-sm text-muted" aria-live="polite">
          {busy ? "Starting the chat…" : mic.recording ? `Listening · ${mic.seconds}s — tap to send` : `Tap to talk to ${AGENT_LABELS[agent]}`}
        </p>
      </div>

      <div className="flex items-end gap-2 rounded-2xl border border-line bg-white/[0.02] p-2 focus-within:border-line-hi">
        <textarea
          value={text}
          autoFocus={autoFocusText}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && text.trim()) void send();
          }}
          rows={2}
          placeholder={`Or type to ${AGENT_LABELS[agent]}…`}
          className="min-w-0 flex-1 resize-none bg-transparent px-2 py-1.5 text-[15px] outline-none placeholder:text-faint"
        />
        <button
          onClick={() => send()}
          disabled={busy || mic.recording || !text.trim() || (AGENT_META[agent].repo && !selectedRepo)}
          aria-label="Send"
          className="grid h-10 w-10 place-items-center rounded-xl bg-text text-bg transition-opacity disabled:opacity-25"
        >
          <SendHorizontal className="h-4 w-4" />
        </button>
      </div>
      <p className="-mt-2 px-1 text-xs text-faint">{AGENTS.find((a) => a.key === agent)?.hint}{tracked ? " · creates a Linear issue" : ""}</p>

      {(error || mic.error) && <p className="rounded-xl border border-bad/30 bg-bad/5 px-3 py-2 text-sm text-bad">{error || mic.error}</p>}
    </div>
  );
}
