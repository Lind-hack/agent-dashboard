import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { mirror, type Verdict } from "@/lib/accountability";
import type { Today } from "@/lib/planner";
import { cn } from "@/lib/utils";
import { MirrorHero } from "./mirror-hero";

// Home (v5.2; v5.3 leads with the full-bleed mirror): the day comes first — the verdict so far, then the plan's blocks and the calendar's
// events in time order, each block judged against the clock. One tap to Today or the Mirror.

const TONE: Record<Verdict, string> = { upcoming: "text-faint", "not-started": "text-bad", "on-time": "text-ok", late: "text-warn", missed: "text-bad", unfinished: "text-bad" };
const WORD: Record<Verdict, string> = { upcoming: "", "not-started": "not started", "on-time": "on time", late: "late", missed: "missed", unfinished: "unfinished" };

export function HomeDay({ day }: { day: Today }) {
  const m = mirror(day.today);
  const hm = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: day.tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
  const items = [
    ...m.rows.map((r) => ({ key: r.id, start: r.start, end: r.end, title: r.title, verdict: r.verdict as Verdict | null, running: r.running, lateMin: r.lateMin })),
    ...day.events.filter((e) => !e.allDay && !e.planned).map((e) => ({ key: e.id, start: hm(e.start), end: hm(e.end), title: e.title, verdict: null, running: false, lateMin: undefined })),
  ].sort((a, z) => a.start.localeCompare(z.start));

  return (
    <div className="flex flex-col gap-3">
      <MirrorHero day={day.today} />
      <section aria-label="The day" className="panel overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <p className="font-mono text-[10.5px] tracking-[0.16em] text-faint uppercase">The day · block by block</p>
        <Link href="/calendar" className="flex items-center gap-1 text-[12.5px] text-muted hover:text-text">
          Today <ArrowRight className="h-3.5 w-3.5" />
        </Link>
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
    </div>
  );
}
