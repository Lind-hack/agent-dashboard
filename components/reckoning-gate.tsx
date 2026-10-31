"use client";

import { LoaderCircle, Mic, Square } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { MirrorRow } from "@/lib/accountability";
import type { Reckoning } from "@/lib/reckoning";
import { fmtMin, VERDICT_TONE, VERDICT_WORDS } from "@/lib/verdict";
import { cn } from "@/lib/utils";
import { FaceBackdrop } from "./face-backdrop";
import { audioFilename, useRecorder } from "./use-recorder";

// The reckoning (v5.2, Lind's pick: blocking). When a day is over and he hasn't answered for it, the
// app opens on this: the verdict, said vs did, every miss — and the question. Nothing else opens until
// he answers (voice or text). Then the coach answers back, and the day is closed.

const dayLabel = (d: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }).format(new Date(`${d}T12:00:00Z`));

export function ReckoningGate() {
  const path = usePathname();
  const router = useRouter();
  const [due, setDue] = useState<Reckoning | null>(null);
  const [rows, setRows] = useState<MirrorRow[]>([]);
  const [face, setFace] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<"" | "hearing" | "judging">("");
  const [err, setErr] = useState("");
  const [closed, setClosed] = useState<Reckoning | null>(null);

  const check = useCallback(async () => {
    const r = await fetch("/api/reckoning", { cache: "no-store" }).catch(() => null);
    const b = r?.ok ? await r.json().catch(() => null) : null;
    // Anything wrong on the way: no gate — never lock him out of his own app.
    setDue(b?.due ?? null);
    setRows(b?.rows ?? []);
    setFace(!!b?.face);
  }, []);

  useEffect(() => {
    if (path === "/login") return;
    void check();
    const onVis = () => document.visibilityState === "visible" && void check();
    document.addEventListener("visibilitychange", onVis);
    const t = setInterval(() => void check(), 5 * 60_000);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      clearInterval(t);
    };
  }, [path, check]);

  const mic = useRecorder(async (audio) => {
    setBusy("hearing");
    setErr("");
    try {
      const form = new FormData();
      form.append("audio", audio, audioFilename(audio));
      const r = await fetch("/api/transcribe", { method: "POST", body: form });
      const out = await r.json().catch(() => null);
      if (!r.ok) throw new Error(out?.error ?? "Couldn't hear that — say it again or type it.");
      const said = String(out?.text ?? "").trim();
      if (said) setText((x) => (x ? `${x} ${said}` : said));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  });

  async function submit() {
    if (!due) return;
    setBusy("judging");
    setErr("");
    try {
      const r = await fetch("/api/reckoning", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ day: due.day, answer: text }) });
      const out = await r.json().catch(() => null);
      if (!r.ok) throw new Error(out?.error ?? `error ${r.status}`);
      setClosed(out.reckoning);
      setText("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  if (path === "/login" || !due) return null;
  const r = closed ?? due;
  const failures = rows.filter((x) => x.verdict === "missed" || x.verdict === "not-started" || x.verdict === "unfinished" || x.verdict === "late");

  return (
    <div role="dialog" aria-modal="true" aria-label={`The mirror: ${dayLabel(r.day)}`} className="fixed inset-0 z-[100] overflow-y-auto bg-black text-white">
      <FaceBackdrop face={face} className="fixed" />
      <div className="relative mx-auto flex min-h-dvh max-w-2xl flex-col px-6 pt-[max(2.5rem,env(safe-area-inset-top))] pb-[max(2rem,env(safe-area-inset-bottom))]">
        <p className="font-mono text-[11px] tracking-[0.22em] text-white/55 uppercase">The mirror · {dayLabel(r.day)}</p>
        <h1 className={cn("mt-5 text-[clamp(3rem,13vw,6.5rem)] leading-[0.88] font-black tracking-[-0.05em] uppercase", VERDICT_TONE[r.verdict])}>{VERDICT_WORDS[r.verdict]}</h1>
        {r.verdict === "no-plan" ? (
          <p className="mt-6 text-[clamp(1.25rem,4.5vw,1.7rem)] leading-snug font-semibold">You didn&apos;t plan a single block. There&apos;s nothing to measure — that&apos;s the point.</p>
        ) : (
          <p className="tnum mt-6 text-[clamp(1.25rem,4.5vw,1.75rem)] leading-snug font-semibold">
            You said <span className="text-white">{fmtMin(r.saidMin)}</span>. You did <span className={VERDICT_TONE[r.verdict]}>{fmtMin(r.didMin)}</span>.
          </p>
        )}
        <p className="tnum mt-2 font-mono text-[13px] text-white/60">
          {r.done}/{r.blocks} blocks done · {r.missed} missed · {r.onTimeRate}% on time · streak {r.streak}
        </p>

        {failures.length > 0 && !closed && (
          <ul className="mt-7 flex flex-col border-t border-white/10">
            {failures.slice(0, 8).map((x) => (
              <li key={x.id} className="flex items-baseline gap-3 border-b border-white/10 py-2.5 text-[15px]">
                <span className="tnum w-24 shrink-0 font-mono text-[12px] text-white/45">
                  {x.start}–{x.end}
                </span>
                <span className="min-w-0 flex-1 truncate">{x.title}</span>
                <span className={cn("shrink-0 text-[12.5px] uppercase", x.verdict === "late" ? "text-warn" : "text-bad")}>{x.verdict === "late" ? `late +${x.lateMin}m` : x.verdict === "not-started" ? "missed" : x.verdict}</span>
              </li>
            ))}
          </ul>
        )}

        {closed ? (
          <div className="mt-10 flex flex-1 flex-col">
            <p className="font-mono text-[11px] tracking-[0.18em] text-white/45 uppercase">You said</p>
            <p className="mt-2 text-[15px] leading-relaxed text-white/75">“{closed.answer}”</p>
            {closed.reply && <p className="mt-6 text-[clamp(1.15rem,4vw,1.45rem)] leading-snug font-semibold">{closed.reply}</p>}
            <button
              onClick={() => {
                setDue(null);
                setClosed(null);
                router.refresh();
                void check();
              }}
              className="press mt-auto h-14 w-full rounded-[16px] bg-white text-[16px] font-semibold text-black"
            >
              Close the day
            </button>
          </div>
        ) : (
          <div className="mt-auto pt-10">
            <label htmlFor="reckon" className="block text-[clamp(1.15rem,4vw,1.4rem)] leading-snug font-semibold">
              Did you do enough? What happened — and what&apos;s the excuse?
            </label>
            <div className="mt-4 flex items-end gap-2 rounded-[18px] border border-white/15 bg-black/55 p-2 backdrop-blur">
              <textarea
                id="reckon"
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={3}
                placeholder={mic.recording ? `Listening… ${mic.seconds}s` : busy === "hearing" ? "Hearing you…" : "Be honest. Nobody else reads this."}
                className="min-h-[84px] min-w-0 flex-1 resize-none bg-transparent px-2 py-1.5 text-[16px] leading-relaxed text-white placeholder:text-white/35 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => void mic.toggle()}
                disabled={busy === "judging"}
                aria-label={mic.recording ? "Stop" : "Say it"}
                className={cn("press grid h-12 w-12 shrink-0 place-items-center rounded-[14px]", mic.recording ? "bg-bad text-white" : "bg-white/10 text-white hover:bg-white/20")}
              >
                {busy === "hearing" ? <LoaderCircle className="h-5 w-5 animate-spin" /> : mic.recording ? <Square className="h-4 w-4" fill="currentColor" /> : <Mic className="h-5 w-5" />}
              </button>
            </div>
            {(err || mic.error) && <p className="mt-2 text-[13px] text-bad">{err || mic.error}</p>}
            <button
              onClick={() => void submit()}
              disabled={busy !== "" || text.trim().length < 15}
              className="press mt-3 flex h-14 w-full items-center justify-center gap-2 rounded-[16px] bg-white text-[16px] font-semibold text-black disabled:opacity-35"
            >
              {busy === "judging" ? <LoaderCircle className="h-5 w-5 animate-spin" /> : null} Answer for it
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
