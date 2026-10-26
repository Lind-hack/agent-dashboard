"use client";

import { Check, GitBranch, LoaderCircle, Mic, SendHorizontal, Square, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AgentLogo } from "@/components/agent-logo";
import { audioFilename, useRecorder } from "@/components/use-recorder";
import { AGENT_LABELS, AGENT_META, type AgentKey } from "@/lib/agents";
import { cn } from "@/lib/utils";

// The Room: pick a mode and the agents for one task.
//   Solo  — one agent, a normal chat.
//   Team  — several agents on the same task side by side, or a plan → build → review relay.
//   Roast — they debate, a neutral judge scores each round, and you get a verdict.

export type LauncherAgent = { agent: AgentKey; ready: boolean; busy: boolean; note: string; model: string; weeklyPct: number | null };
type Mode = "solo" | "team" | "roast";

const MODES: { key: Mode; label: string; hint: string }[] = [
  { key: "solo", label: "Solo", hint: "One agent, a back-and-forth chat on its own branch." },
  { key: "team", label: "Team", hint: "Several agents on the same task — answers side by side, or a relay that plans, builds and reviews." },
  { key: "roast", label: "Roast", hint: "They argue until they agree. A neutral judge scores every round; you get each model's reasoning and a verdict." },
];

const SUGGESTIONS: Record<Mode, string[]> = {
  solo: ["What's broken on the VPS right now, and why?", "Review the newest open PR — real problems only."],
  team: ["Plan the next 383 feature that would grow daily readers.", "Find the slowest page on 383ks.com and fix it."],
  roast: ["Should 383's news pipeline move off Hermes to the runner?", "What's the single highest-leverage thing to build this week for my goals?"],
};

