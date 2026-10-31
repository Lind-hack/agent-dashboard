import Link from "next/link";
import { FaceBackdrop } from "@/components/face-backdrop";
import { FaceUpload } from "@/components/face-upload";
import { MirrorCard, PushCard } from "@/components/mirror";
import { keptStreak, mirror, staleGoals } from "@/lib/accountability";
import { addDays } from "@/lib/calendar";
import { coachNow } from "@/lib/coach";
import { faceSet } from "@/lib/face";
import { readPush } from "@/lib/goggins";
import { readReckoning, snapshot, wall } from "@/lib/reckoning";
import { fmtMin, VERDICT_TONE, VERDICT_WORDS, type DayVerdict } from "@/lib/verdict";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

// The Mirror (v5.2): today so far against what he said, the morning push, the wall of days — every
// day kept or softened — and any day opened to read its verdict and what he answered for it.

const CELL: Record<DayVerdict, string> = { enough: "bg-ok", "not-enough": "bg-warn", soft: "bg-bad", "no-plan": "bg-bad/45", pending: "bg-white/[0.05]" };
const label = (d: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", ...o }).format(new Date(`${d}T12:00:00Z`));

export default async function MirrorPage({ searchParams }: { searchParams: Promise<{ day?: string }> }) {
  const today = coachNow().day;
  const asked = (await searchParams)?.day;
  const pick = asked && /^\d{4}-\d{2}-\d{2}$/.test(asked) && asked <= today ? asked : addDays(today, -1);
  const face = faceSet();
  const now = snapshot(today);
  const days = wall(56);
  const counted = days.filter((d) => d.verdict && d.day !== today);
  const enough = counted.filter((d) => d.verdict === "enough").length;
  const picked = readReckoning(pick) ?? snapshot(pick, pick === today ? Date.now() : Number.MAX_SAFE_INTEGER);
  const streak = keptStreak(today);

  return (
    <div className="mx-auto max-w-3xl">
      <section aria-label="Today so far" className="relative isolate overflow-hidden rounded-[var(--radius-panel)] border border-white/10 text-white">
        <FaceBackdrop face={face} />
        <div className="relative flex min-h-[420px] flex-col px-6 pt-6 pb-6 sm:min-h-[480px] sm:px-8">
          <div className="flex items-start justify-between gap-3">
            <p className="font-mono text-[11px] tracking-[0.22em] text-white/55 uppercase">The mirror · so far today</p>
            <FaceUpload set={face} />
          </div>
          <div className="mt-auto">
            <h1 className={cn("text-[clamp(2.75rem,11vw,5.5rem)] leading-[0.88] font-black tracking-[-0.05em] uppercase", VERDICT_TONE[now.verdict])}>{VERDICT_WORDS[now.verdict]}</h1>
            {now.verdict !== "no-plan" && now.verdict !== "pending" && (
              <p className="tnum mt-5 text-[clamp(1.2rem,4.2vw,1.6rem)] leading-snug font-semibold">
                You said {fmtMin(now.saidMin)}. So far you did <span className={VERDICT_TONE[now.verdict]}>{fmtMin(now.didMin)}</span>.
              </p>
            )}
            <p className="tnum mt-2 font-mono text-[13px] text-white/60">
              {now.done}/{now.blocks} done · {now.missed} missed · {now.onTimeRate}% on time · streak {streak.days}
              {streak.todayAlive ? "" : " · broken today"}
            </p>
          </div>
        </div>
      </section>

      <PushCard push={readPush(today)} face={face} />

      <MirrorCard m={mirror(today)} streak={streak} idle={staleGoals(today)} />

      <section aria-labelledby="wall" className="panel mt-6 overflow-hidden">
        <div className="flex items-end justify-between gap-3 border-b border-line px-4 py-3">
          <span>
            <h2 id="wall" className="text-[15px] font-medium">
              The wall
            </h2>
            <span className="block text-[11.5px] text-faint">Eight weeks. Every day you showed up — and every day you didn&apos;t.</span>
          </span>
          <span className="tnum shrink-0 font-mono text-[12px] text-muted">
            {enough}/{counted.length} enough
          </span>
        </div>
        {/* Eight columns of weeks, oldest first: a glance tells how many days were given away. */}
        <div className="grid grid-flow-col grid-cols-8 grid-rows-7 gap-1.5 p-4 sm:max-w-md sm:gap-2">
          {days.map((d) => (
            <Link
              key={d.day}
              href={`/mirror?day=${d.day}#verdict`}
              title={`${label(d.day, { weekday: "short", day: "numeric", month: "short" })}: ${d.verdict ? VERDICT_WORDS[d.verdict] : "—"}${d.answered ? " (answered)" : ""}`}
              aria-label={`${label(d.day, { weekday: "long", day: "numeric", month: "long" })}: ${d.verdict ? VERDICT_WORDS[d.verdict] : "no record"}`}
              className={cn(
                "relative aspect-square rounded-[6px] transition-transform hover:scale-110",
                d.verdict ? CELL[d.verdict] : "bg-white/[0.05]",
                d.day === pick && "ring-2 ring-white ring-offset-2 ring-offset-bg",
                d.day === today && !d.verdict && "border border-dashed border-white/30",
              )}
            >
              {d.answered && <span className="absolute right-1 bottom-1 h-1.5 w-1.5 rounded-full bg-black/60" />}
            </Link>
          ))}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-line px-4 py-2.5 text-[11.5px] text-faint">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-[3px] bg-ok" /> enough
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-[3px] bg-warn" /> not enough
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-[3px] bg-bad" /> softened
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-[3px] bg-bad/45" /> no plan
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-white/50" /> answered for
          </span>
        </div>
      </section>

      <section id="verdict" aria-label={`The verdict for ${pick}`} className="panel mt-6 mb-10 scroll-mt-20 overflow-hidden">
        <div className="border-b border-line px-4 py-3">
          <p className="font-mono text-[10.5px] tracking-[0.12em] text-faint uppercase">{label(pick, { weekday: "long", day: "numeric", month: "long" })}</p>
          <p className={cn("mt-1 text-[26px] leading-none font-black tracking-[-0.03em] uppercase", VERDICT_TONE[picked.verdict])}>{VERDICT_WORDS[picked.verdict]}</p>
          {picked.verdict !== "no-plan" && (
            <p className="tnum mt-2 text-[13px] text-muted">
              Said {fmtMin(picked.saidMin)} · did {fmtMin(picked.didMin)} · {picked.done}/{picked.blocks} done · {picked.missed} missed · {picked.onTimeRate}% on time
            </p>
          )}
        </div>
        <div className="px-4 py-3.5 text-[14.5px] leading-relaxed">
          {picked.answer ? (
            <>
              <p className="text-muted">“{picked.answer}”</p>
              {picked.reply && <p className="mt-3 font-medium">{picked.reply}</p>}
            </>
          ) : (
            <p className="text-faint">{pick === today ? "The day isn't over yet." : "You never answered for this day."}</p>
          )}
        </div>
      </section>
    </div>
  );
}
