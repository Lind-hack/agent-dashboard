import { ArrowRight, ArrowUpRight, Brain, CalendarDays, Inbox, Radio, Swords } from "lucide-react";
import Link from "next/link";
import { AgentLogo } from "@/components/agent-logo";
import { CoreStage, type Dock } from "@/components/core-stage";
import { MissionStrip } from "@/components/mission-strip";
import { HeroLoop } from "@/components/motion";
import { HudClock } from "@/components/hud-clock";
import { InboxList } from "@/components/inbox-list";
import { Dot, Empty, Panel } from "@/components/kit";
import { UsageGauge } from "@/components/usage-gauge";
import { agentStatuses, type AgentStatus } from "@/lib/agent-status";
import type { AgentKey } from "@/lib/agents";
import { readBrainStatus } from "@/lib/brain";
import { coachNow, goalProgress } from "@/lib/coach";
import { repoShort } from "@/lib/config";
import { inboxItems, type InboxItem } from "@/lib/inbox";
import { today, type Today } from "@/lib/planner";
import { listJobs, readHeartbeat } from "@/lib/store";
import { listRooms } from "@/lib/rooms";
import { planUsage } from "@/lib/usage";
import { ago, cn } from "@/lib/utils";
import { siteHealth } from "@/lib/website";

export const dynamic = "force-dynamic";

function greeting() {
  const h = Number(new Date().toLocaleString("en-GB", { hour: "numeric", hour12: false, timeZone: "Europe/Belgrade" }));
  return h < 5 ? "Still up, Lind." : h < 12 ? "Good morning, Lind." : h < 18 ? "Good afternoon, Lind." : "Good evening, Lind.";
}

function Section({ label, right, children, className }: { label: string; right?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("min-w-0", className)}>
      <div className="mb-2.5 flex items-center justify-between gap-3 px-1">
        <h2 className="hud-label !text-[11px] !text-muted">{label}</h2>
        {right && <div className="text-xs text-muted">{right}</div>}
      </div>
      {children}
    </section>
  );
}

const More = ({ href, children }: { href: string; children: React.ReactNode }) => (
  <Link href={href} className="flex items-center gap-1 rounded-md px-1 hover:text-text">
    {children} <ArrowRight className="h-3.5 w-3.5" />
  </Link>
);

