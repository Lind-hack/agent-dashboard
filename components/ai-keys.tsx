"use client";

import { Check, ExternalLink, LoaderCircle, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Panel, StatusPill } from "@/components/kit";
import { cn } from "@/lib/utils";

// The account's own AI keys: paste, the server checks it with the provider, then saves it encrypted.
// Gemini is the free one everybody starts with; the others are optional upgrades.

export type ProviderId = "gemini" | "groq" | "anthropic" | "openai" | "openrouter";
const KEY_OF: Record<ProviderId, string> = {
  gemini: "GEMINI_API_KEY",
  groq: "GROQ_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
};

export const PROVIDER_INFO: Record<ProviderId, { name: string; cost: string; what: string; url: string; steps: string[] }> = {
  gemini: {
    name: "Google Gemini",
    cost: "Free",
    what: "Runs everything: planning, your coach, voice, reading videos and PDFs.",
    url: "https://aistudio.google.com/apikey",
    steps: ["Open Google AI Studio and sign in with any Google account.", "Press “Create API key”.", "Copy the key and paste it here."],
  },
  groq: {
    name: "Groq",
    cost: "Free",
    what: "Very fast answers and the most accurate voice typing.",
    url: "https://console.groq.com/keys",
    steps: ["Sign in at console.groq.com.", "Open API Keys → “Create API Key”.", "Copy it and paste it here."],
  },
  anthropic: {
    name: "Claude (Anthropic)",
    cost: "Paid, per use",
    what: "Claude's writing and judgement. Uses API credits, not a Claude Pro plan.",
    url: "https://console.anthropic.com/settings/keys",
    steps: ["Sign in at console.anthropic.com and add a little credit under Billing.", "Settings → API keys → “Create key”.", "Copy it and paste it here."],
  },
  openai: {
    name: "ChatGPT (OpenAI)",
    cost: "Paid, per use",
    what: "OpenAI's models and Whisper voice typing. Uses API credits, not a ChatGPT Plus plan.",
    url: "https://platform.openai.com/api-keys",
    steps: ["Sign in at platform.openai.com and add credit under Billing.", "API keys → “Create new secret key”.", "Copy it and paste it here."],
  },
  openrouter: {
    name: "OpenRouter",
    cost: "Free and paid models",
    what: "One key for hundreds of models (Llama, DeepSeek, Mistral and more).",
    url: "https://openrouter.ai/settings/keys",
    steps: ["Sign in at openrouter.ai.", "Settings → Keys → “Create key”.", "Copy it and paste it here."],
  },
};

type KeysState = { owner: boolean; keys: Record<string, string | null>; prefs: { first?: ProviderId } };

export function useKeys() {
  const [s, setS] = useState<KeysState | null>(null);
  const load = () =>
    fetch("/api/me/keys", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => b && setS(b))
      .catch(() => {});
  useEffect(() => {
    void load();
  }, []);
  return { s, setS, reload: load };
}

