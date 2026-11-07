"use client";

import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { useState } from "react";
import { ProfileForm } from "@/components/account-settings";
import { KeyCard, useKeys, type ProviderId } from "@/components/ai-keys";
import { PushSwitch } from "@/components/coach";
import { Panel } from "@/components/kit";
import { cn } from "@/lib/utils";

// First-run guide: one step on screen at a time, each one skippable except the free AI key, which is what
// makes everything else work. Progress lives on the server, so it picks up on another device.

type Step = { id: string; title: string; lead: string };
const STEPS: Step[] = [
  { id: "ai", title: "Turn on your AI", lead: "Your dashboard thinks with your own AI key. Google's Gemini is free and takes two minutes." },
  { id: "more", title: "Add more AI (optional)", lead: "Already pay for Claude or ChatGPT? Their API keys plug in here. Groq is free and makes voice typing faster." },
  { id: "you", title: "Your day", lead: "Plans, reminders and the day's start follow your time zone." },
  { id: "push", title: "Reminders on your phone", lead: "Your coach nudges you when a block starts and checks in at night. Turn on notifications on the device you carry." },
  { id: "done", title: "You're set", lead: "Start with Goals: tell the mentor where you are now and what you want. Today plans around it." },
];

const KEY_OF: Record<ProviderId, string> = { gemini: "GEMINI_API_KEY", groq: "GROQ_API_KEY", anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY", openrouter: "OPENROUTER_API_KEY" };

export function SetupGuide({ name, tz }: { name: string; tz: string }) {
  const [i, setI] = useState(0);
  const { s, reload } = useKeys();
  const step = STEPS[i];
  const hasAny = !!s && (Object.keys(KEY_OF) as ProviderId[]).some((p) => s.keys[KEY_OF[p]]);
  const blocked = step.id === "ai" && !hasAny;

  async function finish() {
    await fetch("/api/me", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ setupDone: true }) }).catch(() => null);
    window.location.href = "/goals";
  }

  return (
    <div className="mx-auto max-w-xl">
      <ol className="mb-6 flex gap-1.5" aria-label="Setup progress">
        {STEPS.map((x, k) => (
          <li key={x.id} className="flex-1">
            <button
              onClick={() => (k <= i || hasAny ? setI(k) : undefined)}
              aria-label={`Step ${k + 1}: ${x.title}`}
              aria-current={k === i ? "step" : undefined}
              className={cn("block h-1.5 w-full rounded-full transition-colors", k < i ? "bg-hud/70" : k === i ? "bg-text" : "bg-white/10")}
            />
          </li>
        ))}
      </ol>
      <p className="hud-label">
        Step {i + 1} of {STEPS.length}
      </p>
      <h1 className="mt-1 text-[1.75rem] leading-tight font-semibold tracking-[-0.03em] text-balance">{step.title}</h1>
      <p className="mt-2 text-[15px] text-muted text-pretty">{step.lead}</p>

      <div className="mt-6">
        {!s ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : step.id === "ai" ? (
          <KeyCard id="gemini" hint={s.keys.GEMINI_API_KEY ?? null} onChange={reload} open />
        ) : step.id === "more" ? (
          <div className="flex flex-col gap-2">
            {(["groq", "anthropic", "openai", "openrouter"] as ProviderId[]).map((p) => (
              <KeyCard key={p} id={p} hint={s.keys[KEY_OF[p]] ?? null} onChange={reload} />
            ))}
            <p className="px-1 pt-1 text-xs text-faint">
              A Claude Pro or ChatGPT Plus plan can&apos;t be connected: those only work in Anthropic&apos;s and OpenAI&apos;s own apps. API keys are billed per use and are usually cents a day here.
            </p>
          </div>
        ) : step.id === "you" ? (
          <ProfileForm name={name} tz={tz} onSaved={() => setI(i + 1)} />
        ) : step.id === "push" ? (
          <Panel className="!rounded-[14px] px-4 py-4">
            <PushSwitch />
            <p className="mt-3 text-xs text-faint">On iPhone: Share → Add to Home Screen, open the dashboard from there, then turn this on.</p>
          </Panel>
        ) : (
          <Panel className="flex flex-col gap-2 !rounded-[14px] px-4 py-4 text-sm text-muted">
            {[
              ["Goals", "Tell the mentor where you are now; it plans each goal with you before giving orders."],
              ["Today", "Say or type your day. It builds the plan and keeps you to it."],
              ["Buddy", "Talk through your day. It becomes your journal and memory."],
              ["Learning", "Add videos, PDFs and articles to study. Every Sunday you blurt what you remember."],
            ].map(([t, d]) => (
              <p key={t} className="flex gap-3">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-ok" aria-hidden />
                <span>
                  <span className="text-text">{t}.</span> {d}
                </span>
              </p>
            ))}
          </Panel>
        )}
      </div>

      <div className="mt-8 flex items-center gap-3">
        {i > 0 && (
          <button onClick={() => setI(i - 1)} className="flex h-11 items-center gap-2 rounded-[12px] px-3 text-sm text-muted hover:bg-white/5 hover:text-text">
            <ArrowLeft className="h-4 w-4" aria-hidden /> Back
          </button>
        )}
        <span className="flex-1" />
        {blocked && <span className="text-xs text-faint">Add the key to continue</span>}
        {step.id === "done" ? (
          <button onClick={finish} className="flex h-11 items-center gap-2 rounded-[12px] bg-text px-5 text-sm font-medium text-bg">
            Go to Goals <ArrowRight className="h-4 w-4" aria-hidden />
          </button>
        ) : (
          <button disabled={blocked} onClick={() => setI(i + 1)} className="flex h-11 items-center gap-2 rounded-[12px] bg-text px-5 text-sm font-medium text-bg disabled:opacity-30">
            {step.id === "more" || step.id === "push" ? "Next" : "Continue"} <ArrowRight className="h-4 w-4" aria-hidden />
          </button>
        )}
      </div>
    </div>
  );
}
