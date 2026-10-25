import { GitPullRequest, Plus } from "lucide-react";
import Link from "next/link";
import { Dot, Empty, PageHeader, Panel } from "@/components/kit";
import { AGENT_LABELS } from "@/lib/agents";
import { repoShort } from "@/lib/config";
import { agentIssues } from "@/lib/linear";
import { listJobs } from "@/lib/store";
import { ago, cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const FILTERS = [
  { key: "open", label: "Open" },
  { key: "claude", label: "Claude" },
  { key: "codex", label: "Codex" },
  { key: "cloud", label: "Codex cloud" },
  { key: "archived", label: "Archived" },
] as const;

type Row = { id: string; href: string; title: string; agent: string; tone: string; repo: string; status: string; at: string; pr?: string; live: boolean };

export default async function ChatsPage({ searchParams }: { searchParams: Promise<{ f?: string }> }) {
  const f = (await searchParams)?.f ?? "open";
  const jobs = listJobs();
  const cloud = f === "cloud" || f === "open" ? await agentIssues("codex-cloud", 30).catch(() => []) : [];

  const rows: Row[] = [
    ...jobs.map((j) => ({
      id: j.id,
      href: `/jobs/${j.id}`,
      title: j.title,
      agent: AGENT_LABELS[j.agent],
      tone: j.agent,
      repo: repoShort(j.repo),
      status: j.status,
      at: j.updatedAt,
      pr: j.prUrl,
      live: j.status === "running",
    })),
    ...cloud.map((i) => ({
      id: i.identifier,
      href: `/codex/${i.identifier}`,
      title: i.title,
      agent: "Codex cloud",
      tone: "hermes",
      repo: i.labels?.nodes?.find((l) => l.name.startsWith("repo:"))?.name.slice(5) ?? "",
      status: i.state?.type === "completed" || i.state?.type === "canceled" ? "closed" : (i.state?.name ?? "open"),
      at: i.updatedAt,
      live: false,
    })),
  ];

  const isOpen = (r: Row) => r.status !== "closed" && r.status !== "cancelled";
  const shown = rows
    .filter((r) =>
      f === "archived" ? !isOpen(r) : f === "claude" ? r.tone === "claude" && isOpen(r) : f === "codex" ? r.tone === "codex" && isOpen(r) : f === "cloud" ? r.tone === "hermes" && isOpen(r) : isOpen(r),
    )
    .sort((a, b) => b.at.localeCompare(a.at));

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Chats"
        sub="Every conversation with your agents, newest first."
        right={
          <Link href="/voice" className="flex items-center gap-2 rounded-full bg-text px-4 py-2 text-sm font-medium text-bg">
            <Plus className="h-4 w-4" /> New chat
          </Link>
        }
      />
      <nav className="-mx-4 mb-4 flex gap-1.5 overflow-x-auto px-4 pb-1" aria-label="Filter chats">
        {FILTERS.map((x) => (
          <Link
            key={x.key}
            href={x.key === "open" ? "/chat" : `/chat?f=${x.key}`}
            aria-current={f === x.key ? "page" : undefined}
            className={cn(
              "shrink-0 rounded-full border px-3.5 py-1.5 text-sm transition-colors",
              f === x.key ? "border-transparent bg-white text-bg" : "border-line text-muted hover:text-text",
            )}
          >
            {x.label}
          </Link>
        ))}
      </nav>
      <Panel className="overflow-hidden">
        {shown.length === 0 ? (
          <Empty>{f === "archived" ? "Nothing archived yet." : "No chats here. Tap the orb to start one."}</Empty>
        ) : (
          shown.map((r) => (
            <Link key={r.id} href={r.href} className="flex min-h-16 items-center gap-3 border-b border-line px-4 py-3 last:border-0 hover:bg-white/[0.02]">
              <Dot tone={r.tone} pulse={r.live} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px]">{r.title}</span>
                <span className="block truncate text-xs text-muted">
                  {r.agent}
                  {r.repo && ` · ${r.repo}`} · {r.status}
                </span>
              </span>
              {r.pr && <GitPullRequest className="h-4 w-4 shrink-0 text-muted" aria-label="Has a pull request" />}
              <span className="w-14 shrink-0 text-right text-xs text-faint">{ago(r.at)}</span>
            </Link>
          ))
        )}
      </Panel>
    </div>
  );
}
