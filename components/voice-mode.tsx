"use client";

import { Keyboard, LoaderCircle, Mic, Play, SendHorizontal, Square, Volume2, VolumeX, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AgentLogo } from "@/components/agent-logo";
import { Core } from "@/components/core";
import { primeVoices, speak, stopSpeaking, unlockAudio, useLevel, useListener, useVoiceState } from "@/components/voice-engine";
import { AGENT_LABELS, type TaskAgent } from "@/lib/agents";
import { confirmsVoiceAction } from "@/lib/voice-confirm";
import { cn } from "@/lib/utils";
import type { VoiceAction, VoiceLang, VoiceTurn } from "@/lib/voice-brain";

// Talk to the Core: tap, speak, it answers out loud. Hands-free keeps the conversation going (it
// listens again after each answer); tap while it talks to cut in. Real work never runs on its own:
// the Core proposes it and you confirm — tap Run, or (hands-free) say "yes" / "go" / "do it".

type Phase = "idle" | "listening" | "thinking" | "speaking" | "confirming";
type Turn = VoiceTurn & { sources?: { title: string; href?: string }[] };


function useStored(key: string, fallback: boolean) {
  const [v, setV] = useState(fallback);
  const ref = useRef(fallback); // what in-flight turns read, so a change takes effect immediately
  useEffect(() => {
    try {
      const s = localStorage.getItem(key);
      if (s !== null) setV((ref.current = s === "1"));
    } catch {}
  }, [key]);
  const set = (x: boolean) => {
    ref.current = x;
    setV(x);
    try {
      localStorage.setItem(key, x ? "1" : "0");
    } catch {}
  };
  return [v, set, ref] as const;
}

function describe(a: VoiceAction): { agent?: TaskAgent; title: string; detail: string } {
  if (a.type === "start_chat") return { agent: a.agent, title: `Start ${AGENT_LABELS[a.agent]}${a.repo ? ` · ${a.repo.split("/")[1]}` : ""}`, detail: a.task };
  if (a.type === "reply") return { title: `Message ${a.jobId}`, detail: a.text };
  return { title: "Open", detail: a.href };
}

