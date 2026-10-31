import { Activity, ArrowUpRight, Database, Gauge, GitCommitHorizontal, Globe, HardDrive, Newspaper, Search, Timer, TriangleAlert, Users } from "lucide-react";
import { Dot, Empty, Panel, SectionTitle } from "@/components/kit";
import { CountUp, SectionHero } from "@/components/motion";
import { gaState, traffic } from "@/lib/ga4";
import { readDb, readDeploys, readIncidents, readPsi, readSeo, summarize, type ProbeSummary, type Psi } from "@/lib/monitor";
import { failedUnits } from "@/lib/ops";
import { ago, cn } from "@/lib/utils";
import { siteHealth } from "@/lib/website";

export const dynamic = "force-dynamic";

const fmtBytes = (b?: number) => (b === undefined ? "—" : b > 1e9 ? `${(b / 1e9).toFixed(2)} GB` : b > 1e6 ? `${(b / 1e6).toFixed(0)} MB` : `${Math.round(b / 1e3)} KB`);
const fmtMs = (ms?: number | null) => (ms == null ? "—" : ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`);
const tone = (n: number) => (n >= 90 ? "text-ok" : n >= 50 ? "text-warn" : "text-bad");

// 383ks.com, in depth: uptime and latency per endpoint (3-minute probes, 30 days kept), incidents,
// deploy history, Core Web Vitals (PageSpeed every 6 h), daily SEO checks, GA4 traffic, Supabase health
// (root timer) and the VPS jobs that publish the news.
export default async function WebsitePage() {
  const [s, t, failed] = await Promise.all([siteHealth(), traffic().catch(() => null), failedUnits().catch(() => [])]);
  const { probes, overall24h, overall7d } = summarize();
  const incidents = readIncidents();
  const open = incidents.filter((i) => !i.endedAt);
  const deploys = readDeploys().slice(-8).reverse();
  const psi = readPsi();
  const seo = readSeo();
  const db = readDb();
  const ga = gaState();
  const badUnits = s.units.filter((u) => u.result && u.result !== "success");
  const bloated = (db?.db.tables ?? []).filter((x) => x.dead > x.rows && x.bytes > 50e6);

  return (
    <div className="mx-auto max-w-6xl">
      <SectionHero
        clip="today"
        eyebrow={[open.length ? `${open.length} open incident${open.length > 1 ? "s" : ""}` : "no open incidents", overall24h !== null && `${overall24h}% up · 24 h`, badUnits.length > 0 && `${badUnits.length} jobs failing`].filter(Boolean).join(" · ")}
        title="383ks.com"
        sub={!s.up ? "Not answering right now." : open.length ? "Up, with an open incident below." : badUnits.length ? `Up — but ${badUnits.length} scheduled job${badUnits.length > 1 ? "s" : ""} failed.` : "Up, fast and publishing."}
        right={
          <a href={s.url} target="_blank" rel="noreferrer" className="press flex h-10 items-center gap-1.5 rounded-[12px] border border-line bg-black/30 px-4 text-sm text-muted backdrop-blur-md hover:border-line-hi hover:text-text">
            Open site <ArrowUpRight className="h-4 w-4" />
          </a>
        }
      />

      {/* The vitals strip */}
      <div className="stagger grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={Activity} label="Uptime 24 h" value={overall24h} suffix="%" sub={overall7d !== null ? `${overall7d}% over 7 days` : "probing every 3 minutes"} good={(overall24h ?? 100) >= 99.5} decimals={2} />
        <Stat icon={Gauge} label="Home p95" value={probes.find((p) => p.key === "home")?.p95 ?? null} suffix=" ms" sub={`p50 ${fmtMs(probes.find((p) => p.key === "home")?.p50)}`} good={(probes.find((p) => p.key === "home")?.p95 ?? 0) < 1500} />
        <Stat icon={Users} label="Readers today" value={t && !t.error ? t.today.users : null} sub={t && !t.error ? `${t.realtime ?? 0} right now · ${t.yesterday.users} yesterday` : ga === "ready" ? (t?.error ?? "GA4 unavailable") : "connect GA4 below"} good />
        <Stat icon={Newspaper} label="Articles today" value={seo?.articlesToday ?? null} sub={s.latest ? `last ${ago(s.latest.at)}` : "—"} good={(seo?.articlesToday ?? 1) > 0} />
      </div>

      {open.length > 0 && (
        <section className="mt-6">
          {open.map((i) => (
            <p key={i.id} className="land flex items-center gap-3 rounded-[14px] border border-bad/35 bg-bad/[0.07] px-4 py-3 text-sm">
              <TriangleAlert className="h-4 w-4 shrink-0 text-bad" />
              <span className="flex-1">
                <b className="font-medium">{probes.find((p) => p.key === i.key)?.label ?? i.key}</b> failing since {ago(i.startedAt)} — {i.reason} ({i.failures} probes in a row)
              </span>
            </p>
          ))}
        </section>
      )}

      {/* Endpoints */}
      <section className="mt-8">
        <SectionTitle right="last 24 h · 30-min buckets">Endpoints</SectionTitle>
        <Panel className="overflow-hidden">
          {probes.every((p) => !p.last) ? (
            <Empty>The first probes land within 3 minutes of the runner starting.</Empty>
          ) : (
            probes.map((p) => <ProbeRow key={p.key} p={p} />)
          )}
        </Panel>
      </section>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        {/* Core Web Vitals */}
        <section>
          <SectionTitle right={psi.mobile ? `PageSpeed · ${ago(psi.mobile.at)}` : "every 6 h"}>Core Web Vitals</SectionTitle>
          <Panel className="p-5">
            {!psi.mobile && !psi.desktop ? (
              <p className="text-sm text-muted">The first PageSpeed run happens shortly after the runner starts.</p>
            ) : (
              <div className="grid gap-5 sm:grid-cols-2">
                {[psi.mobile, psi.desktop].filter((x): x is Psi => !!x).map((x) => (
                  <div key={x.strategy}>
                    <p className="hud-label mb-3">{x.strategy}</p>
                    {x.error ? (
                      <p className="text-xs text-warn">{x.error}</p>
                    ) : (
                      <>
                        <div className="grid grid-cols-4 gap-2 text-center">
                          {(
                            [
                              ["Perf", x.performance],
                              ["SEO", x.seo],
                              ["A11y", x.accessibility],
                              ["Best", x.bestPractices],
                            ] as const
                          ).map(([k, v]) => (
                            <div key={k}>
                              <p className={cn("text-xl font-semibold tracking-[-0.03em]", tone(v))}>
                                <CountUp value={v} />
                              </p>
                              <p className="text-[10px] text-faint">{k}</p>
                            </div>
                          ))}
                        </div>
                        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                          <Kv k="LCP" v={fmtMs(x.lcp)} bad={(x.lcp ?? 0) > 2500} />
                          <Kv k="CLS" v={x.cls !== undefined ? x.cls.toFixed(3) : "—"} bad={(x.cls ?? 0) > 0.1} />
                          <Kv k="TBT" v={fmtMs(x.tbt)} bad={(x.tbt ?? 0) > 300} />
                          <Kv k="FCP" v={fmtMs(x.fcp)} bad={(x.fcp ?? 0) > 1800} />
                        </dl>
                        {x.field?.lcp && <p className="mt-2 text-[11px] text-faint">Real users (CrUX): LCP {x.field.lcp.toLowerCase()} · CLS {x.field.cls?.toLowerCase() ?? "—"} · INP {x.field.inp?.toLowerCase() ?? "—"}</p>}
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </section>

        {/* SEO */}
        <section>
          <SectionTitle right={seo ? `daily · ${ago(seo.at)}` : "daily"}>SEO health</SectionTitle>
          <Panel className="overflow-hidden">
            {!seo ? (
              <Empty>The first SEO check runs shortly after the runner starts.</Empty>
            ) : (
              <>
                <div className="flex items-center gap-3 border-b border-line px-4 py-3">
                  <Search className="h-4 w-4 text-hermes" />
                  <span className={cn("text-xl font-semibold", tone(seo.score))}>{seo.score}%</span>
                  <span className="text-xs text-muted">of checks pass{seo.latestAgeMin !== undefined ? ` · newest article ${seo.latestAgeMin < 120 ? `${seo.latestAgeMin} min` : `${Math.round(seo.latestAgeMin / 60)} h`} old` : ""}</span>
                </div>
                <ul>
                  {seo.checks.map((c) => (
                    <li key={c.name} className="flex items-start gap-3 border-b border-line px-4 py-2.5 text-[13px] last:border-0">
                      <Dot tone={c.ok ? "ok" : "warn"} />
                      <span className="w-40 shrink-0">{c.name}</span>
                      <span className="min-w-0 flex-1 truncate text-muted" title={c.detail}>
                        {c.detail}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Panel>
        </section>
      </div>

      {/* Traffic */}
      <section className="mt-8">
        <SectionTitle right={t?.at ? `GA4 · ${ago(t.at)}` : "GA4"}>Traffic</SectionTitle>
        {ga !== "ready" ? (
          <Panel className="p-5 text-sm leading-relaxed text-muted">
            <p className="text-text">Connect Google Analytics 4 — two steps:</p>
            <ol className="mt-2 list-decimal space-y-1 pl-5">
              {ga === "no-property" && (
                <li>
                  On the VPS: <code className="font-mono text-text">echo &apos;GA4_PROPERTY_ID=123456789&apos; | sudo tee -a /etc/agent-dashboard.env</code> — the number from GA4 → Admin → Property details.
                </li>
              )}
              <li>
                On the PC: <code className="font-mono text-text">node &quot;C:\Users\PC1\Desktop\claude\agent-dashboard-v3\handoff\google-auth.mjs&quot;</code> — allow &quot;See your Google Analytics data&quot;.
              </li>
            </ol>
          </Panel>
        ) : t?.error ? (
          <Panel className="p-5 text-sm text-warn">{t.error}</Panel>
        ) : t ? (
          <div className="grid gap-4 lg:grid-cols-3">
            <Panel className="p-5">
              <p className="hud-label">Last 7 days · users</p>
              <div className="mt-4 flex h-28 items-end gap-2">
                {t.week.map((d, i) => {
                  const max = Math.max(1, ...t.week.map((x) => x.users));
                  return (
                    <span key={d.day} className="flex flex-1 flex-col items-center gap-1">
                      <span className="tnum font-mono text-[10px] text-faint">{d.users}</span>
                      <span className="w-full origin-bottom animate-[grow_700ms_var(--ease-out-expo)_both] rounded-[5px] motion-reduce:animate-none" style={{ height: `${Math.max(4, (d.users / max) * 80)}px`, background: i === t.week.length - 1 ? "#e879c9" : "rgb(179 146 240 / 0.55)", animationDelay: `${i * 50}ms` }} />
                      <span className="font-mono text-[9px] text-faint">{new Date(`${d.day}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "narrow", timeZone: "UTC" })}</span>
                    </span>
                  );
                })}
              </div>
              <p className="mt-3 text-xs text-muted">
                {t.today.views} views today · {t.today.users >= t.yesterday.users ? "▲" : "▼"} {Math.abs(t.today.users - t.yesterday.users)} users vs yesterday
              </p>
            </Panel>
            <Panel className="overflow-hidden lg:col-span-2">
              <p className="hud-label border-b border-line px-4 py-3">Top pages today</p>
              {t.topPages.length === 0 ? (
                <Empty>No views yet today.</Empty>
              ) : (
                t.topPages.map((p) => (
                  <a key={p.path} href={`${s.url}${p.path}`} target="_blank" rel="noreferrer" className="flex items-center gap-3 border-b border-line px-4 py-2.5 text-[13px] last:border-0 hover:bg-white/[0.02]">
                    <span className="min-w-0 flex-1 truncate">{p.title || p.path}</span>
                    <span className="tnum font-mono text-xs text-muted">{p.views}</span>
                  </a>
                ))
              )}
              {t.sources.length > 0 && <p className="border-t border-line px-4 py-2.5 text-[11px] text-faint">From: {t.sources.map((x) => `${x.source} ${x.users}`).join(" · ")}</p>}
            </Panel>
          </div>
        ) : null}
      </section>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        {/* Database */}
        <section>
          <SectionTitle right={db ? `every 5 min · ${ago(db.at)}` : "root timer"}>Supabase database</SectionTitle>
          <Panel className="p-5">
            {!db ? (
              <p className="text-sm leading-relaxed text-muted">
                Install the read-only DB health timer once, on the VPS:
                <code className="mt-2 block font-mono text-text">bash /opt/agent-dashboard/deploy/install-db-stats.sh</code>
              </p>
            ) : db.db.error ? (
              <p className="text-sm text-bad">{db.db.error}</p>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-3">
                  <Mini icon={HardDrive} label="Size" value={fmtBytes(db.db.size_bytes)} />
                  <Mini icon={Database} label="Connections" value={`${db.db.connections ?? "—"} / ${db.db.max_connections ?? "—"}`} warn={(db.db.connections ?? 0) > (db.db.max_connections ?? 100) * 0.8} />
                  <Mini icon={Gauge} label="Cache hits" value={db.db.cache_hit !== undefined ? `${db.db.cache_hit}%` : "—"} warn={(db.db.cache_hit ?? 100) < 95} />
                </div>
                <p className={cn("mt-4 flex items-center gap-2 text-xs", db.backup && Date.now() - Date.parse(db.backup.at) < 36 * 3600_000 && db.backup_unit === "success" ? "text-ok" : "text-warn")}>
                  <Dot tone={db.backup && Date.now() - Date.parse(db.backup.at) < 36 * 3600_000 ? "ok" : "warn"} />
                  {db.backup ? `Encrypted backup ${ago(db.backup.at)} · ${fmtBytes(db.backup.bytes)} · last run ${db.backup_unit}` : "No backup file found"}
                </p>
                {bloated.length > 0 && (
                  <p className="mt-3 rounded-[10px] border border-warn/30 bg-warn/[0.06] px-3 py-2 text-xs text-warn">
                    Bloat: {bloated.map((b) => `${b.name.replace("public.", "")} is ${fmtBytes(b.bytes)} for ${b.rows.toLocaleString("en")} rows (${b.dead.toLocaleString("en")} dead)`).join("; ")} — a VACUUM FULL or retention job would reclaim it.
                  </p>
                )}
                {(db.db.long_queries?.length ?? 0) > 0 && <p className="mt-3 text-xs text-bad">{db.db.long_queries!.length} queries running over 30 s — longest {db.db.long_queries![0].seconds}s</p>}
                <details className="mt-4 text-xs">
                  <summary className="cursor-pointer text-muted hover:text-text">Largest tables{(db.db.slow?.length ?? 0) > 0 ? " and slowest queries" : ""}</summary>
                  <ul className="mt-2 flex flex-col gap-1">
                    {(db.db.tables ?? []).map((x) => (
                      <li key={x.name} className="flex gap-3">
                        <span className="min-w-0 flex-1 truncate font-mono">{x.name.replace("public.", "")}</span>
                        <span className="tnum text-muted">{fmtBytes(x.bytes)}</span>
                        <span className="tnum w-20 text-right text-faint">{x.rows.toLocaleString("en")} rows</span>
                      </li>
                    ))}
                  </ul>
                  {(db.db.slow?.length ?? 0) > 0 && (
                    <ul className="mt-3 flex flex-col gap-1 border-t border-line pt-2">
                      {db.db.slow!.map((q, i) => (
                        <li key={i} className="flex gap-3">
                          <span className="min-w-0 flex-1 truncate font-mono text-faint" title={q.query}>
                            {q.query}
                          </span>
                          <span className="tnum text-muted">{q.mean_ms} ms avg</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </details>
              </>
            )}
          </Panel>
        </section>

        {/* Deploys */}
        <section>
          <SectionTitle right="Railway from GitHub main">Deploys</SectionTitle>
          <Panel className="overflow-hidden">
            {s.deploy && (
              <div className="flex items-center gap-3 border-b border-line px-4 py-3">
                <GitCommitHorizontal className="h-4 w-4 text-codex" />
                <a href={`https://github.com/Lind-hack/383lajme/commit/${s.deploy.sha}`} target="_blank" rel="noreferrer" className="font-mono text-sm hover:text-codex">
                  {s.deploy.sha.slice(0, 7)}
                </a>
                <span className={cn("text-xs", s.deploy.verified ? "text-ok" : "text-warn")}>{s.deploy.verified ? "live · verified main deploy" : `live · ${s.deploy.source} — not verified`}</span>
              </div>
            )}
            {deploys.length === 0 ? (
              <Empty>Deploys are logged from now on, as the probe sees each new commit.</Empty>
            ) : (
              deploys.map((d) => (
                <div key={`${d.sha}-${d.at}`} className="flex items-center gap-3 border-b border-line px-4 py-2.5 text-[13px] last:border-0">
                  <Dot tone={d.verified ? "ok" : "warn"} />
                  <a href={`https://github.com/Lind-hack/383lajme/commit/${d.sha}`} target="_blank" rel="noreferrer" className="font-mono hover:text-codex">
                    {d.sha.slice(0, 7)}
                  </a>
                  <span className="min-w-0 flex-1 truncate text-xs text-muted">{d.verified ? "main · production" : `${d.ref} · ${d.source}`}</span>
                  <span className="text-xs text-faint">{ago(d.at)}</span>
                </div>
              ))
            )}
          </Panel>
          {incidents.filter((i) => i.endedAt).length > 0 && (
            <p className="mt-3 px-1 text-xs text-faint">
              Past incidents:{" "}
              {incidents
                .filter((i) => i.endedAt)
                .slice(-4)
                .reverse()
                .map((i) => `${i.key} ${Math.round((Date.parse(i.endedAt!) - Date.parse(i.startedAt)) / 60_000)} min, ${ago(i.startedAt)}`)
                .join(" · ")}
            </p>
          )}
        </section>
      </div>

      {/* Jobs */}
      <section className="mt-8">
        <SectionTitle right={failed.length ? `${failed.length} failed units on the VPS` : "next run"}>Scheduled on the VPS</SectionTitle>
        <Panel className="overflow-hidden">
          {s.units.length === 0 ? (
            <Empty>No 383 timers found on the VPS.</Empty>
          ) : (
            s.units.map((u) => {
              const bad = u.result && u.result !== "success";
              return (
                <div key={u.timer} className="flex min-h-14 items-center gap-3 border-b border-line px-4 py-3 last:border-0">
                  <Dot tone={bad ? "bad" : u.active === "active" ? "hud" : "ok"} pulse={u.active === "active"} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-[13px]">{u.timer.replace(/\.timer$/, "")}</span>
                    <span className="block text-xs text-muted">{u.active === "active" ? "running now" : bad ? `last run failed (${u.result})` : `last run ${ago(u.last)}`}</span>
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

function Stat({ icon: Icon, label, value, suffix = "", sub, good, decimals = 0 }: { icon: typeof Globe; label: string; value: number | null; suffix?: string; sub: string; good: boolean; decimals?: number }) {
  return (
    <Panel className="lift p-4">
      <p className="hud-label flex items-center gap-2 !text-[10px]">
        <Icon className="h-3.5 w-3.5" strokeWidth={1.75} /> {label}
      </p>
      <p className={cn("mt-2 text-[1.9rem] leading-none font-semibold tracking-[-0.04em]", value === null ? "text-faint" : good ? "text-text" : "text-warn")}>
        {value === null ? "—" : <CountUp value={value} format={(n) => `${n.toFixed(decimals)}${suffix}`} />}
      </p>
      <p className="mt-1.5 truncate text-[11px] text-faint">{sub}</p>
    </Panel>
  );
}

function Mini({ icon: Icon, label, value, warn }: { icon: typeof Globe; label: string; value: string; warn?: boolean }) {
  return (
    <div>
      <p className="flex items-center gap-1.5 text-[10px] text-faint">
        <Icon className="h-3 w-3" /> {label}
      </p>
      <p className={cn("tnum mt-1 text-base font-semibold", warn && "text-warn")}>{value}</p>
    </div>
  );
}

function Kv({ k, v, bad }: { k: string; v: string; bad?: boolean }) {
  return (
    <>
      <dt className="text-faint">{k}</dt>
      <dd className={cn("tnum text-right font-mono", bad ? "text-warn" : "text-text")}>{v}</dd>
    </>
  );
}

function ProbeRow({ p }: { p: ProbeSummary }) {
  const max = Math.max(1, ...p.spark.map((x) => (x && x > 0 ? x : 0)));
  const down = p.last && !p.last.ok;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-4 py-3 last:border-0">
      <Dot tone={!p.last ? "neutral" : down ? "bad" : "ok"} pulse={!down && !!p.last} />
      <span className="w-28 shrink-0 text-[13px]">{p.label}</span>
      <span className="flex h-7 min-w-[160px] flex-1 items-end gap-[2px]" aria-label={`${p.label}: 24 hours of response times`}>
        {p.spark.map((x, i) => (
          <span key={i} className="flex-1 rounded-[2px]" style={{ height: x === null ? 2 : x < 0 ? 28 : Math.max(3, (x / max) * 26), background: x === null ? "rgb(255 255 255 / 0.05)" : x < 0 ? "var(--color-bad)" : x > 1500 ? "var(--color-warn)" : "rgb(124 152 255 / 0.65)" }} title={x === null ? "no data" : x < 0 ? "failed" : `${x} ms`} />
        ))}
      </span>
      <span className="tnum w-16 shrink-0 text-right font-mono text-xs text-muted">{fmtMs(p.p50)}</span>
      <span className={cn("tnum w-16 shrink-0 text-right font-mono text-xs", (p.uptime24h ?? 100) < 99 ? "text-warn" : "text-ok")}>{p.uptime24h !== null ? `${p.uptime24h}%` : "—"}</span>
      {down && <span className="w-full pl-6 text-xs text-bad">{p.last!.error}</span>}
    </div>
  );
}
