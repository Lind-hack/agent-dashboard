import Link from "next/link";
import { AGENT_LABELS } from "@/lib/agents";
import { repoShort } from "@/lib/config";
import { agentIssues, type LinearIssue } from "@/lib/linear";
import { failedUnits, timers, type TimerRow } from "@/lib/ops";
import { listJobs, readHeartbeat, type Job } from "@/lib/store";
import { ago, cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

async function safe<T>(p: Promise<T>): Promise<{ data?: T; error?: string }> {
  try {
    return { data: await p };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

const statusTone: Record<string, string> = {
  running: "text-accent",
  queued: "text-warn",
  waiting: "text-ok",
  failed: "text-bad",
  cancelled: "text-muted",
  closed: "text-muted",
};

function Section({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">{title}</h2>
        {right}
      </div>
      <div className="overflow-hidden rounded-xl border border-line bg-panel">{children}</div>
    </section>
  );
}

const Empty = ({ children }: { children: React.ReactNode }) => <p className="px-4 py-5 text-sm text-muted">{children}</p>;

function JobRow({ job }: { job: Job }) {
  const last = job.turns.at(-1);
  return (
    <Link href={`/jobs/${job.id}`} className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-0 hover:bg-white/[0.02]">
      <span className="w-14 shrink-0 text-xs text-accent">{AGENT_LABELS[job.agent ?? "claude"]}</span>
      <span className="hidden w-24 shrink-0 font-mono text-xs text-muted sm:inline">{job.id}</span>
      <span className="min-w-0 flex-1 truncate text-sm">{job.title}</span>
      <span className="hidden text-xs text-muted sm:inline">{repoShort(job.repo ?? "")}</span>
      {job.prUrl && <span className="text-xs text-muted">PR</span>}
      <span className={cn("w-16 text-right text-xs", statusTone[job.status])}>{job.status}</span>
      <span className="w-16 text-right text-xs text-muted">{ago(last?.endedAt ?? last?.startedAt ?? job.updatedAt)}</span>
    </Link>
  );
}

function CodexRow({ issue }: { issue: LinearIssue }) {
  return (
    <Link href={`/codex/${issue.identifier}`} className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-0 hover:bg-white/[0.02]">
      <span className="w-20 shrink-0 font-mono text-xs text-muted">{issue.identifier}</span>
      <span className="min-w-0 flex-1 truncate text-sm">{issue.title}</span>
      <span className="w-24 text-right text-xs">{issue.state?.name ?? "—"}</span>
      <span className="w-16 text-right text-xs text-muted">{ago(issue.updatedAt)}</span>
    </Link>
  );
}

function TimerTable({ rows }: { rows: TimerRow[] }) {
  return (
    <div className="divide-y divide-line">
      {rows.map((r) => {
        const bad = r.result && r.result !== "success";
        return (
          <div key={r.timer} className="flex items-center gap-3 px-4 py-2.5 text-sm">
            <span className={cn("h-2 w-2 shrink-0 rounded-full", bad ? "bg-bad" : r.active === "active" ? "bg-accent" : "bg-ok")} />
            <span className="min-w-0 flex-1 truncate font-mono text-xs">{r.timer.replace(/\.timer$/, "")}</span>
            <span className="hidden w-28 text-right text-xs text-muted sm:inline">last {ago(r.last)}</span>
            <span className="w-24 text-right text-xs">{r.next ? ago(r.next) : "—"}</span>
            {bad && <span className="text-xs text-bad">{r.result}</span>}
          </div>
        );
      })}
    </div>
  );
}

export default async function Overview() {
  const jobs = listJobs();
  const heartbeat = readHeartbeat();
  const [codex, timerRows, failed] = await Promise.all([safe(agentIssues("codex-cloud", 15)), safe(timers()), safe(failedUnits())]);
  const runnerAlive = heartbeat.at && Date.now() - new Date(heartbeat.at).getTime() < 60_000;
  const open = jobs.filter((j) => j.status !== "closed" && j.status !== "cancelled");
  const closed = jobs.filter((j) => j.status === "closed" || j.status === "cancelled").slice(0, 10);

  return (
    <>
      <div className="mb-8 flex flex-wrap items-center gap-3 text-sm">
        <span className={cn("rounded-full border px-3 py-1", runnerAlive ? "border-ok/40 text-ok" : "border-bad/40 text-bad")}>
          runner {runnerAlive ? (heartbeat.active?.length ? `working on ${heartbeat.active.join(", ")}` : "idle") : `down (seen ${ago(heartbeat.at)})`}
        </span>
        {failed.data && failed.data.length > 0 && (
          <span className="rounded-full border border-bad/40 px-3 py-1 text-bad">
            {failed.data.length} failed unit{failed.data.length > 1 ? "s" : ""}: {failed.data.map((u) => u.unit).join(", ")}
          </span>
        )}
        <Link href="/voice" className="ml-auto rounded-full bg-accent px-4 py-1.5 font-medium text-bg">
          + New chat
        </Link>
      </div>

      <Section title="Claude & Codex · on the VPS">
        {open.length ? (
          open.map((j) => <JobRow key={j.id} job={j} />)
        ) : (
          <Empty>Nothing open. Start a chat, or add the agent:claude / agent:codex label to a Linear issue.</Empty>
        )}
      </Section>

      <Section title="Codex cloud · via Linear">
        {codex.error ? <Empty>{codex.error}</Empty> : codex.data?.length ? codex.data.map((i) => <CodexRow key={i.id} issue={i} />) : <Empty>No Codex cloud tasks.</Empty>}
      </Section>

      <Section title="Scheduled on the VPS" right={<span className="text-xs text-muted">next run →</span>}>
        {timerRows.error ? <Empty>systemd: {timerRows.error}</Empty> : <TimerTable rows={timerRows.data ?? []} />}
      </Section>

      {closed.length > 0 && <Section title="Recently closed">{closed.map((j) => <JobRow key={j.id} job={j} />)}</Section>}
    </>
  );
}