export function KeyCard({ id, hint, onChange, open: startOpen = false }: { id: ProviderId; hint: string | null; onChange: () => void; open?: boolean }) {
  const info = PROVIDER_INFO[id];
  const [open, setOpen] = useState(startOpen && !hint);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/me/keys", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: id, key }) }).catch(() => null);
    setBusy(false);
    if (!res?.ok) return setError(((await res?.json().catch(() => null)) as { error?: string } | null)?.error ?? "Couldn't save that key.");
    setKey("");
    setOpen(false);
    onChange();
  }

  async function remove() {
    setBusy(true);
    await fetch("/api/me/keys", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: id }) }).catch(() => null);
    setBusy(false);
    onChange();
  }

  return (
    <Panel className="!rounded-[14px] px-4 py-3.5">
      <div className="flex items-center gap-3">
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 text-[15px]">
            {info.name}
            <span className="text-xs text-faint">{info.cost}</span>
          </span>
          <span className="block text-[13px] text-muted">{info.what}</span>
        </span>
        {hint ? (
          <span className="flex items-center gap-1">
            <StatusPill tone="ok">
              <Check className="h-3 w-3" aria-hidden /> <span className="font-mono">{hint}</span>
            </StatusPill>
            <button onClick={remove} disabled={busy} aria-label={`Remove the ${info.name} key`} className="grid h-10 w-10 place-items-center rounded-xl text-faint hover:bg-white/5 hover:text-bad">
              <Trash2 className="h-4 w-4" aria-hidden />
            </button>
          </span>
        ) : (
          !open && (
            <button onClick={() => setOpen(true)} className="h-10 shrink-0 rounded-[11px] border border-line px-3.5 text-sm hover:border-line-hi hover:bg-white/5">
              Add key
            </button>
          )
        )}
      </div>
      {open && !hint && (
        <form onSubmit={save} className="mt-3 border-t border-line pt-3">
          <ol className="mb-3 flex list-decimal flex-col gap-1 pl-5 text-[13px] text-muted">
            {info.steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
          <a href={info.url} target="_blank" rel="noreferrer" className="mb-3 inline-flex items-center gap-1.5 text-sm text-hud underline-offset-4 hover:underline">
            Open {info.name.split(" (")[0]} keys <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          </a>
          <div className="flex gap-2">
            <label className="sr-only" htmlFor={`key-${id}`}>
              {info.name} API key
            </label>
            <input
              id={`key-${id}`}
              name={`key-${id}`}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="Paste the key…"
              autoComplete="off"
              spellCheck={false}
              className="min-w-0 flex-1 rounded-[11px] border border-line bg-black/30 px-3 py-2.5 font-mono text-base outline-none focus-visible:border-hud/60 sm:text-sm"
            />
            <button disabled={busy || !key.trim()} className="flex h-11 shrink-0 items-center gap-2 rounded-[11px] bg-text px-4 text-sm font-medium text-bg disabled:opacity-30">
              {busy && <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />}
              {busy ? "Checking…" : "Save"}
            </button>
          </div>
          <p className={cn("mt-2 min-h-5 text-sm", error ? "text-bad" : "text-faint")} aria-live="polite">
            {error || "We check the key with the provider, then store it encrypted. Only its last 4 characters are ever shown."}
          </p>
        </form>
      )}
    </Panel>
  );
}

export function AiKeys({ only }: { only?: ProviderId[] }) {
  const { s, reload } = useKeys();
  if (!s) return <p className="text-sm text-muted">Loading…</p>;
  if (s.owner) return <p className="text-sm text-muted">Your keys are set in /etc/agent-dashboard.env on the server.</p>;
  const ids = only ?? (Object.keys(PROVIDER_INFO) as ProviderId[]);
  const have = ids.filter((i) => s.keys[KEY_OF[i]]);
  return (
    <div className="flex flex-col gap-2">
      {ids.map((id) => (
        <KeyCard key={id} id={id} hint={s.keys[KEY_OF[id]] ?? null} onChange={reload} open={id === "gemini"} />
      ))}
      {!only && have.length > 1 && <FirstChoice first={s.prefs.first} have={have} onChange={reload} />}
    </div>
  );
}

function FirstChoice({ first, have, onChange }: { first?: ProviderId; have: ProviderId[]; onChange: () => void }) {
  async function pick(p: ProviderId) {
    await fetch("/api/me/keys", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ first: p }) }).catch(() => null);
    onChange();
  }
  return (
    <Panel className="!rounded-[14px] px-4 py-3.5">
      <p className="text-[15px]">Ask first</p>
      <p className="text-[13px] text-muted">The one that answers first. If it's busy or out of quota, the next key takes over.</p>
      <div className="mt-3 flex flex-wrap gap-2" role="radiogroup" aria-label="Which provider answers first">
        {have.map((p) => (
          <button
            key={p}
            role="radio"
            aria-checked={(first ?? have[0]) === p}
            onClick={() => pick(p)}
            className={cn("h-10 rounded-[11px] border px-3.5 text-sm", (first ?? have[0]) === p ? "border-hud/60 bg-hud/10 text-text" : "border-line text-muted hover:text-text")}
          >
            {PROVIDER_INFO[p].name}
          </button>
        ))}
      </div>
    </Panel>
  );
}
