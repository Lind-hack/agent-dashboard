import { appendProbes, PROBES, pruneProbes, readDeploys, readIncidents, readPsi, readSeo, SITE, writeJSON, type Deploy, type Incident, type Probe, type Psi, type SeoCheck } from "../lib/monitor";
import { notify } from "./notify";

// Website monitoring, runner side: probes every 3 min, a deploy log, incidents (2 failed probes in a
// row → open + push; first good one → closed + push), PageSpeed Insights every 6 h, SEO daily.

const log = (...a: unknown[]) => console.log(new Date().toISOString(), "monitor:", ...a);
const PROBE_EVERY = 3 * 60_000;
const PSI_EVERY = 6 * 3600_000;
const SEO_EVERY = 24 * 3600_000;
let lastProbe = 0;
let lastPsi = 0;
let lastSeo = 0;
let busy = false;
const streak = new Map<string, number>(); // consecutive failures per probe

export function monitorTick() {
  if (busy || process.env.MONITOR_ENABLED === "0") return;
  const now = Date.now();
  const jobs: (() => Promise<void>)[] = [];
  if (now - lastProbe >= PROBE_EVERY) {
    lastProbe = now;
    jobs.push(probeAll);
  }
  if (now - lastPsi >= PSI_EVERY && (readPsi().mobile?.at ?? "") < new Date(now - PSI_EVERY).toISOString()) {
    lastPsi = now;
    jobs.push(pageSpeed);
  } else if (now - lastPsi >= PSI_EVERY) lastPsi = now;
  if (now - lastSeo >= SEO_EVERY && (readSeo()?.at ?? "") < new Date(now - SEO_EVERY).toISOString()) {
    lastSeo = now;
    jobs.push(seoCheck);
  } else if (now - lastSeo >= SEO_EVERY) lastSeo = now;
  if (!jobs.length) return;
  busy = true;
  void (async () => {
    for (const j of jobs) await j().catch((e) => log(e instanceof Error ? e.message : e));
  })().finally(() => (busy = false));
}

async function probeOne(p: (typeof PROBES)[number]): Promise<Probe & { body?: string }> {
  const t0 = Date.now();
  const at = new Date().toISOString();
  try {
    const res = await fetch(`${SITE()}${p.path}`, { cache: "no-store", redirect: "follow", headers: { "User-Agent": "AgenticOS-monitor/1 (+agents.383ks.com)" }, signal: AbortSignal.timeout(15_000) });
    const body = (await res.text()).slice(0, 400_000);
    const ms = Date.now() - t0;
    const ok = res.ok && (!p.expect || p.expect.test(body));
    return { at, key: p.key, status: res.status, ms, bytes: body.length, ok, error: ok ? undefined : res.ok ? "unexpected content" : `HTTP ${res.status}`, body: p.key === "deploy" ? body : undefined };
  } catch (e) {
    return { at, key: p.key, status: 0, ms: Date.now() - t0, bytes: 0, ok: false, error: e instanceof Error ? (e.name === "TimeoutError" ? "timeout after 15 s" : e.message) : String(e) };
  }
}

