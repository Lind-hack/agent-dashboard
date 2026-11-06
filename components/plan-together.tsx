"use client";

import { Check, LoaderCircle, Lock, Mic, RefreshCw, RotateCcw, Square, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { GoalPlan, PlanTalk } from "@/lib/mentor";
import { cn } from "@/lib/utils";
import { audioFilename, useRecorder } from "./use-recorder";

// Planning together (v5.5). The card that says where Lind really is, in his words, and the talk that
// turns a goal into a plan: the mentor's read, its questions, his answer, a draft he corrects by talking,
// then the lock. He answers on his phone, so every box takes his voice.

async function post(body: object) {
  const res = await fetch("/api/mentor", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const out = await res.json().catch(() => null);
  if (!res.ok) throw new Error(out?.error ?? `error ${res.status}`);
  return out;
}

// A box he can type in or talk into. What he says is added to what's there; a recording that fails to
// transcribe is kept for another try.
export function VoiceBox({ value, onChange, label, placeholder, rows = 4, disabled }: { value: string; onChange: (v: string) => void; label: string; placeholder?: string; rows?: number; disabled?: boolean }) {
  const [hearing, setHearing] = useState(false);
  const [err, setErr] = useState("");
  const [unheard, setUnheard] = useState<Blob | null>(null);

  async function hear(audio: Blob) {
    setHearing(true);
    setErr("");
    setUnheard(null);
    try {
      const form = new FormData();
      form.append("audio", audio, audioFilename(audio));
      form.append("mode", "say");
      const r = await fetch("/api/transcribe", { method: "POST", body: form });
      const out = await r.json().catch(() => null);
      if (!r.ok) throw new Error(out?.error ?? "Couldn't hear that.");
      const said = String(out?.text ?? "").trim();
      if (!said) throw new Error("Didn't catch anything. Try again?");
      onChange(value.trim() ? `${value.trim()}\n${said}` : said);
    } catch (e) {
      setUnheard(audio);
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setHearing(false);
    }
  }
  const mic = useRecorder(hear);

  return (
    <div>
      <div className="relative">
        <textarea
          value={mic.recording ? `Listening… ${mic.seconds}s. Tap stop when you're done.` : hearing ? "Hearing you…" : value}
          readOnly={mic.recording || hearing}
          onChange={(e) => onChange(e.target.value)}
          rows={rows}
          aria-label={label}
          placeholder={placeholder}
          className="w-full rounded-[12px] border border-line bg-black/30 py-2.5 pr-[60px] pl-3 text-[15px] leading-relaxed placeholder:text-faint"
        />
        <button
          type="button"
          onClick={() => void mic.toggle()}
          disabled={disabled || hearing}
          aria-label={mic.recording ? "Stop" : `Say it: ${label}`}
          className={cn("press absolute top-2 right-2 grid h-11 w-11 place-items-center rounded-[11px] transition-colors disabled:opacity-50", mic.recording ? "bg-bad text-white" : "bg-hud/15 text-hud hover:bg-hud/25")}
        >
          {hearing ? <LoaderCircle className="h-4 w-4 animate-spin" /> : mic.recording ? <Square className="h-3.5 w-3.5" fill="currentColor" /> : <Mic className="h-4 w-4" />}
        </button>
      </div>
      {(mic.error || err) && <p className="mt-1.5 text-[12.5px] text-bad">{mic.error || err}</p>}
      {unheard && (
        <button type="button" onClick={() => void hear(unheard)} disabled={hearing} className="mt-1.5 flex h-9 items-center gap-1.5 text-[13px] text-muted hover:text-text">
          <RotateCcw className="h-3.5 w-3.5" /> Your recording is safe. Try it again
        </button>
      )}
    </div>
  );
}

export function StageCard({ text, at, today }: { text: string; at?: string; today: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState(!text);
  const [value, setValue] = useState(text);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const age = at ? Math.floor((Date.parse(`${today}T12:00:00Z`) - Date.parse(at)) / 86_400_000) : 0;

  async function save() {
    setBusy(true);
    setError("");
    try {
      await post({ action: "stage", text: value });
      setEditing(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="stage-title" className="panel p-5 sm:p-6">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="stage-title" className="text-[1.25rem] leading-tight font-semibold tracking-[-0.02em]">
          Where you are now
        </h2>
        {!editing && (
          <button onClick={() => setEditing(true)} className="-my-2 flex h-11 shrink-0 items-center px-1 text-[13px] text-muted hover:text-text">
            Update
          </button>
        )}
      </div>
      {editing ? (
        <div className="mt-3 flex flex-col gap-3">
          <p className="max-w-prose text-[14px] text-muted">Tell your mentor what&apos;s real: what&apos;s built, what&apos;s live, what isn&apos;t yet, and the hours you actually have. Today and your goals are planned from this, and it beats anything else it thinks it knows.</p>
          <VoiceBox value={value} onChange={setValue} label="Where you are now" rows={5} disabled={busy} placeholder="383ks.com isn't launched yet. Still building checkout. University until 3pm most days…" />
          {error && <p className="text-[13px] text-bad">{error}</p>}
          <div className="flex gap-2">
            <button onClick={() => void save()} disabled={busy || !value.trim()} className="press flex h-11 items-center gap-2 rounded-[12px] bg-text px-4 text-[14px] font-semibold text-bg disabled:opacity-50">
              {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Save
            </button>
            {text && (
              <button
                onClick={() => {
                  setValue(text);
                  setEditing(false);
                }}
                className="press h-11 rounded-[12px] border border-line px-4 text-[14px] text-muted"
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      ) : (
        <>
          <p className="mt-2 max-w-prose text-[15px] leading-relaxed whitespace-pre-wrap text-text/90">{text}</p>
          {age >= 14 && <p className="mt-2 text-[13px] text-warn">Written {age} days ago. Still true?</p>}
        </>
      )}
    </section>
  );
}

function Draft({ plan }: { plan: GoalPlan }) {
  return (
    <div className="flex flex-col gap-4">
      <p className="tnum text-[1.5rem] leading-tight font-semibold tracking-[-0.03em]">
        {plan.outcome.target.toLocaleString("en")} {plan.outcome.unit}
        <span className="ml-2 text-[14px] font-normal tracking-normal text-muted">by {plan.outcome.by}</span>
      </p>
      {plan.assumes.length > 0 && (
        <div>
          <p className="text-[13px] font-medium">This plan assumes</p>
          <ul className="mt-1.5 flex list-disc flex-col gap-1 pl-4 text-[14px] text-muted">
            {plan.assumes.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </div>
      )}
      {plan.milestones.length > 0 && (
        <div>
          <p className="text-[13px] font-medium">In this order</p>
          <ol className="mt-1.5 flex flex-col gap-1.5">
            {plan.milestones.map((m) => (
              <li key={`${m.by}${m.label}`} className="flex items-baseline gap-2.5 text-[14px]">
                <span className="tnum w-[84px] shrink-0 font-mono text-[11.5px] text-faint">{m.by}</span>
                <span>{m.label}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
      {plan.indicators.length > 0 && (
        <div>
          <p className="text-[13px] font-medium">What you&apos;d count each week</p>
          <ul className="mt-1.5 flex flex-col gap-1 text-[14px] text-muted">
            {plan.indicators.map((i) => (
              <li key={i.key} className="flex items-baseline justify-between gap-3">
                <span>{i.label}</span>
                <span className="tnum shrink-0 font-mono text-[12px]">{i.weekly}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {plan.strategy && <p className="max-w-prose text-[14px] leading-relaxed whitespace-pre-line text-muted">{plan.strategy}</p>}
    </div>
  );
}

export function PlanTalkPanel({ title, talk }: { title: string; talk: PlanTalk }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<"" | "answer" | "lock" | "cancel">("");
  const [error, setError] = useState("");
  const draft = talk.draft;

  async function run(kind: "answer" | "lock" | "cancel", body: object) {
    setBusy(kind);
    setError("");
    try {
      await post({ goalId: talk.goalId, ...body });
      if (kind === "answer") setText("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work.");
    } finally {
      setBusy("");
    }
  }

  return (
    <li className="panel flex flex-col gap-4 p-5 sm:p-6 lg:col-span-2">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-[1.1rem] leading-snug font-semibold tracking-[-0.02em]">{draft ? `Your plan for ${title}` : `Planning ${title}`}</h3>
        <button onClick={() => void run("cancel", { action: "talk-cancel" })} disabled={!!busy} aria-label="Stop planning" className="-m-2 grid h-11 w-11 shrink-0 place-items-center text-faint hover:text-text">
          <X className="h-4 w-4" />
        </button>
      </div>

      {draft ? (
        <details className="group">
          <summary className="flex min-h-11 cursor-pointer list-none items-center text-[13px] text-muted hover:text-text">
            What the mentor read and asked <span className="ml-1 inline-block transition-transform group-open:rotate-90">›</span>
          </summary>
          <p className="max-w-prose text-[14px] leading-relaxed whitespace-pre-line text-muted">{talk.read}</p>
          {talk.said.map((s, i) => (
            <p key={i} className="mt-2 max-w-prose text-[14px] leading-relaxed text-text/85">
              You: {s}
            </p>
          ))}
        </details>
      ) : (
        <>
          <p className="max-w-prose text-[15px] leading-relaxed whitespace-pre-line text-text/90">{talk.read}</p>
          <ul className="flex max-w-prose list-disc flex-col gap-1.5 pl-4 text-[15px] leading-snug font-medium">
            {talk.questions.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
        </>
      )}

      {draft && <Draft plan={draft} />}

      <VoiceBox
        value={text}
        onChange={setText}
        label={draft ? "What's wrong with this plan" : "Your answer"}
        placeholder={draft ? "Anything wrong or missing? Say it and the mentor redoes the plan." : "Talk it through. Answer all of it at once, as long as you like."}
        rows={draft ? 3 : 5}
        disabled={!!busy}
      />
      {error && <p className="text-[13px] text-bad">{error}</p>}

      <div className="flex flex-wrap gap-2">
        {draft && (
          <button onClick={() => void run("lock", { action: "talk-lock" })} disabled={!!busy || !!text.trim()} className="press flex h-11 items-center gap-2 rounded-[12px] bg-text px-4 text-[14px] font-semibold text-bg disabled:opacity-50">
            {busy === "lock" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />} Lock this plan
          </button>
        )}
        <button
          onClick={() => void run("answer", { action: "talk-answer", text })}
          disabled={!!busy || !text.trim()}
          className={cn("press flex h-11 items-center gap-2 rounded-[12px] px-4 text-[14px] disabled:opacity-50", draft ? "border border-line-hi" : "bg-text font-semibold text-bg")}
        >
          {busy === "answer" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          {busy === "answer" ? "Working it out…" : draft ? "Redo the plan" : "Draft the plan"}
        </button>
      </div>
      {draft && <p className="text-[12.5px] text-faint">Your mentor gives daily orders only from a plan you&apos;ve locked.</p>}
    </li>
  );
}
