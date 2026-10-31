import { Flame, Target } from "lucide-react";
import Link from "next/link";
import type { Mirror, Verdict } from "@/lib/accountability";
import type { Push } from "@/lib/goggins";
import { cn } from "@/lib/utils";

// Goggins mode on Today (v5.2): the morning push written from his own record, and the mirror —
// every block he said he'd do, judged against the clock — with the kept-days streak.

const VERDICT: Record<Verdict, { label: string; tone: string }> = {
  upcoming: { label: "ahead", tone: "text-faint" },
  "not-started": { label: "not started", tone: "text-bad" },
  "on-time": { label: "on time", tone: "text-ok" },
  late: { label: "late", tone: "text-warn" },
  missed: { label: "missed", tone: "text-bad" },
  unfinished: { label: "unfinished", tone: "text-bad" },
};

export function PushCard({ push }: { push: Push | null }) {
  if (!push) return null;
  const [first, ...rest] = push.text.split(/\n{2,}/);
  return (
    <section id="push" aria-label="Morning push" className="panel mt-6 scroll-mt-20 overflow-hidden">
      <div className="border-b border-line px-4 py-3">
        <p className="font-mono text-[10.5px] tracking-[0.08em] text-faint uppercase">In the spirit of David Goggins · written for you, not his words</p>
        <h2 className="mt-1 text-[17px] leading-snug font-semibold tracking-[-0.01em]">{push.title}</h2>
      </div>
      <div className="px-4 py-3.5 text-[14.5px] leading-relaxed">
        <p>{first}</p>
        {rest.length > 0 && (
          <details className="group mt-3">
            <summary className="cursor-pointer list-none text-[13px] text-muted hover:text-text group-open:hidden">Read all of it</summary>
            <div className="flex flex-col gap-3">
              {rest.map((p, i) => (
                <p key={i}>{p}</p>
              ))}
            </div>
          </details>
        )}
      </div>
    </section>
  );
}

export function MirrorCard({ m, streak, idle }: { m: Mirror; streak: { days: number; todayKept: boolean; todayAlive: boolean }; idle: { id: string; title: string; idleDays: number | null }[] }) {
  const state = streak.todayKept ? "Day kept" : !m.rows.length ? "No blocks — nothing to keep" : streak.todayAlive ? "Still alive" : "Broken today";
  return (
    <section id="mirror" aria-label="Said vs did" className="panel mt-6 scroll-mt-20 overflow-hidden">
      <div className="flex items-center gap-3 border-b border-line px-4 py-3">
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-medium">Said vs did</span>
          <span className="block truncate text-[11.5px] text-faint">
            {m.due ? `${m.done}/${m.due} done · ${m.onTimeRate}% started on time · ${m.missed} missed${m.unfinished ? ` · ${m.unfinished} unfinished` : ""}` : "Every block you plan is judged against the clock."}
          </span>
        </span>
        <span className={cn("flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px]", streak.todayAlive || streak.todayKept ? "bg-warn/12 text-warn" : "bg-white/[0.05] text-muted")} title="Kept day: every block done, nothing missed, 80%+ started on time">
          <Flame className="h-3.5 w-3.5" aria-hidden />
          <span className="tnum font-mono">{streak.days}</span>
          <span className="max-sm:hidden">· {state}</span>
        </span>
      </div>
      {m.rows.length === 0 ? (
        <p className="px-4 py-4 text-sm text-muted">Nothing planned yet. Plan the day — or say it above — and every block gets scored.</p>
      ) : (
        <ol>
          {m.rows.map((r) => {
            const v = VERDICT[r.verdict];
            return (
              <li key={r.id} className="flex items-center gap-3 border-b border-line px-4 py-2.5 last:border-0">
                <span className="tnum w-[84px] shrink-0 font-mono text-[11.5px] text-faint">
                  {r.start}–{r.end}
                </span>
                <span className={cn("min-w-0 flex-1 truncate text-[14px]", r.verdict === "missed" && "text-muted line-through decoration-bad/50")}>{r.title}</span>
                <span className={cn("shrink-0 text-right text-[12px]", v.tone)}>
                  {r.running ? "running · " : ""}
                  {v.label}
                  {r.verdict === "late" && r.lateMin ? ` +${r.lateMin}m` : ""}
                  {r.actualMin !== undefined ? <span className="text-faint"> · {r.actualMin}/{r.plannedMin}m</span> : null}
                  {r.rescheduledTo ? <span className="text-faint"> → {r.rescheduledTo}</span> : null}
                </span>
              </li>
            );
          })}
        </ol>
      )}
      {idle.length > 0 && (
        <Link href="/goals" className="flex items-center gap-2 border-t border-line px-4 py-2.5 text-[12.5px] text-warn hover:bg-white/[0.02]">
          <Target className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="truncate">Avoiding: {idle.map((g) => `${g.title} (${g.idleDays === null ? "never touched" : `${g.idleDays}d`})`).join(" · ")}</span>
        </Link>
      )}
    </section>
  );
}