async function probeAll() {
  const rows = await Promise.all(PROBES.map(probeOne));
  appendProbes(rows.map(({ body: _b, ...r }) => r));
  pruneProbes();

  // Deploys: a new commit on production is logged once.
  const dep = rows.find((r) => r.key === "deploy");
  if (dep?.ok && dep.body) {
    try {
      const d = JSON.parse(dep.body) as { commit_sha?: string; commit_ref?: string; deployment_source?: string; environment?: string };
      const list = readDeploys();
      if (d.commit_sha && list.at(-1)?.sha !== d.commit_sha) {
        const entry: Deploy = { at: dep.at, sha: d.commit_sha, ref: d.commit_ref ?? "", source: d.deployment_source ?? "", environment: d.environment ?? "", verified: d.commit_ref === "main" && d.environment === "production" && d.deployment_source === "github-main" };
        writeJSON("deploys.json", [...list, entry].slice(-100));
        log("deploy", entry.sha.slice(0, 8), entry.verified ? "verified" : "UNVERIFIED");
        if (!entry.verified) {
          await notify({ key: `deploy:${entry.sha}`, kind: "system", title: "383 deployed from outside main", body: `${entry.sha.slice(0, 8)} · ${entry.source || "unknown source"} · ${entry.environment}`, href: "/website", priority: 2 });
        }
      }
    } catch {
      /* not JSON — the probe already counts as failed content */
    }
  }

  // Incidents.
  const incidents = readIncidents();
  let changed = false;
  for (const r of rows) {
    const n = r.ok ? 0 : (streak.get(r.key) ?? 0) + 1;
    streak.set(r.key, n);
    const open = incidents.find((i) => i.key === r.key && !i.endedAt);
    if (!r.ok && n >= 2 && !open) {
      const label = PROBES.find((p) => p.key === r.key)?.label ?? r.key;
      const inc: Incident = { id: `${r.key}-${Date.now().toString(36)}`, key: r.key, startedAt: r.at, reason: r.error ?? "failed", failures: n };
      incidents.push(inc);
      changed = true;
      await notify({ key: `incident:${inc.id}`, kind: "system", title: `383ks.com: ${label} is down`, body: inc.reason, push: { title: `383 down: ${label}`, body: inc.reason }, href: "/website", priority: 3 });
      log("incident open", inc.id, inc.reason);
    } else if (open) {
      if (r.ok) {
        open.endedAt = r.at;
        changed = true;
        const mins = Math.round((Date.parse(r.at) - Date.parse(open.startedAt)) / 60_000);
        await notify({ key: `recovered:${open.id}`, kind: "system", title: `383ks.com recovered`, body: `${PROBES.find((p) => p.key === r.key)?.label ?? r.key} is back after ${mins} min.`, href: "/website", priority: 2 });
        log("incident closed", open.id, `${mins} min`);
      } else if (open.failures !== n) {
        open.failures = n;
        changed = true;
      }
    }
  }
  if (changed) writeJSON("incidents.json", incidents.slice(-200));
}

type Lh = { lighthouseResult?: { categories?: Record<string, { score?: number }>; audits?: Record<string, { numericValue?: number }> }; loadingExperience?: { metrics?: Record<string, { category?: string }> }; error?: { message?: string } };

async function pageSpeed() {
  const out = readPsi();
  for (const strategy of ["mobile", "desktop"] as const) {
    const u = new URL("https://www.googleapis.com/pagespeedonline/v5/runPagespeed");
    u.searchParams.set("url", `${SITE()}/`);
    u.searchParams.set("strategy", strategy);
    for (const c of ["performance", "seo", "accessibility", "best-practices"]) u.searchParams.append("category", c);
    if (process.env.PAGESPEED_API_KEY) u.searchParams.set("key", process.env.PAGESPEED_API_KEY);
    const at = new Date().toISOString();
    const res = await fetch(u, { signal: AbortSignal.timeout(120_000) }).catch(() => null);
    const b = (await res?.json().catch(() => null)) as Lh | null;
    const cats = b?.lighthouseResult?.categories;
    const audit = (k: string) => b?.lighthouseResult?.audits?.[k]?.numericValue;
    const score = (k: string) => Math.round((cats?.[k]?.score ?? 0) * 100);
    const field = b?.loadingExperience?.metrics;
    const psi: Psi = cats
      ? {
          at,
          strategy,
          performance: score("performance"),
          seo: score("seo"),
          accessibility: score("accessibility"),
          bestPractices: score("best-practices"),
          lcp: audit("largest-contentful-paint"),
          cls: audit("cumulative-layout-shift"),
          tbt: audit("total-blocking-time"),
          fcp: audit("first-contentful-paint"),
          inp: audit("interaction-to-next-paint"),
          field: field ? { lcp: field.LARGEST_CONTENTFUL_PAINT_MS?.category, cls: field.CUMULATIVE_LAYOUT_SHIFT_SCORE?.category, inp: field.INTERACTION_TO_NEXT_PAINT?.category } : undefined,
        }
      : {
          at,
          strategy,
          performance: 0,
          seo: 0,
          accessibility: 0,
          bestPractices: 0,
          error: /quota|blocked/i.test(b?.error?.message ?? "")
            ? "PageSpeed needs its own free API key: Google Cloud console → enable the PageSpeed Insights API → create an API key → add PAGESPEED_API_KEY to /etc/agent-dashboard.env."
            : (b?.error?.message?.slice(0, 200) ?? `PageSpeed didn't answer (${res?.status ?? "network"})`),
        };
    out[strategy] = psi;
    if (!psi.error) out.history = [...(out.history ?? []), psi].slice(-120);
    log("pagespeed", strategy, psi.error ?? `perf ${psi.performance}`);
  }
  writeJSON("psi.json", out);
}

