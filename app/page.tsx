import { ArrowRight, ArrowUpRight, Radio } from "lucide-react";
import Link from "next/link";
import { InboxList } from "@/components/inbox-list";
import { Dot, Empty, Panel, SectionTitle } from "@/components/kit";
import { UsageMeter } from "@/components/usage-meter";
import { AGENT_LABELS } from "@/lib/agents";
import { repoShort } from "@/lib/config";
import { inboxItems, type InboxItem } from "@/lib/inbox";
import { listJobs, readHeartbeat } from "@/lib/store";
import { planUsage } from "@/lib/usage";
import { ago } from "@/lib/utils";
import { siteHealth } from "@/lib/website";

export const dynamic = "force-dynamic";

function greeting() {
  const h = Number(new Date().toLocaleString("en-GB", { hour: "numeric", hour12: false, timeZone: "Europe/Belgrade" }));
  return h < 5 ? "Still up, Lind." : h < 12 ? "Good morning, Lind." : h < 18 ? "Good afternoon, Lind." : "Good evening, Lind.";
}


export default async function Dashboard() {
  const usage = planUsage();
  const jobs = listJobs();
  const heartbeat = readHeartbeat();
  const [inbox, site] = await Promise.all([inboxItems().catch(() => [] as InboxItem[]), siteHealth().catch(() => null)]);

  const runnerAlive = !!heartbeat.at && Date.now() - new Date(heartbeat.at).getTime() < 60_000;
  const working = jobs.filter((j) => j.status === "running" || j.status === "queued");
  const recent = jobs.filter((j) => j.status !== "closed").slice(0, 5);
  const failedUnits = site?.units.filter((u) => u.result && u.result !== "success") ?? [];

  const state = [
    inbox.length ? `${inbox.length} thing${inbox.length > 1 ? "s" : ""} need${inbox.length > 1 ? "" : "s"} you` : "Nothing needs you",
    working.length ? `${working.length} agent${working.length > 1 ? "s" : ""} working` : runnerAlive ? "agents idle" : "runner down",
    site?.latest ? `383 published ${ago(site.latest.at)}` : null,
  ].filter(Boolean);

  return (
    <div className="flex min-w-0 flex-col gap-8">
      <section className="rise pt-2 lg:pt-6">
        <h1 className="text-[2.4rem] leading-[1.02] font-semibold tracking-[-0.045em] text-balance lg:text-[3.6rem]">{greeting()}</h1>
        <p className="mt-3 text-[15px] text-muted">{state.join(" · ")}.</p>
      </section>

      <Panel className="rise flex flex-col gap-6 p-5 sm:p-7" style={{ animationDelay: "60ms" }}>
        <UsageMeter agent="claude" usage={usage.claude} />
        <UsageMeter agent="codex" usage={usage.codex} />
      </Panel>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <section className="rise" style={{ animationDelay: "120ms" }}>
          <SectionTitle right={<Link href="/inbox" className="flex items-center gap-1 hover:text-text">Inbox <ArrowRight className="h-3.5 w-3.5" /></Link>}>Needs you</SectionTitle>
          <Panel className="overflow-hidden">
            <InboxList items={inbox} limit={5} empty="Nothing waiting. PRs, finished agents and failed timers show up here." />
          </Panel>
        </section>

        <div className="flex min-w-0 flex-col gap-8">
          <section className="rise" style={{ animationDelay: "180ms" }}>
            <SectionTitle right={<span className="flex items-center gap-2"><Dot tone={runnerAlive ? "ok" : "bad"} pulse={working.length > 0} /> runner {runnerAlive ? "online" : "offline"}</span>}>
              Working now
            </SectionTitle>
            <Panel className="overflow-hidden">
              {working.length === 0 ? (
                <Empty>No agent is running. Tap the orb to start one.</Empty>
              ) : (
                working.map((j) => (
                  <Link key={j.id} href={`/jobs/${j.id}`} className="flex min-h-14 items-center gap-3 border-b border-line px-4 py-3 last:border-0 hover:bg-white/[0.02]">
                    <Dot tone={j.agent} pulse={j.status === "running"} />
                    <span className="min-w-0 flex-1 truncate text-[15px]">{j.title}</span>
                    <span className="shrink-0 text-xs text-muted">{j.status === "queued" ? "queued" : AGENT_LABELS[j.agent]}</span>
                  </Link>
                ))
              )}
            </Panel>
          </section>

          <section className="rise" style={{ animationDelay: "240ms" }}>
            <SectionTitle right={<Link href="/website" className="flex items-center gap-1 hover:text-text">Website <ArrowRight className="h-3.5 w-3.5" /></Link>}>383 overnight</SectionTitle>
            <Panel className="flex flex-col gap-3 p-4 text-sm">
              {site ? (
                <>
                  <p className="flex items-center gap-2">
                    <Dot tone={site.up ? "ok" : "bad"} /> {site.up ? `383ks.com up · ${site.ms} ms` : site.error}
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
                <p className="text-muted">Couldn't check 383ks.com right now.</p>
              )}
            </Panel>
          </section>
        </div>
      </div>

      <section className="rise" style={{ animationDelay: "300ms" }}>
        <SectionTitle right={<Link href="/chat" className="flex items-center gap-1 hover:text-text">All chats <ArrowRight className="h-3.5 w-3.5" /></Link>}>Recent chats</SectionTitle>
        <Panel className="overflow-hidden">
          {recent.length === 0 ? (
            <Empty>No chats yet.</Empty>
          ) : (
            recent.map((j) => (
              <Link key={j.id} href={`/jobs/${j.id}`} className="flex min-h-14 items-center gap-3 border-b border-line px-4 py-3 last:border-0 hover:bg-white/[0.02]">
                <Dot tone={j.agent} />
                <span className="min-w-0 flex-1 truncate text-[15px]">{j.title}</span>
                <span className="hidden shrink-0 text-xs text-faint sm:inline">{repoShort(j.repo)}</span>
                {j.prUrl && <ArrowUpRight className="h-4 w-4 shrink-0 text-muted" aria-label="Has a PR" />}
                <span className="w-14 shrink-0 text-right text-xs text-faint">{ago(j.updatedAt)}</span>
              </Link>
            ))
          )}
        </Panel>
      </section>
    </div>
  );
}
