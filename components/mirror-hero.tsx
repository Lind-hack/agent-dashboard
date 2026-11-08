import { ArrowRight, Check } from "lucide-react";
import Link from "next/link";
import { keptStreak, mirror } from "@/lib/accountability";
import { addDays } from "@/lib/calendar";
import { tally } from "@/lib/day-tally";
import { clockNow, coachTz } from "@/lib/coach";
import { faceSet } from "@/lib/face";
import { firstDay, readReckoning } from "@/lib/reckoning";
import { VERDICT_TONE, VERDICT_WORDS, type DayVerdict } from "@/lib/verdict";
import { cn } from "@/lib/utils";

// The mirror, full bleed (v5.3, Lind: "more deep and more pain feeling, with the image I added"). His
// chosen image in black and white, pushed slowly closer, washed blood-red when he's softened and amber
// when it's not enough; the verdict, how many of today's things he's done (v5.4: a count, not minutes),
// what he skipped and what's left, whether the streak lives — and last night's excuse, quoted back at
// him. On Home and at the top of the Mirror.

const WASH: Record<DayVerdict, string> = {
  soft: "bg-[#6b0000]",
  "no-plan": "bg-[#5a0000]",
  "not-enough": "bg-[#5c3a00]",
  enough: "bg-[#0b2a1d]",
  pending: "bg-transparent",
};
// Original lines (never his words): what each verdict means, said once, plainly.
const LINE: Record<DayVerdict, string> = {
  soft: "Nobody is coming to do it for you.",
  "no-plan": "You didn't even decide what today was for.",
  "not-enough": "Good isn't the standard you set.",
  enough: "You kept your word. Tomorrow it resets to zero.",
  pending: "The clock is already running.",
};