export default async function Home() {
  const usage = planUsage();
  const jobs = listJobs();
  const heartbeat = readHeartbeat();
  const brain = readBrainStatus();
  const [inbox, site, day, statuses] = await Promise.all([
    inboxItems().catch(() => [] as InboxItem[]),
    siteHealth().catch(() => null),
    today().catch(() => null as Today | null),
    agentStatuses().catch(() => [] as AgentStatus[]),
  ]);

  const debating = listRooms().filter((r) => r.status === "debating");
  const debateOf = (a: AgentKey) => {
    const r = debating.find((x) => x.rounds.at(-1)?.answers[a]?.status === "running");
    return r ? `Debating: ${r.task.split("\n")[0]}` : undefined;
  };
  const runnerAlive = !!heartbeat.at && Date.now() - new Date(heartbeat.at).getTime() < 60_000;
  const running = jobs.filter((j) => j.status === "running");
  const recent = jobs.filter((j) => j.status !== "closed").slice(0, 6);
  const failedUnits = site?.units.filter((u) => u.result && u.result !== "success") ?? [];
  const brainFailing = Object.values(brain.sources).filter((s) => (s.failures ?? 0) > 0).length;

  const docks: Dock[] = statuses.map((s) => ({
    agent: s.agent,
    ready: s.ready,
    working: running.find((j) => j.agent === s.agent)?.title ?? debateOf(s.agent),
    queued: jobs.filter((j) => j.agent === s.agent && j.status === "queued").length,
    note: s.note,
  }));
  const readout = [
    runnerAlive ? "runner online" : "runner offline",
    brain.updatedAt ? `brain ${brainFailing ? `${brainFailing} failing` : "synced"}` : "brain idle",
    process.env.MEMORY_VAULT_DIR ? "vault connected" : "vault off",
    site?.up ? "383 up" : "383 down",
  ];

  const state = [
    running.length ? `${running.length} agent${running.length > 1 ? "s" : ""} working` : "agents idle",
    site?.latest ? `383 published ${ago(site.latest.at)}` : null,
  ].filter(Boolean);

  return (
    <div className="flex min-w-0 flex-col gap-7 lg:gap-8">
      <header className="section-hero rise flex items-end justify-between gap-4 px-5 py-6 lg:px-8 lg:py-9">
        <HeroLoop clip="home" />
        <div className="min-w-0">
          <h1 className="text-[2.1rem] leading-[1.02] font-semibold tracking-[-0.045em] text-balance sm:text-[2.6rem] lg:text-[3.2rem]">{greeting()}</h1>
          <p className="mt-2.5 text-[15px] text-muted">
            {inbox.length ? (
              <Link href="/inbox" className="text-text underline decoration-hud/40 underline-offset-4 hover:decoration-hud">
                {inbox.length} thing{inbox.length > 1 ? "s" : ""} need{inbox.length > 1 ? "" : "s"} you
              </Link>
            ) : (
              "Nothing needs you"
            )}
            {state.length > 0 && ` · ${state.join(" · ")}`}.
          </p>
        </div>
        <HudClock className="hidden shrink-0 text-[3.2rem] sm:block" />
      </header>

      <MissionStrip now={coachNow()} goals={goalProgress()} />

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.5fr)_minmax(0,0.95fr)] lg:gap-5">
        {/* Centre on the phone comes first: the core and the agents. */}
        <div className="rise lg:order-2" style={{ animationDelay: "40ms" }}>
          <CoreStage docks={docks} readout={readout} />
        </div>

        {/* Left: the day */}
        <div className="flex min-w-0 flex-col gap-6 lg:order-1">
          <Section label="Directives" right={<More href="/calendar">Today</More>}>
            <Panel className="p-4">
              {day?.priorities.length ? (
                <ol className="flex flex-col gap-3">
                  {day.priorities.slice(0, 3).map((p, i) => (
                    <li key={i} className="flex gap-3 text-[14px] leading-snug">
                      <span className="tnum mt-px font-mono text-[11px] text-hud/80">{String(i + 1).padStart(2, "0")}</span>
                      <span className="line-clamp-3 min-w-0" title={p}>{p}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-sm text-muted">No priorities yet. They come from the nightly agenda note in your vault.</p>
              )}
            </Panel>
          </Section>
          {day && <UpNext day={day} />}
        </div>

        {/* Right: plan usage + commands */}
        <div className="flex min-w-0 flex-col gap-6 lg:order-3">
          <Section label="Plan usage">
            <Panel className="flex flex-col gap-6 p-4">
              <UsageGauge agent="claude" usage={usage.claude} />
              <UsageGauge agent="codex" usage={usage.codex} />
            </Panel>
          </Section>
          <Section label="Commands">
            <div className="grid grid-cols-2 gap-2">
              {[
                { href: "/calendar", label: "Plan today", icon: CalendarDays },
                { href: "/inbox", label: "Inbox brief", icon: Inbox },
                { href: "/room", label: "Roast room", icon: Swords },
                { href: "/memory", label: "Ask memory", icon: Brain },
              ].map((c) => {
                const Icon = c.icon;
                return (
                  <Link
                    key={c.href + c.label}
                    href={c.href}
                    className="group panel flex min-h-[64px] flex-col justify-between gap-2 !rounded-[14px] p-3 transition-colors hover:border-line-hi hover:bg-white/[0.04]"
                  >
                    <Icon className="h-[18px] w-[18px] text-hud" strokeWidth={1.75} />
                    <span className="flex items-center justify-between text-[13px] font-medium">
                      {c.label} <ArrowRight className="h-3.5 w-3.5 text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-text" />
                    </span>
                  </Link>
                );
              })}
            </div>
          </Section>
        </div>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] lg:gap-5">
        <Section label="Needs you" right={<More href="/inbox">Inbox</More>}>
          <Panel className="overflow-hidden">
            <InboxList items={inbox} limit={5} empty="Nothing waiting. PRs, finished agents and failed jobs land here." />
          </Panel>
        </Section>

        <div className="flex min-w-0 flex-col gap-6">
          <Section label="Recent chats" right={<More href="/chat">All</More>}>
            <Panel className="overflow-hidden">
              {recent.length === 0 ? (
                <Empty>No chats yet. Start one with Talk or Voice.</Empty>
              ) : (
                recent.map((j) => (
                  <Link key={j.id} href={`/jobs/${j.id}`} className="flex min-h-14 items-center gap-3 border-b border-line px-3 py-2.5 last:border-0 hover:bg-white/[0.02]">
                    <AgentLogo agent={j.agent} size="sm" state={j.status === "running" ? "working" : j.status === "failed" ? "off" : "ready"} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px]">{j.title}</span>
                      <span className="block truncate font-mono text-[11px] text-faint">
                        {repoShort(j.repo) || "no repo"} · {j.status === "waiting" ? "your turn" : j.status}
                      </span>
                    </span>
                    {j.prUrl && <ArrowUpRight className="h-4 w-4 shrink-0 text-muted" aria-label="Has a PR" />}
                    <span className="tnum w-12 shrink-0 text-right font-mono text-[11px] text-faint">{ago(j.updatedAt).replace(" ago", "")}</span>
                  </Link>
                ))
              )}
            </Panel>
          </Section>

          <Section label="383 overnight" right={<More href="/website">Website</More>}>
            <Panel className="flex flex-col gap-2.5 p-4 text-sm">
              {site ? (
                <>
                  <p className="flex items-center gap-2">
                    <Dot tone={site.up ? "ok" : "bad"} /> {site.up ? <>383ks.com up <span className="tnum font-mono text-xs text-faint">{site.ms} ms</span></> : site.error}
                  </p>
                  {site.latest && (
                    <a href={site.latest.url} target="_blank" rel="noreferrer" className="flex items-start gap-2 hover:text-text">
                      <Radio className="mt-0.5 h-4 w-4 shrink-0 text-muted" strokeWidth={1.75} />
                      <span className="min-w-0 text-muted">
                        Last article {ago(site.latest.at)}: <span className="text-text">{site.latest.title}</span>
                      </span>
                    </a>
                  )}
                  <p className="flex items-center gap-2 text-muted">
                    <Dot tone={failedUnits.length ? "bad" : "ok"} />
                    {failedUnits.length ? `${failedUnits.map((u) => u.timer.replace(".timer", "")).join(", ")} failed` : `${site.units.length} scheduled jobs healthy`}
                  </p>
                </>
              ) : (
                <p className="text-muted">Couldn&apos;t check 383ks.com right now.</p>
              )}
            </Panel>
          </Section>
        </div>
      </div>
    </div>
  );
}

