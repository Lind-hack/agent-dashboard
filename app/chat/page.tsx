import { GitPullRequest, Plus } from "lucide-react";
import Link from "next/link";
import { AgentLogo } from "@/components/agent-logo";
import { ChatBoard } from "@/components/chat-board";
import { Empty, PageHeader, Panel, Segmented, StatusPill } from "@/components/kit";
import { AGENT_LABELS, type TaskAgent } from "@/lib/agents";
import { liveChats } from "@/lib/chat-live";
import { repoShort } from "@/lib/config";
import { agentIssues } from "@/lib/linear";
import { listJobs } from "@/lib/store";
import { ago } from "@/lib/utils";

export const dynamic = "force-dynamic";

type Row = { id: string; href: string; title: string; agent: TaskAgent; repo: string; status: string; at: string; pr?: string };
type Filter = "open" | "turn" | "claude" | "codex" | "cloud" | "archived";

const isOpen = (r: Row) => r.status !== "closed" && r.status !== "cancelled";

// What each status means for Lind, as a pill.
function pill(status: string) {
  if (status === "running") return { tone: "live" as const, label: "Running", pulse: true };
  if (status === "queued") return { tone: "live" as const, label: "Queued" };
  if (status === "waiting") return { tone: "ok" as const, label: "Your turn" };
  if (status === "failed") return { tone: "bad" as const, label: "Failed" };
  if (status === "preparing") return { tone: "live" as const, label: "Preparing" };
  if (status === "closed" || status === "cancelled") return { tone: "neutral" as const, label: status === "closed" ? "Done" : "Stopped" };
  return { tone: "neutral" as const, label: status };
}

export default async function ChatsPage({ searchParams }: { searchParams: Promise<{ f?: string }> }) {
  const raw = (await searchParams)?.f ?? "open";
  const f: Filter = (["open", "turn", "claude", "codex", "cloud", "archived"] as const).includes(raw as Filter) ? (raw as Filter) : "open";
  const jobs = listJobs();
  const cloud = await agentIssues("codex-cloud", 30).catch(() => []);

  const rows: Row[] = [
    ...jobs.map((j) => ({ id: j.id, href: `/jobs/${j.id}`, title: j.title, agent: j.agent as TaskAgent, repo: repoShort(j.repo), status: j.status, at: j.updatedAt, pr: j.prUrl })),
    ...cloud.map((i) => ({
      id: i.identifier,
      href: `/codex/${i.identifier}`,
      title: i.title,
      agent: "codex-cloud" as const,
      repo: i.labels?.nodes?.find((l) => l.name.startsWith("repo:"))?.name.slice(5) ?? "",
      status: i.state?.type === "completed" || i.state?.type === "canceled" ? "closed" : (i.state?.name ?? "open"),
      at: i.updatedAt,
    })),
  ];

  const by: Record<Filter, (r: Row) => boolean> = {
    open: isOpen,
    turn: (r) => r.status === "waiting" || r.status === "failed",
    claude: (r) => r.agent === "claude" && isOpen(r),
    codex: (r) => r.agent === "codex" && isOpen(r),
    cloud: (r) => r.agent === "codex-cloud" && isOpen(r),
    archived: (r) => !isOpen(r),
  };
  const shown = rows.filter(by[f]).sort((a, b) => b.at.localeCompare(a.at));
  const count = (k: Filter) => rows.filter(by[k]).length;
  const running = rows.filter((r) => r.status === "running").length;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Chats"
        sub="Who's working on what, the step each agent is on, and what's waiting on you."
        readout={[`${count("open")} open`, running > 0 && `${running} running`, count("turn") > 0 && `${count("turn")} waiting on you`]}
        right={
          <Link href="/voice" className="flex h-10 items-center gap-2 rounded-[12px] bg-text px-4 text-sm font-medium text-bg hover:bg-white">
            <Plus className="h-4 w-4" aria-hidden /> New chat
          </Link>
        }
      />
      <ChatBoard initial={liveChats()} />
      <Segmented
        label="Filter chats"
        current={f}
        items={[
          { key: "open", label: "Open", href: "/chat", count: count("open") },
          { key: "turn", label: "Your turn", href: "/chat?f=turn", count: count("turn") },
          { key: "claude", label: "Claude", href: "/chat?f=claude" },
          { key: "codex", label: "Codex", href: "/chat?f=codex" },
          { key: "cloud", label: "Codex cloud", href: "/chat?f=cloud" },
          { key: "archived", label: "Archived", href: "/chat?f=archived" },
        ]}
      />
      <Panel className="overflow-hidden">
        {shown.length === 0 ? (
          <Empty>{f === "archived" ? "Nothing archived yet." : f === "turn" ? "Nothing is waiting on you." : "No chats here. Start one with Talk or ⌘K."}</Empty>
        ) : (
          shown.map((r) => {
            const p = pill(r.status);
            return (
              <Link key={r.id} href={r.href} className="group flex min-h-16 items-center gap-3 border-b border-line px-3 py-2.5 last:border-0 hover:bg-white/[0.025]">
                <AgentLogo agent={r.agent} size="md" state={r.status === "running" ? "working" : isOpen(r) ? "ready" : "idle"} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px]">{r.title}</span>
                  <span className="block truncate font-mono text-[11px] text-faint">
                    {AGENT_LABELS[r.agent]}
                    {r.repo && ` · ${r.repo}`}
                  </span>
                </span>
                {r.pr && <GitPullRequest className="h-4 w-4 shrink-0 text-muted" aria-label="Has a pull request" />}
                <span className="flex shrink-0 flex-col items-end gap-1">
                  <StatusPill tone={p.tone} pulse={p.pulse}>
                    {p.label}
                  </StatusPill>
                  <span className="tnum font-mono text-[10.5px] text-faint">{ago(r.at).replace(" ago", "")}</span>
                </span>
              </Link>
            );
          })
        )}
      </Panel>
    </div>
  );
}
