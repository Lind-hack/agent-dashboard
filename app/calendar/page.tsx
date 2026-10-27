import { ArrowUpRight, MapPin, Target } from "lucide-react";
import { headers } from "next/headers";
import Link from "next/link";
import { Empty, PageHeader, Panel, SectionTitle, StatusPill } from "@/components/kit";
import { CaptureBar, PlanDay, TaskList, TickTickConnect } from "@/components/today";
import { TodayPlan } from "@/components/today-plan";
import { calendarConnected, type CalEvent } from "@/lib/calendar";
import { activeBlocks, planStats, readPlan } from "@/lib/plan-store";
import { freeSlots, today } from "@/lib/planner";
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
  // Plan blocks have their own section with Start / Done / Move; the Schedule shows fixed events only.
  const schedule = t.events.filter((e) => !e.planned);
  const timed = schedule.filter((e) => !e.allDay);
  const next = timed.find((e) => new Date(e.end).getTime() > now);
  const open = (t.tasks?.overdue.length ?? 0) + (t.tasks?.today.length ?? 0);
  const planned = t.events.filter((e) => e.planned && new Date(e.end).getTime() > now).length;

  // The authoritative plan store. Planned vs free time and what can't fit are read from it, not from
  // the calendar mirror.
  const savedPlan = readPlan(t.today);
  const blocks = activeBlocks(savedPlan);
  const stats = planStats(t.today);
  const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
  const freeMin = freeSlots(t).reduce((sum, s) => sum + (s.end - s.start), 0);
  const nowClock = new Intl.DateTimeFormat("en-GB", { timeZone: t.tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());
  const ahead = blocks.filter((x) => (x.status === "planned" || x.status === "running") && x.end > nowClock).sort((a, z) => a.start.localeCompare(z.start));
  const leftMin = ahead.reduce((sum, b) => sum + Math.max(0, minutes(b.end) - minutes(b.start)), 0);
  let capacity = freeMin;
  const overflow: string[] = [];
  for (const b of ahead) {
    const d = Math.max(0, minutes(b.end) - minutes(b.start));
    if (capacity >= d) capacity -= d;
    else overflow.push(`${b.start}–${b.end} ${b.title}`);
  }
  const dayEnd = process.env.PLAN_DAY_END ?? "23:00";

  const sub = [
    next ? `${new Date(next.start).getTime() <= now ? "Now" : `Next at ${time(next.start)}`}: ${next.title}` : google ? (timed.length ? "Calendar's done for today" : "Nothing on the calendar") : null,
    t.tasks ? (open ? `${open} task${open === 1 ? "" : "s"} open` : "no tasks due") : null,
  ].filter(Boolean);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={dayTitle(t.today, { weekday: "long", day: "numeric", month: "long" })}
        sub={sub.length ? `${sub.join(" · ")}.` : "Your day, in one place."}
        readout={[
          google ? `${timed.length} on the calendar` : "calendar not connected",
          planned > 0 && `${planned} planned blocks ahead`,
          t.tasks ? `${open} tasks open` : "ticktick not connected",
          stats.todayTotal > 0 && `${stats.todayDone}/${stats.todayTotal} blocks done`,
          stats.streak > 0 && `${stats.streak}-day streak`,
          t.tz,
        ]}
      />

      {t.errors.length > 0 && <p className="mb-4 rounded-2xl border border-bad/30 bg-bad/10 px-4 py-3 text-sm text-bad">{t.errors.join(" ")}</p>}

      <PlanDay key={t.today} canWrite={google} planned={planned} day={t.today} initialNote={savedPlan?.note} />

      <TodayPlan
        day={t.today}
        note={savedPlan?.note}
        blocks={blocks}
        stats={stats}
        leftMin={leftMin}
        freeMin={freeMin}
        overflow={overflow}
        goals={t.goals.map((g) => ({ id: g.id, title: g.title }))}
        dayEnd={dayEnd}
      />

      {t.priorities.length > 0 && (
        <section className="mt-8">
          <SectionTitle right="from Daily Agenda">Directives</SectionTitle>
          <Panel className="p-4">
            <ol className="flex flex-col gap-3 text-[14px]">
              {t.priorities.slice(0, 3).map((p, i) => (
                <li key={i} className="flex gap-3 leading-snug">
                  <span className="tnum mt-px w-5 shrink-0 font-mono text-[11px] text-hud/80">{String(i + 1).padStart(2, "0")}</span>
                  <span className="line-clamp-2" title={p}>{p}</span>
                </li>
              ))}
            </ol>
          </Panel>
        </section>
      )}

      <section className="mt-8">
        <SectionTitle right={<Link href="/goals" className="hover:text-text">All goals</Link>}>Goals</SectionTitle>
        {t.goals.length === 0 ? (
          <Panel className="p-5 text-sm leading-relaxed text-muted">
            <p className="text-text">No active goals yet.</p>
            <p className="mt-1">Write down what you&apos;re actually chasing — the planner puts each goal&apos;s next action into a focus block before anything else.</p>
            <Link href="/goals" className="mt-3 inline-flex h-9 items-center gap-2 rounded-[10px] bg-text px-4 text-sm font-medium text-bg">
              <Target className="h-4 w-4" /> Set your goals
            </Link>
          </Panel>
        ) : (
          <Panel className="overflow-hidden">
            {t.goals.map((g) => (
              <div key={g.id} className="flex items-start gap-3 border-b border-line px-4 py-3 last:border-0">
                <Target className="mt-1 h-4 w-4 shrink-0 text-hermes" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] leading-snug">{g.title}</span>
                  <span className="mt-0.5 block text-[12px] text-muted">{g.next ? `Next: ${g.next}` : "Next action not set"}</span>
                  {g.why && <span className="mt-0.5 block text-[11px] text-faint">{g.why}</span>}
                </span>
                <span className="shrink-0 text-right font-mono text-[10.5px] text-faint">
                  <span className="block uppercase">{g.horizon}</span>
                  {g.due && <span className="block">{g.due}</span>}
                </span>
              </div>
            ))}
          </Panel>
        )}
      </section>

      <section className="mt-8">
        <SectionTitle>Schedule</SectionTitle>
        {google ? (
          <Panel className="overflow-hidden">
            {schedule.length === 0 ? (
              <Empty>{blocks.length ? "No fixed events — your plan is above." : "A clear day. Plan it above, or add something below."}</Empty>
            ) : (
              <Day events={schedule} time={time} now={now} />
            )}
          </Panel>
        ) : (
          <Panel className="p-5 text-sm leading-relaxed text-muted">
            <p className="text-text">Connect Google Calendar — once, on your PC:</p>
            <pre className="mt-3 overflow-x-auto rounded-[12px] bg-black/40 px-4 py-3 font-mono text-[13px] text-text">node Desktop/claude/agent-dashboard/handoff/google-auth.mjs</pre>
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
  // The "now" marker sits before the first event that hasn't started yet.
  const nowAt = now === undefined ? -1 : events.findIndex((e) => !e.allDay && new Date(e.start).getTime() > now);
  const showNow = now !== undefined && events.some((e) => !e.allDay);
  return (
    <ol className="relative py-1">
      {/* The time rail */}
      <span className="pointer-events-none absolute top-0 bottom-0 left-[80.5px] w-px bg-line-hi" aria-hidden />
      {events.map((e, i) => {
        const past = now !== undefined && !e.allDay && new Date(e.end).getTime() <= now;
        const live = now !== undefined && !e.allDay && new Date(e.start).getTime() <= now && new Date(e.end).getTime() > now;
        const color = e.planned ? "var(--color-codex)" : (e.color ?? "var(--color-hermes)");
        return (
          <li key={`${e.id}-${e.calendar}`}>
            {showNow && i === nowAt && <NowRule tz={time} />}
            <a
              href={e.link}
              target="_blank"
              rel="noreferrer"
              className={cn("group relative flex min-h-16 items-start gap-4 px-4 py-3 transition-colors hover:bg-white/[0.025]", past && "opacity-45")}
            >
              <span className="tnum w-11 shrink-0 pt-0.5 font-mono text-[12px]">
                {e.allDay ? (
                  <span className="text-muted">all day</span>
                ) : (
                  <>
                    <span className={cn("block", live ? "text-hud" : "text-text")}>{time(e.start)}</span>
                    <span className="block text-faint">{time(e.end)}</span>
                  </>
                )}
              </span>
              {/* Node on the rail, in the event's calendar colour */}
              <span
                className={cn("relative z-[1] mt-1.5 h-2.5 w-2.5 shrink-0 rounded-[3px] ring-4 ring-bg", live && "shadow-[0_0_12px_var(--color-hud)]")}
                style={{ background: live ? "var(--color-hud)" : color }}
                aria-hidden
              />
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] leading-snug">{e.title}</span>
                <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                  {live && <StatusPill tone="live" pulse>Now</StatusPill>}
                  {e.location && (
                    <span className="flex min-w-0 items-center gap-1">
                      <MapPin className="h-3 w-3 shrink-0" aria-hidden />
                      <span className="truncate">{e.location}</span>
                    </span>
                  )}
                  <span className="font-mono text-[10.5px] text-faint">{e.planned ? "planned block" : e.calendar}</span>
                </span>
              </span>
              <ArrowUpRight className="h-4 w-4 shrink-0 self-center text-faint opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
            </a>
          </li>
        );
      })}
      {showNow && nowAt === -1 && <NowRule tz={time} />}
    </ol>
  );
}

function NowRule({ tz }: { tz: (iso: string) => string }) {
  const at = tz(new Date().toISOString());
  return (
    <div className="relative flex items-center gap-4 px-4 py-1.5" role="separator" aria-label={`Now, ${at}`}>
      <span className="tnum w-11 shrink-0 font-mono text-[11px] text-hud">{at}</span>
      <span className="relative z-[1] ml-px h-2 w-2 shrink-0 rounded-full bg-hud shadow-[0_0_10px_var(--color-hud)]" aria-hidden />
      <span className="h-px flex-1 bg-[linear-gradient(90deg,var(--color-hud),transparent)]" aria-hidden />
      <span className="hud-label !text-hud">now</span>
    </div>
  );
}