// What's next on the calendar and the top open tasks.
function UpNext({ day }: { day: Today }) {
  const now = Date.now();
  const time = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: day.tz, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
  const upcoming = day.events.filter((e) => !e.allDay && new Date(e.end).getTime() > now).slice(0, 4);
  const tasks = [...(day.tasks?.overdue ?? []), ...(day.tasks?.today ?? [])].slice(0, 4);
  const flag: Record<number, string> = { 5: "bg-bad", 3: "bg-warn", 1: "bg-codex" };
  return (
    <>
      <Section label="Up next">
        <Panel className="overflow-hidden">
          {upcoming.length ? (
            upcoming.map((e, i) => {
              const live = new Date(e.start).getTime() <= now;
              return (
                <div key={e.id} className="flex min-h-12 items-center gap-3 border-b border-line px-4 py-2 last:border-0">
                  <span className={cn("tnum w-11 shrink-0 font-mono text-[12px]", live ? "text-hud" : "text-muted")}>{live ? "now" : time(e.start)}</span>
                  <span className={cn("min-w-0 truncate text-[14px]", i === 0 && "font-medium")}>{e.title}</span>
                </div>
              );
            })
          ) : (
            <p className="px-4 py-4 text-sm text-muted">{day.events.length ? "Nothing left on the calendar today." : "Calendar's clear today."}</p>
          )}
        </Panel>
      </Section>
      <Section label="Tasks">
        <Panel className="overflow-hidden">
          {day.tasks === null ? (
            <p className="px-4 py-4 text-sm text-muted">Connect TickTick on the Today page.</p>
          ) : tasks.length ? (
            tasks.map((t) => (
              <div key={t.id} className="flex min-h-12 items-center gap-3 border-b border-line px-4 py-2 last:border-0">
                <span className={cn("h-3 w-[3px] shrink-0 rounded-full", t.priority ? flag[t.priority] : "bg-white/15")} />
                <span className="min-w-0 truncate text-[14px]">{t.title}</span>
              </div>
            ))
          ) : (
            <p className="px-4 py-4 text-sm text-muted">Nothing due today.</p>
          )}
        </Panel>
      </Section>
    </>
  );
}
