"use client";

import { GitBranch, LoaderCircle, Mic, SendHorizontal, Square } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AgentLogo } from "@/components/agent-logo";
import { audioFilename, useRecorder } from "@/components/use-recorder";
import { AGENT_LABELS, AGENT_META, RELAY_STEPS, type AgentKey } from "@/lib/agents";
import { cn } from "@/lib/utils";

type Mode = "single" | "ask" | "relay";
type Status = { agent: AgentKey; ready: boolean; note: string; busy: boolean };

const MODES: { key: Mode; label: string; hint: string }[] = [
  { key: "single", label: "Ask one", hint: "One agent, a back-and-forth chat." },
  { key: "ask", label: "Ask all", hint: "Same question to every agent you light up — answers side by side." },
  { key: "relay", label: "Relay", hint: "Plan → build → review, handed between agents on one branch." },
];

const SUGGESTIONS = [
  "What's broken on the VPS right now, and why?",
  "Review the newest open PR and list real problems only.",
  "Plan the next 383 feature that would grow daily readers.",
];

// Positions on the constellation arc (percent of the stage), one per agent.
const SPOTS: Record<AgentKey, { x: number; y: number }> = {
  claude: { x: 22, y: 62 },
  codex: { x: 40, y: 30 },
  opencode: { x: 60, y: 30 },
  hermes: { x: 78, y: 62 },
};

function Node({ s, on, onTap, label }: { s: Status; on: boolean; onTap: () => void; label?: string }) {
  return (
    <button
      onClick={onTap}
      aria-pressed={on}
      aria-label={`${AGENT_LABELS[s.agent]}${s.ready ? "" : " (not set up)"}`}
      className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-2"
      style={{ left: `${SPOTS[s.agent].x}%`, top: `${SPOTS[s.agent].y}%` }}
    >
      <span className={cn("relative transition-all duration-500 ease-[var(--ease-out-expo)]", on ? "scale-100 opacity-100" : "scale-90 opacity-45")}>
        <AgentLogo agent={s.agent} size="xl" state={!s.ready ? "off" : s.busy ? "working" : on ? "ready" : "idle"} />
        {label && <span className="absolute -top-1.5 -right-1.5 rounded-md bg-text px-1.5 py-0.5 font-mono text-[10px] font-semibold text-bg">{label}</span>}
      </span>
      <span className={cn("text-xs font-medium sm:text-sm", on ? "text-text" : "text-muted")}>{AGENT_LABELS[s.agent]}</span>
    </button>
  );
}

