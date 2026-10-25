import { ArrowUpRight, GitCommitHorizontal, Newspaper, Timer } from "lucide-react";
import { Dot, Empty, PageHeader, Panel, SectionTitle } from "@/components/kit";
import { ago, cn } from "@/lib/utils";
import { siteHealth } from "@/lib/website";

export const dynamic = "force-dynamic";

export default async function WebsitePage() {
  const s = await siteHealth();
  const bad = s.units.filter((u) => u.result && u.result !== "success");

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="383ks.com"
        sub={s.up ? (bad.length ? `Up, but ${bad.length} scheduled job${bad.length > 1 ? "s" : ""} failed.` : "Up and publishing.") : "Not answering."}
        right={
          <a href={s.url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 rounded-full border border-line px-4 py-2 text-sm text-muted hover:border-line-hi hover:text-text">
            Open site <ArrowUpRight className="h-4 w-4" />
          </a>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Panel className="p-5">
          <p className="flex items-center gap-2 text-xs text-muted">
            <Dot tone={s.up ? "ok" : "bad"} pulse={s.up} /> Status
          </p>
          <p className="tnum mt-3 text-3xl font-semibold tracking-[-0.04em]">{s.up ? `${s.ms} ms` : "Down"}</p>
          <p className="mt-1 text-xs text-faint">{s.up ? "deployment-info response, just now" : s.error}</p>
        </Panel>
        <Panel className="p-5">
          <p className="flex items-center gap-2 text-xs text-muted">
            <GitCommitHorizontal className="h-4 w-4" strokeWidth={1.75} /> Deployed
          </p>
          {s.deploy ? (
            <>
              <a
                href={`https://github.com/Lind-hack/383lajme/commit/${s.deploy.sha}`}
                target="_blank"
                rel="noreferrer"
                className="mt-3 block font-mono text-3xl font-semibold tracking-[-0.04em] hover:text-codex"
              >
                {s.deploy.sha.slice(0, 7)}
              </a>
              <p className={cn("mt-1 text-xs", s.deploy.verified ? "text-ok" : "text-warn")}>
                {s.deploy.verified ? "main · production · from GitHub" : `${s.deploy.ref} · ${s.deploy.environment} · ${s.deploy.source} — not a verified main deploy`}
              </p>
            </>
          ) : (
            <p className="mt-3 text-sm text-muted">No deploy info.</p>
          )}
        </Panel>
        <Panel className="p-5">
          <p className="flex items-center gap-2 text-xs text-muted">
            <Newspaper className="h-4 w-4" strokeWidth={1.75} /> Last article
          </p>
          {s.latest ? (
            <>
              <p className="mt-3 text-3xl font-semibold tracking-[-0.04em]">{ago(s.latest.at)}</p>
              <a href={s.latest.url} target="_blank" rel="noreferrer" className="mt-1 line-clamp-2 text-xs text-muted hover:text-text">
                {s.latest.category && `${s.latest.category} · `}
                {s.latest.title}
              </a>
            </>
          ) : (
            <p className="mt-3 text-sm text-muted">Couldn't read the latest article.</p>
          )}
        </Panel>
      </div>

      <section className="mt-8">
        <SectionTitle right="next run">Scheduled on the VPS</SectionTitle>
        <Panel className="overflow-hidden">
          {s.units.length === 0 ? (
            <Empty>No 383 timers found on the VPS.</Empty>
          ) : (
            s.units.map((u) => {
              const failed = u.result && u.result !== "success";
              return (
                <div key={u.timer} className="flex min-h-14 items-center gap-3 border-b border-line px-4 py-3 last:border-0">
                  <Dot tone={failed ? "bad" : u.active === "active" ? "claude" : "ok"} pulse={u.active === "active"} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-[13px]">{u.timer.replace(/\.timer$/, "")}</span>
                    <span className="block text-xs text-muted">
                      {u.active === "active" ? "running now" : failed ? `last run failed (${u.result})` : `last run ${ago(u.last)}`}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted">
                    <Timer className="h-3.5 w-3.5" strokeWidth={1.75} />
                    {u.next ? ago(u.next) : "—"}
                  </span>
                </div>
              );
            })
          )}
        </Panel>
      </section>
    </div>
  );
}