export function MirrorHero({ day, action, className }: { day: string; action?: React.ReactNode; className?: string }) {
  const s = tally(day);
  const m = mirror(day);
  const streak = keptStreak(day);
  const face = faceSet();
  const lastNight = readReckoning(addDays(day, -1));
  // Skipped first, then what's still open, then what's done.
  const rank = (i: (typeof s.items)[number]) => (i.missed ? 0 : i.done ? 2 : 1);
  const list = [...s.items].sort((a, z) => rank(a) - rank(z));
  const next = m.rows.find((r) => r.verdict === "upcoming");
  // The account's first day with nothing planned yet is a start, not a failure.
  const dayOne = s.verdict === "no-plan" && day === firstDay();
  const hurt = !dayOne && (s.verdict === "soft" || s.verdict === "no-plan");
  const label = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "long" }).format(new Date(`${day}T12:00:00Z`));

  return (
    <section aria-label={`The mirror: ${VERDICT_WORDS[s.verdict]}`} className={cn("relative isolate overflow-hidden rounded-[var(--radius-panel)] border border-white/10 bg-black text-white", className)}>
      {/* The photo owns the top: lit enough to see his face, then masked out into the black under the verdict. */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[400px] overflow-hidden [mask-image:linear-gradient(to_bottom,black_62%,transparent)] sm:h-[480px]">
        {face && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src="/api/mirror/face" alt="" className="pain-drift absolute inset-0 h-full w-full object-cover object-[50%_18%] grayscale brightness-[0.78] contrast-[1.45]" />
        )}
        {/* The wash: the verdict's colour multiplied into the photo. */}
        <div className={cn("absolute inset-0 opacity-80 mix-blend-multiply transition-colors duration-700", WASH[dayOne ? "pending" : s.verdict])} />
        {hurt && <div className="pain-pulse absolute inset-0 bg-[radial-gradient(ellipse_at_50%_40%,transparent_20%,rgb(150_0_0/0.35)_75%)]" />}
        <div className="absolute inset-0 bg-gradient-to-b from-black/35 via-black/10 via-40% to-black" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_30%,transparent_40%,rgb(0_0_0/0.75)_100%)]" />
      </div>
      <div aria-hidden className="grain pointer-events-none absolute -inset-[10%]" />

      <div className="relative flex flex-col px-5 pt-5 pb-6 sm:px-8 sm:pt-7 sm:pb-8">
        <div className="flex items-start justify-between gap-3">
          <p className="font-mono text-[11px] tracking-[0.24em] text-white/55 uppercase">
            The mirror · {label} · {clockNow(coachTz())}
          </p>
          {action}
        </div>

        <div className="mt-[250px] sm:mt-[320px]">
          <h2 className={cn("text-[clamp(3.1rem,15vw,7.25rem)] leading-[0.84] font-black tracking-[-0.055em] uppercase", dayOne ? "text-white" : VERDICT_TONE[s.verdict], hurt && "drop-shadow-[0_0_28px_rgb(220_30_30/0.45)]")}>{dayOne ? "Day one." : VERDICT_WORDS[s.verdict]}</h2>
          <p className="mt-3 text-[15px] font-medium text-white/70 italic">{dayOne ? "Decide what today is for. The mirror starts counting tomorrow." : LINE[s.verdict]}</p>

          {s.total > 0 && (
            <p className="tnum mt-6 text-[clamp(1.3rem,5vw,1.9rem)] leading-tight font-semibold">
              <span className={VERDICT_TONE[s.verdict]}>{s.done}</span> of {s.total} done today.
              {s.left > 0 && s.verdict !== "pending" && <span className={cn("mt-1 block", s.verdict === "soft" ? "text-bad" : "text-white/70")}>{s.left} still undone.</span>}
            </p>
          )}
          {s.verdict === "pending" && next && (
            <p className="tnum mt-3 text-[clamp(1.05rem,4vw,1.35rem)] leading-tight font-semibold text-white/80">
              First block at {next.start}: {next.title}. Be there.
            </p>
          )}

          {list.length > 0 && (
            <ul className="mt-5 flex flex-col gap-1.5">
              {list.slice(0, 8).map((i) => (
                <li key={i.key} className="flex items-center gap-3 text-[15px]">
                  <span className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded-full border", i.done ? "border-ok bg-ok/20 text-ok" : i.missed ? "border-bad/70" : "border-white/30")}>
                    {i.done && <Check className="h-3 w-3" strokeWidth={3} />}
                  </span>
                  <span className={cn("min-w-0 truncate", i.done ? "text-white/45" : i.missed ? "text-white/75 line-through decoration-bad/70 decoration-2" : "text-white/85")}>{i.title}</span>
                  {i.missed ? (
                    <span className="ml-auto shrink-0 font-mono text-[11px] tracking-[0.12em] text-bad uppercase">skipped</span>
                  ) : (
                    i.at && !i.done && <span className="tnum ml-auto shrink-0 font-mono text-[12px] text-white/40">{i.at}</span>
                  )}
                </li>
              ))}
              {list.length > 8 && <li className="pl-8 font-mono text-[11.5px] text-white/40">+{list.length - 8} more</li>}
            </ul>
          )}

          <p className="tnum mt-5 font-mono text-[12.5px] tracking-[0.04em] text-white/60">
            {streak.days === 0 ? (streak.todayAlive ? "Streak: 0. Today is day one — or another zero." : "Streak: dead.") : streak.todayAlive ? `Streak: ${streak.days} days. Don't be the one who ends it.` : `Streak: ${streak.days} days — broken today.`}
          </p>

          {lastNight?.answer && (
            <blockquote className="mt-5 border-l-2 border-bad/70 pl-3 text-[14px] leading-snug text-white/70">
              <span className="font-mono text-[10.5px] tracking-[0.16em] text-white/45 uppercase not-italic">Last night you said</span>
              <span className="mt-1 line-clamp-3 block italic">“{lastNight.answer}”</span>
            </blockquote>
          )}

          <div className="mt-6 flex gap-2">
            <Link href="/mirror" className="press flex h-12 flex-1 items-center justify-center gap-2 rounded-[14px] bg-white text-[15px] font-semibold text-black sm:flex-none sm:px-6">
              Face it <ArrowRight className="h-4 w-4" />
            </Link>
            <Link href="/calendar#plan" className="press flex h-12 items-center justify-center rounded-[14px] border border-white/20 bg-black/40 px-5 text-[15px] text-white/85 backdrop-blur hover:text-white">
              Plan
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
