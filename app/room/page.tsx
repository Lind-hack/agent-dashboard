import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { AgentLogo } from "@/components/agent-logo";
import { PageHeader, Panel } from "@/components/kit";
import { RoomLauncher, type LauncherAgent } from "@/components/room-launcher";
import { agentStatuses } from "@/lib/agent-status";
import { listRepos } from "@/lib/github";
import { agentModels, judgeModelName, listRooms, type Room } from "@/lib/rooms";
import { planUsage } from "@/lib/usage";
import { ago, cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const STATUS: Record<Room["status"], string> = {
  queued: "waiting to start",
  evidence: "reading the repo",
  debating: "debating",
  judging: "judge is scoring",
  done: "verdict",
  cancelled: "stopped",
  refused: "refused",
};

export default async function RoomPage({ searchParams }: { searchParams: Promise<{ task?: string; mode?: string }> }) {
  const sp = await searchParams;
  const initialMode = sp?.mode === "solo" || sp?.mode === "team" ? sp.mode : "roast";
  const [statuses, repos] = await Promise.all([agentStatuses().catch(() => []), listRepos().catch(() => [])]);
  const usage = planUsage();
  const models = agentModels();
  const agents: LauncherAgent[] = statuses.map((s) => ({
    agent: s.agent,
    ready: s.ready,
    busy: s.busy,
    note: s.note,
    model: models[s.agent],
    weeklyPct: s.agent === "claude" ? (usage.claude.week?.usedPct ?? null) : s.agent === "codex" ? (usage.codex.week?.usedPct ?? null) : null,
  }));
  const rooms = listRooms().slice(0, 12);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Room" sub="Put your agents on one task — alone, as a team, or in a roast until they agree." />
      <RoomLauncher agents={agents} repos={repos.map((r) => r.name)} judgeModel={judgeModelName()} initialTask={(sp?.task ?? "").slice(0, 2000)} initialMode={initialMode} />

      {rooms.length > 0 && (
        <section className="mt-10">
          <h2 className="hud-label mb-2.5 px-1 !text-[11px] !text-muted">Recent roasts</h2>
          <Panel className="overflow-hidden">
            {rooms.map((r) => (
              <Link key={r.id} href={`/room/${r.id}`} className="flex min-h-16 items-center gap-3 border-b border-line px-3 py-2.5 last:border-0 hover:bg-white/[0.02]">
                <span className="flex shrink-0 -space-x-2">
                  {r.agents.map((a) => (
                    <AgentLogo key={a} agent={a} size="sm" state={r.status === "debating" ? "working" : "ready"} />
                  ))}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px]">{r.task.split("\n")[0]}</span>
                  <span className={cn("block font-mono text-[11px]", r.verdict?.outcome === "consensus" ? "text-ok" : "text-faint")}>
                    {r.status === "done" ? (r.verdict?.outcome ?? "done") : STATUS[r.status]}
                    {r.rounds.length > 0 && ` · ${r.rounds.length} round${r.rounds.length > 1 ? "s" : ""}`}
                    {r.rounds.at(-1)?.judge && ` · ${r.rounds.at(-1)!.judge!.agreement}% agree`}
                  </span>
                </span>
                <span className="tnum shrink-0 font-mono text-[11px] text-faint">{ago(r.createdAt).replace(" ago", "")}</span>
                <ChevronRight className="h-4 w-4 shrink-0 text-faint" aria-hidden />
              </Link>
            ))}
          </Panel>
        </section>
      )}
    </div>
  );
}
