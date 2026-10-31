import { ArrowUpRight, MapPin } from "lucide-react";
import { headers } from "next/headers";
import { AssistantPanel } from "@/components/assistant-panel";
import { DayBoard } from "@/components/day-board";
import { SayIt } from "@/components/say-it";
import { AutopilotStrip } from "@/components/autopilot-strip";
import { Empty, Panel, SectionTitle, StatusPill } from "@/components/kit";
import { SectionHero } from "@/components/motion";
import { NowCard, type NowItem } from "@/components/now-card";
import { PlanDay, TickTickConnect } from "@/components/today";
import { TodayPlan } from "@/components/today-plan";
import { TodoBoard } from "@/components/todo-board";
import { briefPending, readBrief, readChat, type BriefSlot } from "@/lib/assistant";
import { autopilotEnabled, readAutopilot } from "@/lib/autopilot";
import { board } from "@/lib/day-board";
import { addDays, calendarConnected, type CalEvent } from "@/lib/calendar";
import { activeBlocks, planStats, readPlan } from "@/lib/plan-store";
import { freeSlots, today } from "@/lib/planner";
import { ticktickConnected } from "@/lib/ticktick";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

// Today (v5.3, trimmed): Say it, the day board (habits, tasks, goals), the plan, the calendar, the Day
// assistant and Autopilot, every task folded away at the bottom. The mirror and the morning push live on
// Home and /mirror.
// "HH:MM" on a calendar day in a time zone → the ISO instant.
function zoned(day: string, hhmm: string, tz: string): string {
  const guess = Date.parse(`${day}T${hhmm}:00Z`);
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(guess)).map((x) => [x.type, x.value]));
  const shown = Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:00Z`);
  return new Date(guess - (shown - guess)).toISOString();
}


export default async function TodayPage({ searchParams }: { searchParams: Promise<{ ticktick_error?: string; replan?: string; autopilot?: string }> }) {
  const { ticktick_error, replan, autopilot } = await searchParams;
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
  const open = t.todos.overdue.length + t.todos.today.length;
  const planned = t.events.filter((e) => e.planned && new Date(e.end).getTime() > now).length;

  // The authoritative plan store. Planned vs free time and what can't fit are read from it, not from
  // the calendar mirror.
  const blocks = activeBlocks(readPlan(t.today));
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

  const dayStart = process.env.PLAN_DAY_START ?? "07:00";
  const nowItems: NowItem[] = [
    ...timed.map((e) => ({ title: e.title, start: e.start, end: e.end, kind: "event" as const })),
    ...blocks.map((b) => ({ title: b.title, start: zoned(t.today, b.start, t.tz), end: zoned(t.today, b.end, t.tz), kind: "block" as const, done: b.status === "done" || b.status === "dropped" || b.status === "moved" })),
  ];

  const sub = [
    next ? `${new Date(next.start).getTime() <= now ? "Now" : `Next at ${time(next.start)}`}: ${next.title}` : google ? (timed.length ? "Calendar's done for today" : "Nothing on the calendar") : null,
    open ? `${open} task${open === 1 ? "" : "s"} open` : t.todos.done.length ? "every task done" : null,
  ].filter(Boolean);

  // The briefing that fits the hour; "Ask Sol" asks for that one.
  const hour = Number(nowClock.slice(0, 2));
  const slotNow: BriefSlot = hour < 12 ? "morning" : hour < 20 ? "midday" : "evening";

  return (
    <div className="mx-auto max-w-3xl">
      <SectionHero
        clip="today"
        eyebrow={[google ? `${timed.length} on the calendar` : "calendar not connected", planned > 0 && `${planned} blocks ahead`, `${open} tasks open`, stats.todayTotal > 0 && `${stats.todayDone}/${stats.todayTotal} blocks done`, stats.streak > 0 && `${stats.streak}-day streak`].filter(Boolean).join(" · ")}
        title={dayTitle(t.today, { weekday: "long", day: "numeric", month: "long" })}
        sub={sub.length ? `${sub.join(" · ")}.` : "Your day, in one place."}
      >
        <NowCard items={nowItems} dayStart={zoned(t.today, dayStart, t.tz)} dayEnd={zoned(t.today, dayEnd, t.tz)} freeMin={freeMin} tz={t.tz} />
      </SectionHero>

      {t.errors.length > 0 && <p className="mb-4 rounded-2xl border border-bad/30 bg-bad/10 px-4 py-3 text-sm text-bad">{t.errors.join(" ")}</p>}

      <SayIt />

      <DayBoard initial={board()} />

      <div id="plan" className="mt-6 scroll-mt-20">
        <PlanDay canWrite={google} planned={planned} initialNote={replan} />
      </div>

      <TodayPlan
        day={t.today}
        blocks={blocks}
        stats={stats}
        leftMin={leftMin}
        freeMin={freeMin}
        overflow={overflow}
        goals={t.goals.map((g) => ({ id: g.id, title: g.title }))}
        dayEnd={dayEnd}
      />

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




      <AutopilotStrip initial={readAutopilot(t.today)} enabled={autopilotEnabled()} highlight={autopilot} />

      <AssistantPanel
        slotNow={slotNow}
        initial={{ day: t.today, chat: readChat(t.today), briefs: { morning: readBrief(t.today, "morning"), midday: readBrief(t.today, "midday"), evening: readBrief(t.today, "evening") }, pending: briefPending() }}
      />


      {/* Every task, with edit, schedule and later days — folded away; the board above is the daily view. */}
      <details className="group mt-8">
        <summary className="cursor-pointer list-none px-1 text-[13px] text-muted hover:text-text">
          All tasks — edit, schedule, later days <span className="inline-block transition-transform group-open:rotate-90">›</span>
        </summary>
        <TodoBoard lists={t.todos} goals={t.goals.map((g) => ({ id: g.id, title: g.title }))} day={t.today} tomorrow={addDays(t.today, 1)} />
      </details>



      {t.tomorrow.length > 0 && (
        <section className="mt-8">
          <SectionTitle>Tomorrow</SectionTitle>
          <Panel className="overflow-hidden">
            <Day events={t.tomorrow} time={time} />
          </Panel>
        </section>
      )}

      {!ticktick && (
        <details className="mt-8 text-sm text-muted">
          <summary className="cursor-pointer px-1 text-xs text-faint hover:text-text">Import tasks from TickTick</summary>
          <div className="mt-3">
            <TickTickConnect callback={callback} error={ticktick_error} />
          </div>
        </details>
      )}

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
