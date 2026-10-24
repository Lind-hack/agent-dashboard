"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { audioFilename, useRecorder } from "@/components/use-recorder";
import { AGENT_LABELS, type TaskAgent } from "@/lib/agents";
import { cn } from "@/lib/utils";

type Repo = { name: string; base: string; private: boolean };

const AGENTS: { key: TaskAgent; hint: string }[] = [
  { key: "claude", hint: "Claude Code on the VPS — chat back and forth" },
  { key: "codex", hint: "Codex CLI on the VPS — chat back and forth" },
  { key: "codex-cloud", hint: "Codex in OpenAI's cloud — always a Linear issue" },
];

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

export default function NewChatPage() {
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
      .catch(() => setError("Couldn't load repos"));
  }, []);

  // Fall back to the first repo when nothing (or a repo the token lost) is remembered.
  const selectedRepo = repos.some((r) => r.name === repo) ? repo : (repos[0]?.name ?? "");
  const tracked = agent === "codex-cloud" || linear === "1";

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
      return setError(body?.error ?? "Couldn't reach the server");
    }
    if (body?.note) {
      // e.g. Codex for Linear isn't installed: the issue exists but nobody will pick it up.
      setBusy(false);
      return setError(`${body.id}: ${body.note}`);
    }
    router.push(body.href);
  }

  const mic = useRecorder((audio) => void send(audio));

  return (
    <div className="mx-auto flex max-w-md flex-col gap-5">
      <div className="flex flex-col gap-2">
        <div className="grid grid-cols-3 gap-1 rounded-xl border border-line p-1 text-sm">
          {AGENTS.map((a) => (
            <button
              key={a.key}
              onClick={() => setAgent(a.key)}
              className={cn("rounded-lg px-2 py-2", agent === a.key ? "bg-white/10 text-text" : "text-muted")}
            >
              {AGENT_LABELS[a.key]}
            </button>
          ))}
        </div>
        <p className="px-1 text-xs text-muted">{AGENTS.find((a) => a.key === agent)?.hint}</p>

        <select
          value={selectedRepo}
          onChange={(e) => setRepo(e.target.value)}
          className="rounded-xl border border-line bg-panel px-3 py-2.5 text-sm outline-none focus:border-accent"
        >
          {repos.length === 0 && <option value="">Loading repos…</option>}
          {repos.map((r) => (
            <option key={r.name} value={r.name}>
              {r.name}
            </option>
          ))}
        </select>

        <label className={cn("flex items-center justify-between rounded-xl border border-line px-3 py-2.5 text-sm", agent === "codex-cloud" && "opacity-50")}>
          <span>
            Track in Linear
            <span className="block text-xs text-muted">{tracked ? "Creates an issue (counts toward the 250 cap)" : "Plain chat, no issue"}</span>
          </span>
          <input
            type="checkbox"
            checked={tracked}
            disabled={agent === "codex-cloud"}
            onChange={(e) => setLinear(e.target.checked ? "1" : "0")}
            className="h-5 w-5 accent-[var(--color-accent)]"
          />
        </label>
      </div>

      <button
        onClick={mic.toggle}
        disabled={busy || !selectedRepo}
        className={cn(
          "mx-auto mt-2 flex h-40 w-40 flex-col items-center justify-center rounded-full border-2 text-sm font-medium transition",
          mic.recording ? "animate-pulse border-bad bg-bad/15 text-bad" : "border-accent bg-accent/10 text-accent",
          (busy || !selectedRepo) && "opacity-40",
        )}
      >
        {busy ? "Starting…" : mic.recording ? `Stop · ${mic.seconds}s` : "Tap to talk"}
      </button>

      <div className="flex gap-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          placeholder={`…or type to ${AGENT_LABELS[agent]}`}
          className="min-w-0 flex-1 resize-none rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none focus:border-accent"
        />
        <button
          onClick={() => send()}
          disabled={busy || mic.recording || !text.trim() || !selectedRepo}
          className="rounded-lg bg-accent px-4 text-sm font-medium text-bg disabled:opacity-40"
        >
          Send
        </button>
      </div>

      {(error || mic.error) && <p className="text-sm text-bad">{error || mic.error}</p>}
    </div>
  );
}
