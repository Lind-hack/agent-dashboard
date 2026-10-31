"use client";

import { ArrowUp, Check, LoaderCircle, Mic, NotebookPen, Square, Trash2, Wand2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { AssistantAction } from "@/lib/assistant";
import type { BuddyTurn } from "@/lib/buddy";
import type { JournalDay, JournalEntry } from "@/lib/journal";
import { cn } from "@/lib/utils";
import { Md } from "./md";
import { Orb } from "./orb";
import { audioFilename, useRecorder } from "./use-recorder";

// The Buddy page (v5.1): tonight's journal (type it or say it, with a mood) and one long conversation
// with a Buddy that knows your goals, your days and what you've told it. Its actions (add a task, put
// something on the calendar, draft a reply…) apply with one tap, like the Day assistant's.

const MOODS = [
  { v: 1, label: "Rough", hue: "#f06c6c" },
  { v: 2, label: "Meh", hue: "#f2a65e" },
  { v: 3, label: "Okay", hue: "#c9c3d9" },
  { v: 4, label: "Good", hue: "#7dd3a8" },
  { v: 5, label: "Great", hue: "#5fd3a6" },
];
const QUICK = ["How am I doing on my goals this week?", "What should I focus on tomorrow?", "I'm not motivated today", "Help me plan my week"];
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

async function transcribe(audio: Blob): Promise<string> {
  const form = new FormData();
  form.append("audio", audio, audioFilename(audio));
  const r = await fetch("/api/transcribe", { method: "POST", body: form });
  const out = await r.json().catch(() => null);
  if (!r.ok) throw new Error(out?.error ?? "Couldn't hear that — try again or type it.");
  return String(out?.text ?? "").trim();
}

export function BuddyView({ initialThread, today, week, focusJournal, profileAt }: { initialThread: BuddyTurn[]; today: JournalDay; week: JournalDay[]; focusJournal: boolean; profileAt: string | null }) {
  const [thread, setThread] = useState(initialThread);
  const [thinking, setThinking] = useState(false);
  const [text, setText] = useState("");
  const [err, setErr] = useState("");
  const [applied, setApplied] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const router = useRouter();
  const end = useRef<HTMLDivElement>(null);
  const chatMic = useRecorder(async (audio) => {
    setErr("");
    try {
      const t = await transcribe(audio);
      if (t) await send(t, true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  });

  // Follow new messages — but not on first load, which should open at the top of the page.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    end.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [thread.length]);

  async function send(msg: string, voice = false) {
    const m = msg.trim();
    if (!m || thinking) return;
    setText("");
    setErr("");
    setThinking(true);
    setThread((t) => [...t, { role: "lind", text: m, at: new Date().toISOString(), voice }]);
    try {
      const res = await fetch("/api/buddy", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: m, voice }) });
      const r = await res.json().catch(() => null);
      if (!res.ok) throw new Error(r?.error ?? `error ${res.status}`);
      setThread((t) => [...t, r.turn]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setThinking(false);
    }
  }

  async function apply(key: string, a: AssistantAction & { label: string }) {
    setBusy(key);
    setErr("");
    try {
      const res = await fetch("/api/buddy", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ apply: a }) });
      const r = await res.json().catch(() => null);
      if (!res.ok) throw new Error(r?.error ?? `error ${res.status}`);
      if (r.href) return router.push(r.href);
      setApplied((x) => ({ ...x, [key]: r.msg ?? "Done." }));
      if (r.link) window.open(r.link, "_blank", "noopener");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  const orbState = chatMic.recording ? "listening" : thinking ? "thinking" : "idle";

  return (
    <div className="flex flex-col gap-6">
      <header className="panel brackets relative overflow-hidden px-5 pt-6 pb-5">
        <div className="pointer-events-none absolute -top-24 left-1/2 h-72 w-[36rem] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(167,139,250,0.28),transparent)] blur-2xl" aria-hidden />
        <div className="relative flex flex-wrap items-center gap-5">
          <div className="relative h-24 w-24 shrink-0">
            <Orb className="h-full w-full" state={orbState} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="hud-label">your buddy</p>
            <h1 className="mt-1 text-[1.9rem] leading-none font-semibold tracking-[-0.04em]">Hey Lind.</h1>
            <p className="mt-2 max-w-md text-[14px] leading-relaxed text-muted">
              Talk about your day, your goals and how to actually get there. I read your journal, your plan and your scores
              {profileAt ? ` — my notes on you were last updated ${new Date(profileAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}.` : "."}
            </p>
          </div>
          <WeekMoods week={week} />
        </div>
      </header>

      <Journal initial={today} focus={focusJournal} />

      <section aria-label="Conversation" className="panel relative overflow-hidden">
        <div className="flex max-h-[62vh] min-h-[220px] flex-col gap-3 overflow-y-auto px-4 py-4">
          {thread.length === 0 && <p className="text-[14px] text-muted">Start anywhere — how today went, a goal that's stuck, or what to do next.</p>}
          {thread.map((t, i) => (
            <div key={`${t.at}-${i}`} className={cn("msg-in max-w-[88%]", t.role === "lind" ? "self-end" : "self-start")}>
              <div className={cn("rounded-[16px] px-3.5 py-2.5 text-[14.5px] leading-relaxed", t.role === "lind" ? "rounded-br-md bg-white/[0.08]" : "rounded-bl-md border border-[rgba(167,139,250,0.25)] bg-[rgba(167,139,250,0.06)]")}>
                {t.role === "lind" ? (
                  <span className="whitespace-pre-wrap">
                    {t.voice && <Mic className="mr-1 inline h-3 w-3 text-faint" aria-label="spoken" />}
                    {t.text}
                  </span>
                ) : (
                  <Md text={t.text} />
                )}
              </div>
              {t.role === "buddy" && !!t.actions?.length && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {t.actions.map((a, j) => {
                    const key = `${t.at}:${j}`;
                    return applied[key] ? (
                      <span key={key} className="flex h-8 items-center gap-1.5 rounded-full border border-ok/30 bg-ok/10 px-3 text-[12.5px] text-ok">
                        <Check className="h-3.5 w-3.5" /> {applied[key]}
                      </span>
                    ) : (
                      <button key={key} onClick={() => void apply(key, a)} disabled={!!busy} className="flex h-8 items-center gap-1.5 rounded-full border border-hermes/35 bg-hermes/10 px-3 text-[12.5px] hover:bg-hermes/20 disabled:opacity-50">
                        {busy === key ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5 text-hermes" />} {a.label}
                      </button>
                    );
                  })}
                </div>
              )}
              <p className={cn("mt-1 font-mono text-[10px] text-faint", t.role === "lind" && "text-right")}>{timeOf(t.at)}</p>
            </div>
          ))}
          {thinking && (
            <p className="flex items-center gap-2 self-start text-[13px] text-faint">
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> thinking…
            </p>
          )}
          <div ref={end} />
        </div>
        {thread.length < 4 && (
          <div className="flex flex-wrap gap-1.5 border-t border-line px-4 pt-3">
            {QUICK.map((q) => (
              <button key={q} onClick={() => void send(q)} className="h-8 rounded-full border border-line px-3 text-[12.5px] text-muted hover:border-line-hi hover:text-text">
                {q}
              </button>
            ))}
          </div>
        )}
        {(err || chatMic.error) && <p className="px-4 pt-2 text-xs text-bad">{err || chatMic.error}</p>}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send(text);
          }}
          className="flex items-end gap-2 p-3"
        >
          <button type="button" onClick={() => void chatMic.toggle()} aria-label={chatMic.recording ? "Stop and send" : "Talk to your Buddy"} className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-[12px] border transition-colors", chatMic.recording ? "border-bad/50 bg-bad/15 text-bad" : "border-line text-muted hover:text-text")}>
            {chatMic.recording ? <Square className="h-4 w-4 fill-current" /> : <Mic className="h-4 w-4" />}
          </button>
          <textarea
            value={chatMic.recording ? `Listening… ${chatMic.seconds}s` : text}
            readOnly={chatMic.recording}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(text);
              }
            }}
            rows={1}
            placeholder="Talk to your Buddy…"
            aria-label="Message your Buddy"
            className="max-h-36 min-h-11 flex-1 resize-none rounded-[12px] border border-line bg-black/30 px-3 py-2.5 text-[15px] outline-none [field-sizing:content] focus:border-line-hi"
          />
          <button type="submit" disabled={!text.trim() || thinking || chatMic.recording} aria-label="Send" className="grid h-11 w-11 shrink-0 place-items-center rounded-[12px] bg-text text-bg disabled:opacity-40">
            <ArrowUp className="h-4 w-4" />
          </button>
        </form>
      </section>
    </div>
  );
}

