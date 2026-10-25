import { timers, type TimerRow } from "./ops";

// 383ks.com at a glance: what's deployed, is it answering, did the news run publish.

const SITE = process.env.SITE_URL ?? "https://383ks.com";
// systemd units on this VPS that belong to 383 (news, dosje, tregu, video…).
const UNIT_MATCH = /383|dosje|tregu|news|video|kuiz|bota/i;

export type SiteHealth = {
  url: string;
  up: boolean;
  ms: number | null;
  deploy?: { sha: string; ref: string; environment: string; source: string; verified: boolean };
  latest?: { title: string; at: string; category?: string; url: string };
  units: TimerRow[];
  error?: string;
};

export async function siteHealth(): Promise<SiteHealth> {
  const t0 = Date.now();
  const [deployRes, articlesRes, unitRows] = await Promise.all([
    fetch(`${SITE}/api/deployment-info`, { cache: "no-store", signal: AbortSignal.timeout(10_000) }).catch(() => null),
    fetch(`${SITE}/api/articles?limit=1`, { cache: "no-store", signal: AbortSignal.timeout(10_000) }).catch(() => null),
    timers().catch(() => [] as TimerRow[]),
  ]);
  const ms = deployRes ? Date.now() - t0 : null;
  const deploy = (await deployRes?.json().catch(() => null)) as {
    commit_sha?: string;
    commit_ref?: string;
    environment?: string;
    deployment_source?: string;
  } | null;
  const articles = (await articlesRes?.json().catch(() => null)) as {
    items?: { title?: string; publishedAt?: string; category?: string; slug?: string }[];
  } | null;
  const a = articles?.items?.[0];
  return {
    url: SITE,
    up: !!deployRes?.ok,
    ms,
    deploy: deploy?.commit_sha
      ? {
          sha: deploy.commit_sha,
          ref: deploy.commit_ref ?? "",
          environment: deploy.environment ?? "",
          source: deploy.deployment_source ?? "",
          // The four checks from 383's deploy policy (Desktop/claude/CLAUDE.md).
          verified: deploy.commit_ref === "main" && deploy.environment === "production" && deploy.deployment_source === "github-main",
        }
      : undefined,
    latest: a?.title && a.publishedAt ? { title: a.title, at: a.publishedAt, category: a.category, url: `${SITE}/article/${a.slug ?? ""}` } : undefined,
    units: unitRows.filter((u) => UNIT_MATCH.test(u.timer)),
    error: deployRes ? undefined : "383ks.com did not answer within 10 s",
  };
}