export function AgentsConsole({ statuses, repos }: { statuses: Status[]; repos: string[] }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("ask");
  const [selected, setSelected] = useState<AgentKey[]>(["claude", "codex"]);
  const [relay, setRelay] = useState<AgentKey[]>(["claude", "codex", "claude"]);
  const [repo, setRepo] = useState(repos[0] ?? "");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    try {
      const r = localStorage.getItem("ad.repo");
      if (r && repos.includes(r)) setRepo(r);
    } catch {}
  }, [repos]);

  // In "Ask one" the last tapped agent is the one; relay taps fill the steps in order.
  function tap(a: AgentKey) {
    setError("");
    if (mode === "single") return setSelected([a]);
    if (mode === "ask") return setSelected((s) => (s.includes(a) ? s.filter((x) => x !== a) : [...s, a]));
    if (a === "hermes") return setError("Hermes works in its own container, so it can't take a relay step on a repo.");
    setRelay((r) => [...r.slice(1), a]);
  }

  const lit = (a: AgentKey) => (mode === "relay" ? relay.includes(a) : selected.includes(a));
  const relayLabel = (a: AgentKey) =>
    mode === "relay"
      ? relay
          .map((x, i) => (x === a ? String(i + 1) : ""))
          .filter(Boolean)
          .join("·")
      : undefined;
  const needsRepo = mode === "relay" || (mode === "single" ? AGENT_META[selected[0] ?? "claude"].repo : selected.some((a) => AGENT_META[a].repo));

  async function send(audio?: Blob) {
    setBusy(true);
    setError("");
    const form = new FormData();
    form.set("mode", mode);
    form.set("repo", repo);
    form.set("text", text);
    if (mode === "single") form.set("agent", selected[0] ?? "claude");
    else form.set("agents", (mode === "relay" ? relay : selected).join(","));
    if (audio) form.set("audio", audio, audioFilename(audio));
    const res = await fetch("/api/tasks", { method: "POST", body: form }).catch(() => null);
    const body = await res?.json().catch(() => null);
    if (!res?.ok) {
      setBusy(false);
      return setError(body?.error ?? "Couldn't reach the dashboard — try again.");
    }
    router.push(body.href);
  }
  const mic = useRecorder((audio) => void send(audio));

  return (
    <div className="flex flex-col gap-5">
      <div role="tablist" aria-label="Mode" className="flex gap-1 self-start rounded-full border border-line bg-white/[0.02] p-1">
        {MODES.map((m) => (
          <button
            key={m.key}
            role="tab"
            aria-selected={mode === m.key}
            onClick={() => {
              setMode(m.key);
              setError("");
              if (m.key === "single") setSelected((s) => [s[0] ?? "claude"]);
            }}
            className={cn("rounded-full px-4 py-1.5 text-sm transition-colors", mode === m.key ? "bg-white text-bg" : "text-muted hover:text-text")}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div className="panel relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_70%_at_50%_45%,rgb(179_146_240/0.10),transparent_70%)]" />
        <div className="relative mx-auto aspect-[16/9] w-full max-w-xl sm:aspect-[2/1]">
          <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
            {(mode === "relay" ? relay.slice(0, -1).map((a, i) => [a, relay[i + 1]] as const) : selected.flatMap((a, i) => selected.slice(i + 1).map((b) => [a, b] as const))).map(
              ([a, b], i) => (
                <line
                  key={`${a}-${b}-${i}`}
                  x1={SPOTS[a].x}
                  y1={SPOTS[a].y}
                  x2={SPOTS[b].x}
                  y2={SPOTS[b].y}
                  stroke="url(#wire)"
                  strokeWidth="1.5"
                  vectorEffect="non-scaling-stroke"
                />
              ),
            )}
            <defs>
              <linearGradient id="wire" x1="0" x2="1">
                <stop offset="0" stopColor="#e2825f" stopOpacity="0.7" />
                <stop offset="1" stopColor="#7c98ff" stopOpacity="0.7" />
              </linearGradient>
            </defs>
          </svg>
          {statuses.map((s) => (
            <Node key={s.agent} s={s} on={lit(s.agent)} onTap={() => tap(s.agent)} label={relayLabel(s.agent)} />
          ))}
        </div>
        <p className="relative px-5 pb-4 text-center text-xs text-muted">
          {mode === "relay"
            ? relay.map((a, i) => `${RELAY_STEPS[i]}: ${AGENT_LABELS[a]}`).join("  →  ")
            : MODES.find((m) => m.key === mode)?.hint}
        </p>
      </div>

      {needsRepo && (
        <label className="relative flex items-center">
          <GitBranch className="pointer-events-none absolute left-3 h-4 w-4 text-faint" aria-hidden />
          <span className="sr-only">Repository</span>
          <select
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
            className="w-full appearance-none rounded-xl border border-line bg-white/[0.02] py-2.5 pl-9 pr-3 text-sm outline-none focus:border-line-hi"
          >
            {repos.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="panel flex items-end gap-1.5 rounded-[26px] p-1.5">
        <button
          onClick={mic.toggle}
          disabled={busy}
          aria-label={mic.recording ? "Stop and send" : "Talk"}
          className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-full", mic.recording ? "bg-bad/20 text-bad" : "text-muted hover:bg-white/5 hover:text-text")}
        >
          {mic.recording ? <Square className="h-4 w-4 fill-current" /> : <Mic className="h-5 w-5" strokeWidth={1.75} />}
        </button>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={1}
          placeholder={mic.recording ? `Listening · ${mic.seconds}s — tap to send` : mode === "relay" ? "What should they build?" : "Ask your agents…"}
          className="max-h-40 min-h-11 min-w-0 flex-1 resize-none bg-transparent py-2.5 text-[15px] outline-none [field-sizing:content] placeholder:text-faint"
        />
        <button
          onClick={() => send()}
          disabled={busy || mic.recording || !text.trim()}
          aria-label="Send"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-text text-bg disabled:opacity-20"
        >
          {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <SendHorizontal className="h-4 w-4" />}
        </button>
      </div>

      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {SUGGESTIONS.map((s) => (
          <button key={s} onClick={() => setText(s)} className="shrink-0 rounded-full border border-line px-3.5 py-1.5 text-xs text-muted hover:border-line-hi hover:text-text">
            {s}
          </button>
        ))}
      </div>

      {(error || mic.error) && <p className="rounded-xl border border-bad/30 bg-bad/5 px-3 py-2 text-sm text-bad">{error || mic.error}</p>}
    </div>
  );
}