export function RoomLauncher({ agents, repos, judgeModel }: { agents: LauncherAgent[]; repos: string[]; judgeModel: string }) {
  const router = useRouter();
  const byKey = useMemo(() => Object.fromEntries(agents.map((a) => [a.agent, a])) as Record<AgentKey, LauncherAgent>, [agents]);
  const claudeHot = (byKey.claude?.weeklyPct ?? 0) > 70;
  const [mode, setMode] = useState<Mode>("roast");
  const [teamKind, setTeamKind] = useState<"ask" | "relay">("ask");
  const [picked, setPicked] = useState<AgentKey[]>(() => agents.filter((a) => a.ready && !(a.agent === "claude" && claudeHot)).map((a) => a.agent));
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

  function tap(a: AgentKey) {
    setError("");
    if (!byKey[a]?.ready) return setError(`${AGENT_LABELS[a]} isn't set up: ${byKey[a]?.note}`);
    if (mode === "solo") return setPicked([a]);
    setPicked((p) => (p.includes(a) ? p.filter((x) => x !== a) : [...p, a]));
  }

  const chosen = mode === "solo" ? picked.slice(0, 1) : picked;
  const sharedModel = mode === "roast" ? chosen.find((a, i) => chosen.some((b, j) => j > i && byKey[a]?.model === byKey[b]?.model)) : undefined;
  const calls = chosen.length * 3 + 4;
  const valid = text.trim() && (mode === "solo" ? chosen.length === 1 : mode === "team" && teamKind === "relay" ? true : chosen.length >= 2 && chosen.length <= 4);

  async function start(audio?: Blob) {
    setBusy(true);
    setError("");
    const form = new FormData();
    form.set("text", text);
    form.set("repo", repo);
    if (audio) form.set("audio", audio, audioFilename(audio));
    try {
      localStorage.setItem("ad.repo", repo);
    } catch {}
    let url = "/api/tasks";
    if (mode === "roast") {
      url = "/api/rooms";
      form.set("agents", chosen.join(","));
    } else if (mode === "solo") {
      form.set("mode", "single");
      form.set("agent", chosen[0] ?? "claude");
    } else {
      form.set("mode", teamKind);
      form.set("agents", teamKind === "relay" ? "" : chosen.join(","));
    }
    const res = await fetch(url, { method: "POST", body: form }).catch(() => null);
    const body = await res?.json().catch(() => null);
    if (!res?.ok) {
      setBusy(false);
      return setError(body?.error ?? "Couldn't reach the dashboard — try again.");
    }
    router.push(body.href);
  }
  const mic = useRecorder((audio) => void start(audio));

  return (
    <div className="flex flex-col gap-5">
      <div role="tablist" aria-label="Mode" className="grid grid-cols-3 gap-1 rounded-[14px] border border-line bg-white/[0.02] p-1 sm:self-start">
        {MODES.map((m) => (
          <button
            key={m.key}
            role="tab"
            aria-selected={mode === m.key}
            onClick={() => {
              setMode(m.key);
              setError("");
              if (m.key === "solo") setPicked((p) => p.slice(0, 1));
            }}
            className={cn("min-h-10 rounded-[10px] px-5 text-sm font-medium transition-colors", mode === m.key ? "bg-text text-bg" : "text-muted hover:text-text")}
          >
            {m.label}
          </button>
        ))}
      </div>
      <p className="-mt-2 px-1 text-sm text-muted">{MODES.find((m) => m.key === mode)?.hint}</p>

      {mode === "team" && (
        <div className="flex gap-2">
          {(["ask", "relay"] as const).map((k) => (
            <button
              key={k}
              onClick={() => setTeamKind(k)}
              aria-pressed={teamKind === k}
              className={cn("min-h-9 rounded-[10px] border px-3 text-xs", teamKind === k ? "border-line-hi bg-white/[0.06] text-text" : "border-line text-muted hover:text-text")}
            >
              {k === "ask" ? "Side by side" : "Relay · Claude plans, Codex builds, Claude reviews"}
            </button>
          ))}
        </div>
      )}

      {!(mode === "team" && teamKind === "relay") && (
        <section className="panel brackets p-3 sm:p-4" aria-label="Agents">
          <div className="mb-3 flex items-center justify-between px-1">
            <p className="hud-label">{mode === "solo" ? "Pick one agent" : `Pick ${mode === "roast" ? "2–4 debaters" : "2–4 agents"}`}</p>
            <p className="hud-label tnum">{chosen.length} selected</p>
          </div>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            {agents.map((a) => {
              const on = chosen.includes(a.agent);
              return (
                <button
                  key={a.agent}
                  onClick={() => tap(a.agent)}
                  aria-pressed={on}
                  className={cn(
                    "relative flex min-h-[132px] flex-col items-start gap-3 rounded-[14px] border p-3 text-left transition-all duration-200",
                    on ? "border-transparent bg-white/[0.05]" : "border-line bg-black/20 hover:bg-white/[0.03]",
                    !a.ready && "opacity-50",
                  )}
                  style={on ? { boxShadow: `0 0 0 1px ${AGENT_META[a.agent].color} inset, 0 12px 30px -18px ${AGENT_META[a.agent].color}` } : undefined}
                >
                  <AgentLogo agent={a.agent} size="lg" state={!a.ready ? "off" : a.busy ? "working" : on ? "ready" : "idle"} />
                  <span className="min-w-0">
                    <span className="block text-[15px] font-medium">{AGENT_LABELS[a.agent]}</span>
                    <span className="block truncate font-mono text-[10.5px] text-faint" title={a.model}>
                      {a.model}
                    </span>
                    <span className={cn("mt-1 block text-xs", a.ready ? "text-muted" : "text-warn")}>
                      {!a.ready ? "not set up" : a.busy ? "busy · waits its turn" : a.weeklyPct !== null ? `${a.weeklyPct}% of week used` : "free model"}
                    </span>
                  </span>
                  {on && (
                    <span className="absolute top-2.5 right-2.5 grid h-5 w-5 place-items-center rounded-md bg-text text-bg">
                      <Check className="h-3.5 w-3.5" strokeWidth={3} />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          {mode === "roast" && (
            <div className="mt-3 flex flex-col gap-1.5 border-t border-line px-1 pt-3 text-xs text-muted">
              <p>
                Judge: <span className="font-mono text-text/80">{judgeModel}</span> — not one of the debaters.
              </p>
              <p>
                Up to 3 rounds · at most <span className="tnum">{calls}</span> model calls · debaters can read the evidence but can&apos;t run tools or change anything.
              </p>
              {claudeHot && !chosen.includes("claude") && <p className="text-faint">Claude is off by default: {byKey.claude?.weeklyPct}% of its week is used.</p>}
              {sharedModel && (
                <p className="flex items-center gap-1.5 text-warn">
                  <TriangleAlert className="h-3.5 w-3.5" /> Two debaters run the same model ({byKey[sharedModel]?.model}) — expect them to agree too easily.
                </p>
              )}
            </div>
          )}
        </section>
      )}

      <label className="relative flex items-center">
        <GitBranch className="pointer-events-none absolute left-3 h-4 w-4 text-faint" aria-hidden />
        <span className="sr-only">Repository</span>
        <select
          value={repo}
          onChange={(e) => setRepo(e.target.value)}
          className="min-h-11 w-full appearance-none rounded-[12px] border border-line bg-white/[0.02] py-2.5 pr-3 pl-9 text-sm outline-none focus:border-line-hi"
        >
          {mode === "roast" && <option value="">No repo — argue from the task alone</option>}
          {repos.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </label>

      <div className="panel flex items-end gap-1.5 !rounded-[20px] p-1.5">
        <button
          onClick={mic.toggle}
          disabled={busy || (!mic.recording && mode !== "solo" && !(mode === "team" && teamKind === "relay") && chosen.length < 2)}
          aria-label={mic.recording ? "Stop and send" : "Talk"}
          className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-[14px]", mic.recording ? "bg-bad/20 text-bad" : "text-muted hover:bg-white/5 hover:text-text")}
        >
          {mic.recording ? <Square className="h-4 w-4 fill-current" /> : <Mic className="h-5 w-5" strokeWidth={1.75} />}
        </button>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={1}
          placeholder={mic.recording ? `Listening · ${mic.seconds}s — tap to send` : mode === "roast" ? "What should they debate?" : "What should they work on?"}
          className="max-h-48 min-h-11 min-w-0 flex-1 resize-none bg-transparent py-2.5 text-[15px] outline-none [field-sizing:content] placeholder:text-faint"
        />
        <button
          onClick={() => start()}
          disabled={busy || mic.recording || !valid}
          aria-label={mode === "roast" ? "Start the debate" : "Send"}
          className="flex h-11 shrink-0 items-center gap-2 rounded-[14px] bg-text px-4 text-sm font-medium text-bg disabled:opacity-20"
        >
          {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <SendHorizontal className="h-4 w-4" />}
          <span className="hidden sm:inline">{mode === "roast" ? "Start debate" : "Send"}</span>
        </button>
      </div>

      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {SUGGESTIONS[mode].map((s) => (
          <button key={s} onClick={() => setText(s)} className="min-h-9 shrink-0 rounded-[10px] border border-line px-3.5 text-xs text-muted hover:border-line-hi hover:text-text">
            {s}
          </button>
        ))}
      </div>

      {(error || mic.error) && <p className="rounded-[12px] border border-bad/30 bg-bad/5 px-3 py-2 text-sm text-bad">{error || mic.error}</p>}
    </div>
  );
}
