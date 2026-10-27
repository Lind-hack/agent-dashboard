"use client";

import { Check, GitBranch, LoaderCircle, Mic, SendHorizontal, Square } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AgentLogo } from "@/components/agent-logo";
import { Core } from "@/components/core";
import { SkillChips, SkillMenu, useSkillPicker, type SkillInfo } from "@/components/skill-picker";
import { audioFilename, useRecorder } from "@/components/use-recorder";
import { AGENT_HEX, AGENT_LABELS, AGENT_META, type AgentKey, type TaskAgent } from "@/lib/agents";
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
  // Skills run in VPS chats; a Linear issue is drafted from the words instead.
  const box = useRef<HTMLTextAreaElement>(null);
  const picker = useSkillPicker(tracked ? undefined : (agent as AgentKey), box);
  const apply = (s: SkillInfo) => {
    const caret = box.current?.selectionStart ?? text.length;
    const next = picker.pick(s, text, caret);
    setText(next.text);
  };

  async function send(audio?: Blob) {
    setBusy(true);
    setError("");
    const form = new FormData();
    form.set("agent", agent);
    form.set("repo", selectedRepo);
    form.set("linear", tracked ? "1" : "0");
    form.set("text", text);
    form.set("skills", picker.chips.join(","));
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
      <div role="radiogroup" aria-label="Agent" className="-mx-1 flex gap-1.5 overflow-x-auto rounded-[16px] border border-line bg-white/[0.02] p-1.5">
        {AGENTS.map((a) => {
          const on = agent === a.key;
          return (
            <button
              key={a.key}
              role="radio"
              aria-checked={on}
              onClick={() => setAgent(a.key)}
              className={cn(
                "flex shrink-0 items-center justify-center gap-2 rounded-[12px] px-3 py-2 text-sm transition-colors duration-200",
                on ? "bg-white/[0.08] text-text" : "text-muted hover:text-text",
              )}
            >
              <AgentLogo agent={a.key} size="xs" state={on ? "ready" : "idle"} />
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
          className="group relative grid h-36 w-36 place-items-center overflow-hidden rounded-[36px] bg-black shadow-[0_0_0_1px_rgb(169_228_245/0.25)_inset] transition-transform duration-300 ease-[var(--ease-out-expo)] hover:scale-[1.03] active:scale-[0.97] disabled:opacity-40"
          style={{ boxShadow: `0 0 0 1px rgb(169 228 245 / 0.25) inset, 0 20px 50px -18px ${AGENT_HEX[agent]}` }}
        >
          <Core className="absolute inset-0 h-full w-full" density={0.8} energy={mic.recording ? 1 : 0.45} tints={[AGENT_HEX[agent]]} />
          <span className="relative grid place-items-center text-white drop-shadow-[0_0_8px_rgb(0_0_0)]">
            {busy ? <LoaderCircle className="h-8 w-8 animate-spin" /> : mic.recording ? <Square className="h-7 w-7 fill-current" /> : <Mic className="h-9 w-9" />}
          </span>
        </button>
        <p className="tnum text-sm text-muted" aria-live="polite">
          {busy ? "Starting the chat…" : mic.recording ? `Listening · ${mic.seconds}s — tap to send` : `Tap to talk to ${AGENT_LABELS[agent]}`}
        </p>
      </div>

      <div className="relative">
      <SkillMenu picker={picker} onPick={apply} id="composer-skills" />
      <div className="rounded-[18px] border border-line bg-white/[0.02] p-2 focus-within:border-line-hi">
        <SkillChips picker={picker} />
        <div className="flex items-end gap-2">
        <textarea
          ref={box}
          value={text}
          autoFocus={autoFocusText}
          onChange={(e) => {
            setText(e.target.value);
            picker.onText(e.target.value, e.target.selectionStart ?? e.target.value.length);
          }}
          onKeyDown={(e) => {
            if (picker.onKey(e, apply)) return;
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && (text.trim() || picker.chips.length)) void send();
          }}
          onBlur={() => picker.onText("", 0)}
          rows={2}
          aria-label="Message"
          role={tracked ? undefined : "combobox"}
          aria-autocomplete={tracked ? undefined : "list"}
          aria-expanded={tracked ? undefined : picker.open}
          aria-controls={!tracked && picker.open ? "composer-skills" : undefined}
          aria-activedescendant={!tracked && picker.open && picker.matches.length ? `composer-skills-${picker.active}` : undefined}
          placeholder={tracked ? `Or type to ${AGENT_LABELS[agent]}…` : `Or type to ${AGENT_LABELS[agent]} — / for skills`}
          className="min-w-0 flex-1 resize-none bg-transparent px-2 py-1.5 text-[15px] outline-none placeholder:text-faint"
        />
        <button
          onClick={() => send()}
          disabled={busy || mic.recording || (!text.trim() && !picker.chips.length) || (AGENT_META[agent].repo && !selectedRepo)}
          aria-label="Send"
          className="grid h-10 w-10 place-items-center rounded-[12px] bg-text text-bg transition-opacity disabled:opacity-25"
        >
          <SendHorizontal className="h-4 w-4" />
        </button>
        </div>
      </div>
      </div>
      <p className="-mt-2 px-1 text-xs text-faint">{AGENTS.find((a) => a.key === agent)?.hint}{tracked ? " · creates a Linear issue" : ""}</p>

      {(error || mic.error) && <p className="rounded-xl border border-bad/30 bg-bad/5 px-3 py-2 text-sm text-bad">{error || mic.error}</p>}
    </div>
  );
}
