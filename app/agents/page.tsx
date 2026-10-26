import Link from "next/link";
import { AgentLogo } from "@/components/agent-logo";
import { AgentsConsole } from "@/components/agents-console";
import { PageHeader, Panel, SectionTitle } from "@/components/kit";
import { agentStatuses } from "@/lib/agent-status";
import { AGENT_LABELS, AGENT_META, type AgentKey } from "@/lib/agents";
import { listRepos } from "@/lib/github";
import { listJobs } from "@/lib/store";
import { ago } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function AgentsPage() {
  const [statuses, repos] = await Promise.all([agentStatuses(), listRepos().catch(() => [])]);
  // Recent ask-all and relay runs, newest first, one row per group.
  const groups = new Map<string, { id: string; kind: string; task: string; at: string; agents: string[] }>();
  for (const j of listJobs()) {
    if (!j.group) continue;
    const g = groups.get(j.group.id) ?? { id: j.group.id, kind: j.group.kind, task: j.group.task, at: j.updatedAt, agents: [] };
    g.agents.push(j.agent);
    if (j.updatedAt > g.at) g.at = j.updatedAt;
    groups.set(j.group.id, g);
  }
  const recent = [...groups.values()].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 6);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Agents" sub="Claude, Codex, OpenCode and Hermes from one place. Light them up and ask." />
      <AgentsConsole statuses={statuses} repos={repos.map((r) => r.name)} />

      <section className="mt-10">
        <SectionTitle>Your agents</SectionTitle>
        <Panel className="overflow-hidden">
          {statuses.map((s) => (
            <div key={s.agent} className="flex min-h-16 items-center gap-3 border-b border-line px-4 py-3 last:border-0">
              <AgentLogo agent={s.agent} size="md" state={!s.ready ? "off" : s.busy ? "working" : "ready"} />
              <span className="min-w-0 flex-1">
                <span className="block text-[15px]">{AGENT_LABELS[s.agent]}</span>
                <span className="block truncate text-xs text-muted">{s.ready ? AGENT_META[s.agent].hint : s.note}</span>
              </span>
              <span className={s.ready ? "shrink-0 text-xs text-faint" : "shrink-0 text-xs text-warn"}>
                {s.ready ? (s.busy ? "working" : s.lastUsed ? `used ${ago(s.lastUsed)}` : "ready") : "not set up"}
              </span>
            </div>
          ))}
          <div className="flex min-h-16 items-center gap-3 px-4 py-3">
            <AgentLogo agent="codex-cloud" size="md" />
            <span className="min-w-0 flex-1">
              <span className="block text-[15px]">Codex cloud</span>
              <span className="block truncate text-xs text-muted">{AGENT_META["codex-cloud"].hint} — start it from the Talk sheet</span>
            </span>
          </div>
        </Panel>
      </section>

      {recent.length > 0 && (
        <section className="mt-8">
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
