"use client";

import { ArrowUp, Check, LoaderCircle, Sparkles, Wand2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AssistantAction, Brief, BriefSlot, ChatTurn } from "@/lib/assistant";
import { cn } from "@/lib/utils";
import { Md } from "./md";
import { Orb } from "./orb";

// The Day assistant on Today (v5): Sol's latest briefing (morning plan, midday re-plan, evening review)
// with one-tap actions, and a quick chat that knows the whole day. "Ask Sol" queues a fresh briefing on
// the runner; the panel checks back until it lands.

type State = { day: string; chat: ChatTurn[]; briefs: Record<BriefSlot, Brief | null>; pending: boolean };
type Act = AssistantAction & { label: string };

const SLOT_LABEL: Record<BriefSlot, string> = { morning: "Morning plan", midday: "Midday re-plan", evening: "Evening review" };
const QUICK = ["What should I do right now?", "I'm behind — reshuffle the rest of today", "What can I cut today?", "Break my next task into small steps"];

export function AssistantPanel({ initial, slotNow }: { initial: State; slotNow: BriefSlot }) {
  const router = useRouter();
  const [s, setS] = useState<State>(initial);
  const [slot, setSlot] = useState<BriefSlot>((["evening", "midday", "morning"] as BriefSlot[]).find((k) => initial.briefs[k]) ?? slotNow);
  const [text, setText] = useState("");
  const [thinking, setThinking] = useState(false);
  const [applied, setApplied] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const end = useRef<HTMLDivElement>(null);
  const brief = s.briefs[slot];

  const refresh = useCallback(async () => {
    const r = await fetch("/api/assistant", { cache: "no-store" }).then((x) => (x.ok ? x.json() : null)).catch(() => null);
    if (r) setS({ day: r.day, chat: r.chat, briefs: r.briefs, pending: r.pending });
    return r as State | null;
  }, []);

  // While a Sol briefing is queued, look again every 10 s.
  useEffect(() => {
    if (!s.pending) return;
    const id = setInterval(async () => {
      const r = await refresh();
      if (r && !r.pending) {
        const newest = (["evening", "midday", "morning"] as BriefSlot[]).find((k) => r.briefs[k] && (!s.briefs[k] || r.briefs[k]!.createdAt !== s.briefs[k]!.createdAt));
        if (newest) setSlot(newest);
      }
    }, 10_000);
    return () => clearInterval(id);
  }, [s.pending, s.briefs, refresh]);

  useEffect(() => {
    if (s.chat.length) end.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [s.chat.length]);

  async function send(msg: string) {
    const m = msg.trim();
    if (!m || thinking) return;
    setText("");
    setErr("");
    setThinking(true);
    setS((x) => ({ ...x, chat: [...x.chat, { role: "lind", text: m, at: new Date().toISOString() }] }));
    try {
      const res = await fetch("/api/assistant", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: m }) });
      const r = await res.json().catch(() => null);
      if (!res.ok) throw new Error(r?.error ?? `error ${res.status}`);
      setS((x) => ({ ...x, chat: [...x.chat, r.turn] }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setThinking(false);
    }
  }

  async function apply(key: string, a: Act) {
    setBusy(key);
    setErr("");
    try {
      const res = await fetch("/api/assistant", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ apply: a }) });
      const r = await res.json().catch(() => null);
      if (!res.ok) throw new Error(r?.error ?? `error ${res.status}`);
      if (r.href) {
        router.push(r.href);
        return;
      }
      setApplied((x) => ({ ...x, [key]: r.msg ?? "Done." }));
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  async function askSol() {
    setErr("");
    setS((x) => ({ ...x, pending: true }));
    const res = await fetch("/api/assistant", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ brief: slotNow }) });
    if (!res.ok) {
      setErr("Couldn't reach the assistant.");
      setS((x) => ({ ...x, pending: false }));
    }
  }

  const Actions = ({ list, prefix }: { list: Act[]; prefix: string }) =>
    list.length ? (
      <div className="mt-3 flex flex-wrap gap-1.5">
        {list.map((a, i) => {
          const key = `${prefix}:${i}`;
          return applied[key] ? (
            <span key={key} className="flex h-8 items-center gap-1.5 rounded-full border border-ok/30 bg-ok/10 px-3 text-[12.5px] text-ok">
              <Check className="h-3.5 w-3.5" /> {applied[key]}
            </span>
          ) : (
            <button key={key} onClick={() => apply(key, a)} disabled={!!busy} className="flex h-8 items-center gap-1.5 rounded-full border border-hermes/35 bg-hermes/10 px-3 text-[12.5px] text-text transition-colors hover:bg-hermes/20 disabled:opacity-50">
              {busy === key ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5 text-hermes" />} {a.label}
            </button>
          );
        })}
      </div>
    ) : null;

  return (
    <section id="assistant" className="mt-8 scroll-mt-20">
      <div className="panel brackets relative overflow-hidden">
        <div className="pointer-events-none absolute -top-28 -right-20 h-72 w-72 rounded-full bg-[radial-gradient(circle,rgba(167,139,250,0.22),transparent_70%)] blur-2xl" aria-hidden />
        <div className="relative flex items-center gap-3 border-b border-line px-4 py-3">
          <span className="relative h-9 w-9 shrink-0" aria-hidden>
            <Orb className="h-full w-full" state={thinking || s.pending ? "thinking" : "idle"} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-medium">Day assistant</span>
            <span className="block truncate font-mono text-[10.5px] text-faint">plans with gpt-6.1-sol · chats on a fast model · knows your tasks, plan, calendar and goals</span>
          </span>
          <button onClick={askSol} disabled={s.pending} className="flex h-9 shrink-0 items-center gap-1.5 rounded-[10px] border border-line-hi px-3 text-[13px] text-muted hover:bg-white/5 hover:text-text disabled:opacity-60">
            {s.pending ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 text-hermes" />} {s.pending ? "Sol is thinking…" : "Ask Sol"}
          </button>
        </div>

        <div className="relative px-4 pt-3">
          <div className="flex gap-1 rounded-[11px] bg-white/[0.04] p-1 text-[12.5px]" role="tablist" aria-label="Briefings">
            {(["morning", "midday", "evening"] as BriefSlot[]).map((k) => (
              <button key={k} role="tab" aria-selected={slot === k} onClick={() => setSlot(k)} className={cn("flex-1 rounded-[8px] px-2 py-1.5 transition-colors", slot === k ? "bg-white/[0.09] text-text" : "text-muted hover:text-text", !s.briefs[k] && "opacity-60")}>
                {SLOT_LABEL[k]}
              </button>
            ))}
          </div>
          {brief ? (
            <div key={brief.createdAt} className="rise py-4">
              <p className="text-[1.15rem] leading-snug font-semibold tracking-[-0.02em]">{brief.headline}</p>
              {brief.focus.length > 0 && (
                <ol className="mt-3 flex flex-col gap-1.5">
                  {brief.focus.map((f, i) => (
                    <li key={i} className="flex gap-2.5 text-[14px] leading-snug">
                      <span className="tnum mt-px font-mono text-[11px] text-hermes">{String(i + 1).padStart(2, "0")}</span>
                      <span>{f}</span>
                    </li>
                  ))}
                </ol>
              )}
              <div className="md mt-3 text-[14px] leading-relaxed text-muted">
                <Md text={brief.body} />
              </div>
              <Actions list={brief.actions} prefix={`b:${brief.createdAt}`} />
              <p className="mt-2 font-mono text-[10px] text-faint">
                {brief.model} · {new Date(brief.createdAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
              </p>
            </div>
          ) : (
            <p className="py-4 text-[13.5px] text-muted">
              {SLOT_LABEL[slot]} comes {slot === "morning" ? "at 07:30" : slot === "midday" ? "at 13:00" : "at 21:25"} on its own (and as a push). Tap <span className="text-text">Ask Sol</span> for one now.
            </p>
          )}
        </div>

        <div className="relative border-t border-line">
          {s.chat.length > 0 && (
            <div className="flex max-h-[420px] flex-col gap-3 overflow-y-auto px-4 py-4">
              {s.chat.map((t, i) => (
                <div key={`${t.at}-${i}`} className={cn("max-w-[88%]", t.role === "lind" ? "self-end" : "self-start")}>
                  <div className={cn("rounded-[14px] px-3.5 py-2.5 text-[14px] leading-relaxed", t.role === "lind" ? "bg-white/[0.08]" : "border border-line bg-black/20")}>
                    {t.role === "lind" ? t.text : <Md text={t.text} />}
                  </div>
                  {t.role === "assistant" && t.actions && <Actions list={t.actions} prefix={`c:${t.at}`} />}
                </div>
              ))}
              {thinking && (
                <div className="flex items-center gap-2 self-start text-[13px] text-faint">
                  <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> thinking…
                </div>
              )}
              <div ref={end} />
            </div>
          )}
          {s.chat.length === 0 && (
            <div className="flex flex-wrap gap-1.5 px-4 pt-3">
              {QUICK.map((q) => (
                <button key={q} onClick={() => send(q)} className="h-8 rounded-full border border-line px-3 text-[12.5px] text-muted hover:border-line-hi hover:text-text">
                  {q}
                </button>
              ))}
            </div>
          )}
          {err && <p className="px-4 pt-2 text-xs text-bad">{err}</p>}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(text);
            }}
            className="flex items-end gap-2 p-3"
          >
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(text);
                }
              }}
              rows={1}
              placeholder="Ask about your day — “what's next?”, “move gym to 7”…"
              aria-label="Message the assistant"
              className="max-h-32 min-h-10 flex-1 resize-none rounded-[12px] border border-line bg-black/30 px-3 py-2 text-[14.5px] outline-none [field-sizing:content] focus:border-line-hi"
            />
            <button type="submit" disabled={!text.trim() || thinking} aria-label="Send" className="grid h-10 w-10 shrink-0 place-items-center rounded-[12px] bg-text text-bg disabled:opacity-40">
              <ArrowUp className="h-4 w-4" />
            </button>
          </form>
        </div>
      </div>
    </section>
  );
}
