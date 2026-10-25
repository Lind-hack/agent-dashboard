import { ArrowUpRight, MapPin } from "lucide-react";
import { headers } from "next/headers";
import { Empty, PageHeader, Panel, SectionTitle } from "@/components/kit";
import { CaptureBar, PlanDay, TaskList, TickTickConnect } from "@/components/today";
import { calendarConnected, type CalEvent } from "@/lib/calendar";
import { today } from "@/lib/planner";
import { ticktickConnected } from "@/lib/ticktick";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

// Today: the day in one place — calendar, TickTick tasks, plan-my-day, and one box to capture anything.
export default async function TodayPage({ searchParams }: { searchParams: Promise<{ ticktick_error?: string }> }) {
  const { ticktick_error } = await searchParams;
  const t = await today();
  const host = (await headers()).get("x-forwarded-host");
  const callback = `${host ? `https://${host}` : "https://agents.383ks.com"}/api/ticktick/callback`;
  const google = calendarConnected();
  const ticktick = ticktickConnected();

  const time = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: t.tz, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
  const dayTitle = (d: string, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", ...opts }).format(new Date(`${d}T12:00:00Z`));
  const now = Date.now();
  const timed = t.events.filter((e) => !e.allDay);
  const next = timed.find((e) => new Date(e.end).getTime() > now);
  const open = (t.tasks?.overdue.length ?? 0) + (t.tasks?.today.length ?? 0);
  const planned = t.events.filter((e) => e.planned && new Date(e.end).getTime() > now).length;

  const sub = [
    next ? `${new Date(next.start).getTime() <= now ? "Now" : `Next at ${time(next.start)}`}: ${next.title}` : google ? (timed.length ? "Calendar's done for today" : "Nothing on the calendar") : null,
    t.tasks ? (open ? `${open} task${open === 1 ? "" : "s"} open` : "no tasks due") : null,
  ].filter(Boolean);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={dayTitle(t.today, { weekday: "long", day: "numeric", month: "long" })} sub={sub.length ? `${sub.join(" · ")}.` : "Your day, in one place."} />

      {t.errors.length > 0 && <p className="mb-4 rounded-2xl border border-bad/30 bg-bad/10 px-4 py-3 text-sm text-bad">{t.errors.join(" ")}</p>}

      <PlanDay canWrite={google} planned={planned} />

      {t.priorities.length > 0 && (
        <section className="mt-8">
          <SectionTitle right="from Daily Agenda">Priorities</SectionTitle>
          <Panel className="p-4">
            <ol className="flex flex-col gap-2.5 text-sm">
              {t.priorities.slice(0, 3).map((p, i) => (
                <li key={i} className="flex gap-3">
                  <span className="tnum w-4 shrink-0 text-faint">{i + 1}</span>
                  <span className="line-clamp-2 text-muted">{p}</span>
                </li>
              ))}
            </ol>
          </Panel>
        </section>
      )}

      <section className="mt-8">
        <SectionTitle right={google ? t.tz : undefined}>Schedule</SectionTitle>
        {google ? (
          <Panel className="overflow-hidden">
            {t.events.length === 0 ? <Empty>A clear day. Plan it above, or add something below.</Empty> : <Day events={t.events} time={time} now={now} />}
          </Panel>
        ) : (
          <Panel className="p-5 text-sm leading-relaxed text-muted">
            <p className="text-text">Connect Google Calendar — once, on your PC:</p>
            <pre className="mt-3 overflow-x-auto rounded-xl bg-black/40 px-4 py-3 font-mono text-[13px] text-text">node Desktop/claude/agent-dashboard/handoff/google-auth.mjs</pre>
          </Panel>
        )}
      </section>

      <section className="mt-8">
        <SectionTitle right={ticktick ? "TickTick" : undefined}>Tasks</SectionTitle>
        {t.tasks ? (
          <TaskList
            groups={[
              { label: "Overdue", tone: "bad", tasks: t.tasks.overdue },
              { label: "Today", tasks: t.tasks.today },
              { label: "Inbox", tasks: t.tasks.inbox },
            ]}
          />
        ) : ticktick ? (
          <Panel>
            <Empty>Couldn't load TickTick right now.</Empty>
          </Panel>
        ) : (
          <TickTickConnect callback={callback} error={ticktick_error} />
        )}
      </section>

      {t.tomorrow.length > 0 && (
        <section className="mt-8">
          <SectionTitle>Tomorrow</SectionTitle>
          <Panel className="overflow-hidden">
            <Day events={t.tomorrow} time={time} />
          </Panel>
        </section>
      )}

      <CaptureBar />
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
              <span
                className={cn("w-[3px] shrink-0 rounded-full", e.planned && "bg-codex")}
                style={e.planned ? undefined : { background: e.color ?? "var(--color-hermes)" }}
                aria-hidden
              />
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
                  <span className="text-faint">{e.planned ? "planned block" : e.calendar}</span>
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