// Once a day: the homepage's tags, robots + sitemap, and the newest article's page (structured data,
// social image), plus how fresh the news is.
async function seoCheck() {
  const site = SITE();
  const get = async (p: string) => {
    const r = await fetch(`${site}${p}`, { signal: AbortSignal.timeout(20_000), headers: { "User-Agent": "AgenticOS-monitor/1" } }).catch(() => null);
    return r?.ok ? (await r.text()).slice(0, 600_000) : "";
  };
  const [home, robots, sitemap, api] = await Promise.all([get("/"), get("/robots.txt"), get("/sitemap.xml"), get("/api/articles?limit=50")]);
  const tag = (html: string, re: RegExp) => html.match(re)?.[1]?.trim() ?? "";
  const title = tag(home, /<title[^>]*>([^<]*)<\/title>/i);
  const desc = tag(home, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)/i);
  const canon = tag(home, /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)/i);
  const og = tag(home, /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i);
  const items = (() => {
    try {
      return (JSON.parse(api)?.items ?? []) as { slug?: string; publishedAt?: string }[];
    } catch {
      return [];
    }
  })();
  const newest = items[0];
  const article = newest?.slug ? await get(`/article/${newest.slug}`) : "";
  const today = new Date().toISOString().slice(0, 10);
  const sitemapUrls = (sitemap.match(/<loc>/g) ?? []).length;
  // Only the rules for every crawler ("User-agent: *") decide whether search engines may crawl;
  // Cloudflare's managed block disallows AI bots by name, which is fine.
  const everyone = (() => {
    let inStar = false;
    let grouping = false;
    const rules: string[] = [];
    for (const raw of robots.split(/\r?\n/)) {
      const line = raw.replace(/#.*/, "").trim();
      const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
      if (!m) continue;
      const [k, v] = [m[1].toLowerCase(), m[2].trim()];
      if (k === "user-agent") {
        inStar = grouping ? inStar || v === "*" : v === "*";
        grouping = true;
      } else {
        grouping = false;
        if (inStar && k === "disallow") rules.push(v);
      }
    }
    return rules;
  })();
  const lastmod = sitemap.match(/<lastmod>([^<]+)<\/lastmod>/i)?.[1];
  const checks = [
    { name: "Title", ok: title.length >= 10 && title.length <= 65, detail: title ? `${title.length} chars — “${title.slice(0, 70)}”` : "missing" },
    { name: "Meta description", ok: desc.length >= 70 && desc.length <= 170, detail: desc ? `${desc.length} chars` : "missing" },
    { name: "Canonical", ok: !!canon, detail: canon || "missing" },
    { name: "Social image (og:image)", ok: !!og, detail: og ? "set" : "missing" },
    { name: "robots.txt allows crawling", ok: !!robots && !everyone.includes("/"), detail: !robots ? "missing" : everyone.includes("/") ? "blocks every crawler (Disallow: / for *)" : `allows search${/sitemap:/i.test(robots) ? ", lists the sitemap" : ", no Sitemap line"}${everyone.length ? ` · ${everyone.length} path rule${everyone.length > 1 ? "s" : ""}` : ""}` },
    { name: "Sitemap", ok: sitemapUrls > 0, detail: sitemapUrls ? `${sitemapUrls} URLs${lastmod ? ` · last change ${lastmod.slice(0, 10)}` : ""}` : "missing or empty" },
    { name: "Article structured data", ok: /"@type"\s*:\s*"(News)?Article"/.test(article), detail: article ? (/"@type"\s*:\s*"(News)?Article"/.test(article) ? "NewsArticle JSON-LD on the newest article" : "no Article JSON-LD on the newest article") : "couldn't open the newest article" },
    { name: "Article social image", ok: /property=["']og:image["']/.test(article), detail: /property=["']og:image["']/.test(article) ? "set" : "missing on the newest article" },
    { name: "Language", ok: /<html[^>]+lang=["']sq/i.test(home), detail: tag(home, /<html[^>]+lang=["']([^"']+)/i) || "no lang attribute" },
  ];
  const seo: SeoCheck = {
    at: new Date().toISOString(),
    checks,
    score: Math.round((checks.filter((c) => c.ok).length / checks.length) * 100),
    articlesToday: items.filter((i) => i.publishedAt?.startsWith(today)).length,
    latestAgeMin: newest?.publishedAt ? Math.round((Date.now() - Date.parse(newest.publishedAt)) / 60_000) : undefined,
  };
  writeJSON("seo.json", seo);
  log("seo", `${seo.score}%`);
}
