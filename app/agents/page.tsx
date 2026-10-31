import { ArrowRight, CheckCircle2, CircleAlert, Clock, Cpu, MessageSquare } from "lucide-react";
import Link from "next/link";
import { AgentLogo } from "@/components/agent-logo";
import { Panel, SectionTitle } from "@/components/kit";
import { CountUp, SectionHero } from "@/components/motion";
import { agentStatuses } from "@/lib/agent-status";
import { AGENT_LABELS, AGENT_META, type AgentKey } from "@/lib/agents";
import { parseProgress, type LogLike } from "@/lib/progress";
import { agentModels } from "@/lib/rooms";
import { listJobs, readLog } from "@/lib/store";
import { planUsage } from "@/lib/usage";
import { ago, cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

// The crew: one card per agent with what it's doing this minute (its own step plan, live), the model
// it runs on, how much of its plan is used, and its week in numbers.
export default async function AgentsPage() {
  const statuses = await agentStatuses();
  const models = agentModels();
  const usage = planUsage();
  const jobs = listJobs();
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();

  const groups = new Map<string, { id: string; kind: string; task: string; at: string; agents: string[] }>();
  for (const j of jobs) {
    if (!j.group) continue;
    const g = groups.get(j.group.id) ?? { id: j.group.id, kind: j.group.kind, task: j.group.task, at: j.updatedAt, agents: [] };
    g.agents.push(j.agent);
    if (j.updatedAt > g.at) g.at = j.updatedAt;
    groups.set(j.group.id, g);
  }
  const recent = [...groups.values()].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 6);
  const working = statuses.filter((s) => s.busy).length;

  return (
    <div className="mx-auto max-w-6xl">
      <SectionHero
        clip="agents"
        eyebrow={`${working ? `${working} working` : "all idle"} · ${statuses.filter((s) => s.ready).length} of ${statuses.length} ready`}
        title="Agents"
        sub="Your crew on the VPS: what each one is doing right now, step by step, what it runs on and how much of its plan is left."
        right={
          <Link href="/room" className="press flex min-h-10 items-center gap-2 rounded-[12px] bg-text px-4 text-sm font-medium text-bg">
            Open the Room <ArrowRight className="h-4 w-4" />
          </Link>
        }
      />

      <div className="stagger grid gap-4 md:grid-cols-2">
        {statuses.map((s) => {
          const mine = jobs.filter((j) => j.agent === s.agent);
          const live = mine.find((j) => j.status === "running");
          const week = mine.filter((j) => j.createdAt >= weekAgo);
          const ok = week.filter((j) => j.status !== "failed").length;
          const p = live ? parseProgress(readLog(live.id, 600) as LogLike[]) : null;
          const done = p?.steps.filter((x) => x.status === "done").length ?? 0;
          const color = AGENT_META[s.agent].color;
          const u = s.agent === "claude" ? usage.claude : s.agent === "codex" ? usage.codex : null;
          return (
            <Panel key={s.agent} className="lift relative overflow-hidden p-5" style={{ ["--agent" as string]: color }}>
              <span className="pointer-events-none absolute -top-20 -right-20 h-56 w-56 rounded-full opacity-20 blur-3xl transition-opacity duration-700" style={{ background: color, opacity: live ? 0.35 : 0.14 }} aria-hidden />
              <div className="relative flex items-start gap-4">
                <AgentLogo agent={s.agent} size="lg" state={!s.ready ? "off" : s.busy ? "working" : "ready"} />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-lg font-semibold tracking-[-0.02em]">
                    {AGENT_LABELS[s.agent]}
                    <span className={cn("rounded-md px-1.5 py-0.5 font-mono text-[10px] tracking-[0.06em] uppercase", !s.ready ? "bg-warn/10 text-warn" : live ? "text-bg" : "bg-white/[0.05] text-muted")} style={live ? { background: color } : undefined}>
                      {!s.ready ? "not set up" : live ? "working" : "ready"}
                    </span>
                  </p>
                  <p className="truncate font-mono text-[11px] text-faint" title={models[s.agent as AgentKey]}>
                    {models[s.agent as AgentKey]}
                  </p>
                  <p className="mt-1 text-xs text-muted">{s.ready ? AGENT_META[s.agent].hint : s.note}</p>
                </div>
              </div>

              {live ? (
                <Link href={`/jobs/${live.id}`} className="relative mt-4 block rounded-[14px] border border-line bg-black/25 p-3 transition-colors hover:border-line-hi">
                  <p className="truncate text-[14px] font-medium">{live.title}</p>
                  <p className="mt-1 text-xs text-muted">{p?.current && p.total ? `Step ${p.current} of ${p.total}: ${p.steps.find((x) => x.status === "active")?.title ?? ""}` : (p?.phase ?? "Starting")}</p>
                  {p?.total ? (
                    <span className="mt-2.5 flex gap-1">
                      {Array.from({ length: p.total }, (_, i) => (
                        <span key={i} className={cn("h-1.5 flex-1 rounded-full", i < done ? "" : i === done ? "shimmer" : "bg-white/[0.06]")} style={i < done ? { background: color } : i === done ? { background: `color-mix(in oklab, ${color}, transparent 70%)` } : undefined} />
                      ))}
                    </span>
                  ) : (
                    <span className="shimmer mt-2.5 block h-1.5 rounded-full bg-white/[0.06]" />
                  )}
                  <p className="mt-2 flex gap-3 font-mono text-[10.5px] text-faint">
                    {p?.files.length ? <span>{p.files.length} files</span> : null}
                    {p?.commands ? <span>{p.commands} commands</span> : null}
                    <span>started {ago(p?.startedAt ?? live.updatedAt)}</span>
                  </p>
                </Link>
              ) : (
                <p className="relative mt-4 rounded-[14px] border border-dashed border-line px-3 py-3 text-xs text-faint">{s.lastUsed ? `Idle — last used ${ago(s.lastUsed)}.` : "Hasn't worked yet."}</p>
              )}

              <div className="relative mt-4 grid grid-cols-3 gap-3">
                <Mini icon={MessageSquare} label="This week" value={week.length} />
                <Mini icon={week.length && ok === week.length ? CheckCircle2 : CircleAlert} label="Succeeded" value={week.length ? Math.round((ok / week.length) * 100) : null} suffix="%" />
                <Mini icon={Clock} label={u ? "Week used" : "Plan"} value={u?.week?.usedPct ?? null} suffix="%" fallback={u ? "—" : "free"} />
              </div>
              {u?.week?.usedPct != null && (
                <span className="relative mt-3 block h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                  <span className="meter-fill block h-full rounded-full" style={{ width: `${Math.min(100, u.week.usedPct)}%`, ["--meter" as string]: color, ["--meter-deep" as string]: color }} />
                </span>
              )}
            </Panel>
          );
        })}
        <Panel className="lift relative flex items-center gap-4 overflow-hidden p-5">
          <AgentLogo agent="codex-cloud" size="lg" />
          <div className="min-w-0 flex-1">
            <p className="text-lg font-semibold tracking-[-0.02em]">Codex cloud</p>
            <p className="text-xs text-muted">{AGENT_META["codex-cloud"].hint} — start it from the Talk sheet.</p>
          </div>
          <Cpu className="h-5 w-5 text-faint" />
        </Panel>
      </div>

      {recent.length > 0 && (
        <section className="mt-10">
          <SectionTitle>Recent asks and relays</SectionTitle>
          <Panel className="overflow-hidden">
            {recent.map((g) => (
              <Link key={g.id} href={`/agents/g/${g.id}`} className="flex min-h-16 items-center gap-3 border-b border-line px-4 py-3 last:border-0 hover:bg-white/[0.02]">
                <span className="w-14 shrink-0 text-xs text-muted">{g.kind === "relay" ? "Relay" : "Ask all"}</span>
                <span className="min-w-0 flex-1 truncate text-[15px]">{g.task.split("\n")[0]}</span>
                <span className="flex shrink-0 -space-x-1.5">
                  {[...new Set(g.agents)].map((a) => (
                    <AgentLogo key={a} agent={a as AgentKey} size="xs" />
                  ))}
                </span>
                <span className="w-14 shrink-0 text-right text-xs text-faint">{ago(g.at)}</span>
              </Link>
            ))}
          </Panel>
        </section>
      )}
    </div>
  );
}

function Mini({ icon: Icon, label, value, suffix = "", fallback = "—" }: { icon: typeof Clock; label: string; value: number | null; suffix?: string; fallback?: string }) {
  return (
    <div>
      <p className="flex items-center gap-1.5 text-[10px] text-faint">
        <Icon className="h-3 w-3" /> {label}
      </p>
      <p className="mt-0.5 text-lg font-semibold tracking-[-0.03em]">{value === null ? <span className="text-faint">{fallback}</span> : <CountUp value={value} suffix={suffix} />}</p>
    </div>
  );
}