export function VoiceMode({ onDone }: { onDone?: () => void }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [action, setAction] = useState<VoiceAction | null>(null);
  const [note, setNote] = useState("");
  const [typed, setTyped] = useState("");
  const [typing, setTyping] = useState(false);
  const [handsFree, setHandsFree, handsFreeRef] = useStored("ad.handsfree", true);
  const [voiceOn, setVoiceOn, voiceOnRef] = useStored("ad.voiceReplies", true);
  const mic = useListener();
  const voice = useVoiceState();
  const lvl = useLevel(phase === "listening" || phase === "confirming" || phase === "speaking");
  // Each turn has a number; anything that resolves for an older turn is dropped (cut-ins, closing).
  const gen = useRef(0);
  const turnsRef = useRef<Turn[]>([]);
  turnsRef.current = turns;
  const micRef = useRef(mic);
  micRef.current = mic;
  // The language of the current conversation, so the short "cancelled" line stays in it.
  const langRef = useRef<VoiceLang>("en");

  useEffect(() => {
    gen.current++;
    // Wake the voice on the VPS so the first answer isn't slow (it only loads if it's needed), and
    // read the device's voice list now so an Albanian answer doesn't wait on it.
    void fetch("/api/tts", { cache: "no-store" }).catch(() => {});
    primeVoices();
    return () => {
      gen.current++;
      stopSpeaking();
      micRef.current.cancel();
    };
  }, []);

  // A new turn: whatever was happening (speaking, listening, a proposed action) stops now.
  function begin(): number {
    gen.current++;
    stopSpeaking();
    micRef.current.cancel();
    setAction(null);
    setNote("");
    return gen.current;
  }

  async function say(text: string, g: number, lang: VoiceLang = "en", sayEn?: string) {
    if (g !== gen.current) return false;
    if (!voiceOnRef.current) return true;
    setPhase("speaking");
    return speak(text, "core", "core", { lang, fallbackText: sayEn });
  }

  async function ask(input: { audio?: Blob; text?: string }, g: number) {
    setPhase("thinking");
    const form = new FormData();
    if (input.audio) form.set("audio", input.audio, input.audio.type.includes("mp4") ? "note.mp4" : "note.webm");
    if (input.text) form.set("text", input.text);
    form.set("history", JSON.stringify(turnsRef.current.slice(-8).map(({ role, text }) => ({ role, text }))));
    const res = await fetch("/api/voice", { method: "POST", body: form }).catch(() => null);
    const body = (await res?.json().catch(() => null)) as {
      heard?: string;
      say?: string;
      lang?: VoiceLang;
      sayEn?: string;
      action?: VoiceAction;
      sources?: Turn["sources"];
      error?: string;
    } | null;
    if (g !== gen.current) return;
    if (!res?.ok || !body) {
      setPhase("idle");
      return setNote(body?.error ?? "Couldn't reach the Core — check the connection.");
    }
    const next: Turn[] = [...turnsRef.current];
    if (body.heard) next.push({ role: "you", text: body.heard });
    if (body.say) next.push({ role: "core", text: body.say, sources: body.sources });
    setTurns(next.slice(-12));
    if (body.action) setAction(body.action); // shown (and announced) while the Core says it
    langRef.current = body.lang ?? langRef.current;
    if (body.say) {
      const ask = body.lang === "sq" ? "Ta nis?" : "Shall I go ahead?";
      const spoken = await say(body.action ? `${body.say} ${ask}` : body.say, g, body.lang, body.action && body.sayEn ? `${body.sayEn} Shall I go ahead?` : body.sayEn);
      if (!spoken) {
        if (g === gen.current) setPhase("idle");
        return; // Leave the reply visible; do not listen again after failed playback.
      }
    }
    if (g !== gen.current) return;
    setPhase("idle");
    if (body.action) {
      if (handsFreeRef.current) void confirmByVoice(body.action, g);
      return;
    }
    if (handsFreeRef.current && body.heard) void listen(g);
  }

  async function listen(g = begin()) {
    setPhase("listening");
    const blob = await micRef.current.listen();
    if (g !== gen.current) return;
    if (!blob) return setPhase("idle");
    await ask({ audio: blob }, g);
  }

  // Hands-free confirmation: a short "yes" runs it, anything else cancels.
  async function confirmByVoice(a: VoiceAction, g: number) {
    setPhase("confirming");
    const blob = await micRef.current.listen();
    if (g !== gen.current) return;
    if (!blob) return setPhase("idle"); // silence: leave the card up for a tap
    setPhase("thinking");
    const form = new FormData();
    form.set("audio", blob, blob.type.includes("mp4") ? "note.mp4" : "note.webm");
    form.set("confirm", "1");
    const body = (await fetch("/api/voice", { method: "POST", body: form })
      .then((r) => r.json())
      .catch(() => null)) as { heard?: string } | null;
    if (g !== gen.current) return;
    const heard = (body?.heard ?? "").toLowerCase().replace(/[^\p{L}\s]/gu, "").trim();
    setTurns((t) => [...t, { role: "you" as const, text: body?.heard || "…" }].slice(-12));
    if (confirmsVoiceAction(heard)) return void run(a);
    setAction(null);
    await say(langRef.current === "sq" ? "Në rregull, e anulova." : "Okay, cancelled.", g, langRef.current);
    if (g === gen.current) setPhase("idle");
  }

  function tap() {
    unlockAudio();
    if (phase === "listening" || phase === "confirming") return mic.finish();
    if (phase === "thinking") return;
    void listen(); // also cuts in while it's speaking
  }

  async function run(a: VoiceAction) {
    const g = begin();
    if (a.type === "open") {
      onDone?.();
      return router.push(a.href);
    }
    setPhase("thinking");
    if (a.type === "reply") {
      const res = await fetch(`/api/jobs/${a.jobId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "reply", prompt: a.text }) }).catch(() => null);
      if (g !== gen.current) return;
      setPhase("idle");
      return setNote(res?.ok ? `Sent to ${a.jobId}.` : "That message didn't go through.");
    }
    const form = new FormData();
    form.set("agent", a.agent);
    form.set("repo", a.repo ?? "");
    form.set("linear", a.agent === "codex-cloud" ? "1" : "0");
    form.set("text", a.task);
    const res = await fetch("/api/tasks", { method: "POST", body: form }).catch(() => null);
    const body = await res?.json().catch(() => null);
    if (g !== gen.current) return;
    setPhase("idle");
    if (!res?.ok || !body?.href) return setNote(body?.error ?? "Couldn't start that chat.");
    onDone?.();
    router.push(body.href);
  }

  const speakingNow = voice.speaking === "core";
  const hearing = phase === "listening" || phase === "confirming";
  const energy = hearing ? 0.55 + lvl * 0.45 : phase === "thinking" ? 0.85 : speakingNow ? 0.5 + lvl * 0.5 : 0.3;
  const label =
    phase === "confirming"
      ? "Say yes to run it — anything else cancels"
      : phase === "listening"
        ? mic.listening
          ? "Listening — stop talking to send, or tap"
          : "Opening the mic…"
        : phase === "thinking"
          ? "Thinking"
          : speakingNow
            ? "Speaking — tap to cut in"
            : action
              ? "Run it, or cancel"
              : "Tap to talk";
  const last = turns.at(-1);
  const act = action ? describe(action) : null;

  return (
    <div className="flex flex-col items-center gap-5">
      {/* The Core: listens, thinks, speaks — its energy follows the actual sound. */}
      <button
        onClick={tap}
        disabled={phase === "thinking"}
        aria-label={hearing ? "Send" : speakingNow ? "Cut in and talk" : "Tap to talk"}
        className="voice-core group relative grid aspect-square w-[min(62vw,240px)] place-items-center overflow-hidden rounded-[30%] bg-black transition-transform duration-300 ease-[var(--ease-out-expo)] active:scale-[0.97]"
        data-phase={hearing ? "listening" : phase}
        style={{ ["--lvl" as string]: lvl.toFixed(3) }}
      >
        <Core className="absolute inset-0 h-full w-full" density={1} energy={energy} tints={hearing ? ["#ffffff"] : []} label="Core" />
        <span className="relative grid h-14 w-14 place-items-center rounded-[18px] bg-black/55 text-white backdrop-blur-sm" aria-hidden>
          {phase === "thinking" ? <LoaderCircle className="h-6 w-6 animate-spin" /> : hearing ? <Square className="h-5 w-5 fill-current" /> : <Mic className="h-6 w-6" />}
        </span>
      </button>

      <div className="min-h-[3.25rem] w-full text-center" aria-live="polite">
        <p className="hud-label">{label}</p>
        {last && (
          <p key={turns.length} className={cn("msg-in mx-auto mt-2 max-w-[34ch] text-[15px] leading-snug text-balance", last.role === "you" ? "text-muted" : "text-text")}>
            {last.text}
          </p>
        )}
        {(note || mic.error || voice.error) && <p className="mt-2 text-xs text-bad">{note || mic.error || `Voice: ${voice.error}`}</p>}
      </div>

      {act && action && (
        <div role="alert" className="msg-in panel w-full px-4 py-3">
          <div className="flex items-start gap-3">
            {act.agent ? <AgentLogo agent={act.agent} size="sm" /> : <Play className="mt-1 h-4 w-4 text-hud" aria-hidden />}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{act.title}</p>
              <p className="line-clamp-2 text-xs text-muted">{act.detail}</p>
            </div>
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <button
              onClick={() => {
                begin();
                setPhase("idle");
              }}
              className="flex h-9 items-center gap-1.5 rounded-[10px] px-3 text-xs text-muted hover:bg-white/5 hover:text-text"
            >
              <X className="h-3.5 w-3.5" aria-hidden /> Cancel
            </button>
            <button onClick={() => void run(action)} className="h-9 rounded-[10px] bg-text px-4 text-xs font-medium text-bg">
              Run
            </button>
          </div>
        </div>
      )}

      {turns.length > 1 && (
        <ol className="flex max-h-40 w-full flex-col gap-2 overflow-y-auto border-t border-line pt-3 text-[13px] [overscroll-behavior:contain]" aria-label="Conversation">
          {turns.slice(0, -1).map((t, i) => (
            <li key={i} className={cn("flex gap-2", t.role === "you" ? "text-muted" : "text-text/85")}>
              <span className="hud-label w-9 shrink-0 pt-0.5 !text-[9px]">{t.role === "you" ? "You" : "Core"}</span>
              <span className="min-w-0">{t.text}</span>
            </li>
          ))}
        </ol>
      )}

      {typing && (
        <form
          className="flex w-full items-center gap-2 rounded-[18px] border border-line bg-white/[0.02] p-1.5 focus-within:border-line-hi"
          onSubmit={(e) => {
            e.preventDefault();
            if (!typed.trim() || phase === "thinking") return;
            unlockAudio();
            const t = typed.trim();
            setTyped("");
            void ask({ text: t }, begin());
          }}
        >
          <input value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus aria-label="Ask the Core" placeholder="Ask the Core…" className="bare-field min-w-0 flex-1 bg-transparent px-2 text-[15px] outline-none placeholder:text-faint" />
          <button type="submit" aria-label="Send" disabled={!typed.trim() || phase === "thinking"} className="grid h-10 w-10 place-items-center rounded-[12px] bg-text text-bg disabled:opacity-25">
            <SendHorizontal className="h-4 w-4" />
          </button>
        </form>
      )}

      <div className="flex w-full items-center justify-between gap-2 text-xs">
        <button
          role="switch"
          aria-checked={handsFree}
          onClick={() => setHandsFree(!handsFree)}
          className={cn("flex h-9 items-center gap-2 rounded-[10px] border px-3 transition-colors", handsFree ? "border-line-hi text-text" : "border-line text-muted")}
        >
          <span className={cn("h-2 w-2 rounded-full transition-colors", handsFree ? "bg-hud shadow-[0_0_8px_var(--color-hud)]" : "bg-white/20")} aria-hidden />
          Hands-free
        </button>
        <div className="flex gap-1">
          <button onClick={() => setTyping(!typing)} aria-pressed={typing} aria-label="Type instead" className={cn("grid h-9 w-9 place-items-center rounded-[10px] transition-colors hover:bg-white/5", typing ? "text-text" : "text-muted")}>
            <Keyboard className="h-4 w-4" />
          </button>
          <button
            onClick={() => {
              if (voiceOn) stopSpeaking();
              setVoiceOn(!voiceOn);
            }}
            aria-pressed={voiceOn}
            aria-label={voiceOn ? "Mute spoken answers" : "Speak answers"}
            className="grid h-9 w-9 place-items-center rounded-[10px] text-muted transition-colors hover:bg-white/5 hover:text-text"
          >
            {voiceOn ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}
