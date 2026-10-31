import { ArrowRight, CalendarDays, ScanFace } from "lucide-react";
import Link from "next/link";
import { mirror, type Verdict } from "@/lib/accountability";
import type { Today } from "@/lib/planner";
import { snapshot } from "@/lib/reckoning";
import { fmtMin, VERDICT_TONE, VERDICT_WORDS } from "@/lib/verdict";
import { cn } from "@/lib/utils";

// Home (v5.2): the day comes first — the verdict so far, then the plan's blocks and the calendar's
// events in time order, each block judged against the clock. One tap to Today or the Mirror.

const TONE: Record<Verdict, string> = { upcoming: "text-faint", "not-started": "text-bad", "on-time": "text-ok", late: "text-warn", missed: "text-bad", unfinished: "text-bad" };
const WORD: Record<Verdict, string> = { upcoming: "", "not-started": "not started", "on-time": "on time", late: "late", missed: "missed", unfinished: "unfinished" };

export function HomeDay({ day }: { day: Today }) {
  const m = mirror(day.today);
  const s = snapshot(day.today);
  const hm = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: day.tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
  const items = [
    ...m.rows.map((r) => ({ key: r.id, start: r.start, end: r.end, title: r.title, verdict: r.verdict as Verdict | null, running: r.running, lateMin: r.lateMin })),
    ...day.events.filter((e) => !e.allDay && !e.planned).map((e) => ({ key: e.id, start: hm(e.start), end: hm(e.end), title: e.title, verdict: null, running: false, lateMin: undefined })),
  ].sort((a, z) => a.start.localeCompare(z.start));

  return (
    <section aria-label="The day" className="panel overflow-hidden">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 border-b border-line px-4 py-3.5">
        <div className="min-w-0">
          <p className="font-mono text-[10.5px] tracking-[0.16em] text-faint uppercase">The day · so far</p>
          <p className={cn("mt-1 text-[clamp(1.5rem,5vw,2rem)] leading-none font-black tracking-[-0.035em] uppercase", VERDICT_TONE[s.verdict])}>{VERDICT_WORDS[s.verdict]}</p>
          {s.verdict !== "no-plan" && s.verdict !== "pending" && (
            <p className="tnum mt-1.5 text-[13px] text-muted">
              Said {fmtMin(s.saidMin)} · did {fmtMin(s.didMin)} · {s.missed} missed · {s.onTimeRate}% on time · streak {s.streak}
            </p>
          )}
        </div>
        <div className="flex shrink-0 gap-2">
          <Link href="/calendar#plan" className="press flex h-9 items-center gap-1.5 rounded-[10px] border border-line px-3 text-[13px] text-muted hover:text-text">
            <CalendarDays className="h-3.5 w-3.5" /> Plan
          </Link>
          <Link href="/mirror" className="press flex h-9 items-center gap-1.5 rounded-[10px] bg-text px-3 text-[13px] font-medium text-bg">
            <ScanFace className="h-3.5 w-3.5" /> Mirror
          </Link>
        </div>
      </div>
      {items.length === 0 ? (
        <Link href="/calendar#plan" className="flex items-center gap-2 px-4 py-4 text-[14px] text-bad hover:bg-white/[0.02]">
          Nothing planned. A day without a plan is a day you already gave away — plan it now <ArrowRight className="h-4 w-4" />
        </Link>
      ) : (
        <ol>
          {items.map((x) => (
            <li key={x.key} className="flex items-center gap-3 border-b border-line px-4 py-2.5 last:border-0">
              <span className="tnum w-[84px] shrink-0 font-mono text-[11.5px] text-faint">
                {x.start}–{x.end}
              </span>
              <span className={cn("min-w-0 flex-1 truncate text-[14px]", !x.verdict && "text-muted", x.verdict === "missed" && "text-muted line-through decoration-bad/50")}>{x.title}</span>
              <span className={cn("shrink-0 text-[12px]", x.verdict ? TONE[x.verdict] : "text-faint")}>
                {x.verdict ? `${x.running ? "running · " : ""}${WORD[x.verdict]}${x.verdict === "late" && x.lateMin ? ` +${x.lateMin}m` : ""}` : "event"}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