function WeekMoods({ week }: { week: JournalDay[] }) {
  const byDay = new Map(week.map((j) => [j.day, j]));
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(Date.now() - (6 - i) * 86_400_000);
    return new Intl.DateTimeFormat("en-CA").format(d);
  });
  return (
    <div className="flex items-end gap-1.5" aria-label="Journal, last 7 days">
      {days.map((d) => {
        const j = byDay.get(d);
        const moods = (j?.entries ?? []).map((e) => e.mood).filter((m): m is NonNullable<typeof m> => !!m);
        const avg = moods.length ? Math.round(moods.reduce((a, b) => a + b, 0) / moods.length) : 0;
        const color = avg ? MOODS[avg - 1].hue : j ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.08)";
        return (
          <span key={d} className="flex flex-col items-center gap-1" title={j ? `${d}: ${j.entries.length} entr${j.entries.length > 1 ? "ies" : "y"}${avg ? `, ${MOODS[avg - 1].label}` : ""}` : `${d}: nothing written`}>
            <span className="w-2.5 rounded-full" style={{ height: `${12 + (avg || (j ? 2 : 0)) * 6}px`, background: color, boxShadow: avg ? `0 0 10px ${color}` : undefined }} />
            <span className="font-mono text-[9px] text-faint">{new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "narrow", timeZone: "UTC" })}</span>
          </span>
        );
      })}
    </div>
  );
}

