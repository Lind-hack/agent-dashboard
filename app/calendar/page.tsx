import { ArrowUpRight, MapPin } from "lucide-react";
import { CalendarAdd } from "@/components/calendar-add";
import { Empty, PageHeader, Panel, SectionTitle } from "@/components/kit";
import { agenda, calendarConnected, type CalEvent } from "@/lib/calendar";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function CalendarPage() {
  if (!calendarConnected()) {
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader title="Today" sub="Your Google Calendar isn't connected yet." />
        <Panel className="p-5 text-sm leading-relaxed text-muted">
          <p className="text-text">One-time setup, on your PC:</p>
          <pre className="mt-3 overflow-x-auto rounded-xl bg-black/40 px-4 py-3 font-mono text-[13px] text-text">node Desktop/claude/agent-dashboard/handoff/google-auth.mjs</pre>
          <p className="mt-3">Sign in with Google and allow Calendar. The page fills in as soon as it finishes.</p>
        </Panel>
      </div>
    );
  }

  let data: Awaited<ReturnType<typeof agenda>> | null = null;
  let error = "";
  try {
    data = await agenda(2);
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  const tz = data?.tz ?? "Europe/Belgrade";
  const fmtDay = (d: string, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", ...opts }).format(new Date(`${d}T12:00:00Z`));
  const time = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
  const dayOf = (e: CalEvent) => (e.allDay ? e.start : new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(e.start)));

  const today = data?.today ?? "";
  const todays = data?.events.filter((e) => dayOf(e) === today) ?? [];
  const later = data?.events.filter((e) => dayOf(e) > today) ?? [];
  const now = Date.now();
  const timed = todays.filter((e) => !e.allDay);
  const next = timed.find((e) => new Date(e.end).getTime() > now);
  const left = timed.filter((e) => new Date(e.start).getTime() > now).length;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={today ? fmtDay(today, { weekday: "long", day: "numeric", month: "long" }) : "Today"}
        sub={
          error
            ? error
            : !todays.length
              ? "Nothing on the calendar today."
              : next
                ? `${left ? `${left} more today` : "Last one today"} · next: ${next.title} at ${time(next.start)}`
                : "Done for today."
        }
      />

      <section>
        <SectionTitle right={tz}>Today</SectionTitle>
        <Panel className="overflow-hidden">
          {todays.length === 0 ? (
            <Empty>A clear day. Add something below — “gym at 7”, “call the printer tomorrow 10:30”.</Empty>
          ) : (
            <Day events={todays} time={time} now={now} />
          )}
        </Panel>
      </section>

      {later.length > 0 && (
        <section className="mt-8">
          <SectionTitle>{fmtDay(dayOf(later[0]), { weekday: "long", day: "numeric", month: "short" })}</SectionTitle>
          <Panel className="overflow-hidden">
            <Day events={later} time={time} />
          </Panel>
        </section>
      )}

      <CalendarAdd />
    </div>
  );
}

function Day({ events, time, now }: { events: CalEvent[]; time: (iso: string) => string; now?: number }) {
  // The "now" rule sits before the first event that hasn't started yet.
  const nowAt = now === undefined ? -1 : events.findIndex((e) => !e.allDay && new Date(e.start).getTime() > now);
  const showNow = now !== undefined && events.some((e) => !e.allDay);
  return (
    <ol>
      {events.map((e, i) => {
        const past = now !== undefined && !e.allDay && new Date(e.end).getTime() <= now;
        const live = now !== undefined && !e.allDay && new Date(e.start).getTime() <= now && new Date(e.end).getTime() > now;
        return (
          <li key={`${e.id}-${e.calendar}`}>
            {showNow && i === nowAt && <NowRule />}
            <a
              href={e.link}
              target="_blank"
              rel="noreferrer"
              className={cn("group flex min-h-16 items-stretch gap-4 border-b border-line px-4 py-3 last:border-0 hover:bg-white/[0.02]", past && "opacity-45")}
            >
              <span className="tnum w-12 shrink-0 pt-0.5 text-[13px] text-muted">
                {e.allDay ? (
                  "All day"
                ) : (
                  <>
                    <span className={cn("block", live ? "text-claude" : "text-text")}>{time(e.start)}</span>
                    <span className="block text-faint">{time(e.end)}</span>
                  </>
                )}
              </span>
              <span className="w-[3px] shrink-0 rounded-full" style={{ background: e.color ?? "var(--color-hermes)" }} aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] leading-snug">{e.title}</span>
                <span className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-muted">
                  {live && <span className="text-claude">happening now</span>}
                  {e.location && (
                    <span className="flex min-w-0 items-center gap-1">
                      <MapPin className="h-3 w-3 shrink-0" />
                      <span className="truncate">{e.location}</span>
                    </span>
                  )}
                  <span className="text-faint">{e.calendar}</span>
                </span>
              </span>
              <ArrowUpRight className="h-4 w-4 shrink-0 self-center text-faint opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
            </a>
          </li>
        );
      })}
      {showNow && nowAt === -1 && <NowRule />}
    </ol>
  );
}

function NowRule() {
  return (
    <div className="flex items-center gap-2 px-4 py-1" aria-label="Now">
      <span className="text-[11px] font-medium tracking-[0.12em] text-claude uppercase">Now</span>
      <span className="h-px flex-1 bg-claude/50" />
    </div>
  );
}