function Journal({ initial, focus }: { initial: JournalDay; focus: boolean }) {
  const [day, setDay] = useState(initial);
  const [text, setText] = useState("");
  const [mood, setMood] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [voice, setVoice] = useState(false);
  const [hearing, setHearing] = useState(false);
  const [err, setErr] = useState("");
  const box = useRef<HTMLElement>(null);
  const mic = useRecorder(async (audio) => {
    setHearing(true);
    setErr("");
    try {
      const t = await transcribe(audio);
      if (t) {
        setText((x) => (x ? `${x}\n${t}` : t));
        setVoice(true);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setHearing(false);
    }
  });

  useEffect(() => {
    if (focus) box.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [focus]);

  async function save() {
    if (!text.trim()) return;
    setSaving(true);
    setErr("");
    try {
      const res = await fetch("/api/journal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, mood, source: voice ? "voice" : "text" }) });
      const r = await res.json().catch(() => null);
      if (!res.ok) throw new Error(r?.error ?? `error ${res.status}`);
      setDay(r.today);
      setText("");
      setMood(null);
      setVoice(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function remove(e: JournalEntry) {
    await fetch(`/api/journal?day=${day.day}&id=${e.id}`, { method: "DELETE" }).catch(() => null);
    setDay((d) => ({ ...d, entries: d.entries.filter((x) => x.id !== e.id) }));
  }

  return (
    <section ref={box} id="journal" aria-label="Today's journal" className={cn("panel scroll-mt-20 overflow-hidden", focus && "ring-1 ring-hermes/40")}>
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <NotebookPen className="h-4 w-4 text-hermes" />
        <p className="flex-1 text-[15px] font-medium">Today&apos;s journal</p>
        <span className="font-mono text-[11px] text-faint">{day.entries.length ? `${day.entries.length} entr${day.entries.length > 1 ? "ies" : "y"}` : "nothing yet"}</span>
      </div>
      {day.entries.map((e) => (
        <div key={e.id} className="group flex gap-3 border-b border-line px-4 py-3 text-[14px] leading-relaxed">
          <span className="w-12 shrink-0 font-mono text-[11px] text-faint">
            {timeOf(e.at)}
            {e.mood && <span className="mt-1 block h-1.5 w-6 rounded-full" style={{ background: MOODS[e.mood - 1].hue }} title={MOODS[e.mood - 1].label} />}
          </span>
          <p className="min-w-0 flex-1 whitespace-pre-wrap">{e.text}</p>
          <button onClick={() => void remove(e)} aria-label="Delete entry" className="grid h-8 w-8 shrink-0 place-items-center rounded-[8px] text-faint opacity-0 group-hover:opacity-100 hover:text-bad focus:opacity-100">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      <div className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="How was today?">
          {MOODS.map((m) => (
            <button key={m.v} role="radio" aria-checked={mood === m.v} onClick={() => setMood(mood === m.v ? null : m.v)} className={cn("flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12.5px] transition-colors", mood === m.v ? "border-white/30 bg-white/10 text-text" : "border-line text-muted hover:text-text")}>
              <span className="h-2 w-2 rounded-full" style={{ background: m.hue }} /> {m.label}
            </button>
          ))}
        </div>
        <textarea
          value={mic.recording ? `Listening… ${mic.seconds}s — tap stop when you're done` : text}
          readOnly={mic.recording}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          placeholder="What happened today? What went well, what didn't, what's on your mind…"
          aria-label="Journal entry"
          className="min-h-24 w-full resize-none rounded-[12px] border border-line bg-black/30 px-3 py-2.5 text-[15px] leading-relaxed outline-none [field-sizing:content] focus:border-line-hi"
        />
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => void mic.toggle()} disabled={hearing} className={cn("flex h-10 items-center gap-2 rounded-[11px] border px-4 text-sm", mic.recording ? "border-bad/50 bg-bad/15 text-bad" : "border-line text-muted hover:text-text")}>
            {hearing ? <LoaderCircle className="h-4 w-4 animate-spin" /> : mic.recording ? <Square className="h-4 w-4 fill-current" /> : <Mic className="h-4 w-4" />}
            {hearing ? "Writing it down…" : mic.recording ? "Stop" : "Say it"}
          </button>
          <button onClick={() => void save()} disabled={saving || !text.trim() || mic.recording} className="flex h-10 items-center gap-2 rounded-[11px] bg-text px-5 text-sm font-medium text-bg disabled:opacity-40">
            {saving && <LoaderCircle className="h-4 w-4 animate-spin" />} Save to journal
          </button>
          {(err || mic.error) && <span className="text-xs text-bad">{err || mic.error}</span>}
        </div>
      </div>
    </section>
  );
}
