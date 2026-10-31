import fs from "node:fs";
import path from "node:path";
import { accessToken } from "./calendar";
import { DATA_DIR } from "./config";

// 383's traffic from Google Analytics 4 (Data API, read-only: analytics.readonly from
// handoff/google-auth.mjs). The property is GA4_PROPERTY_ID (the number, not the G- measurement id).
// https://developers.google.com/analytics/devguides/reporting/data/v1/rest

export type Traffic = {
  at: string;
  realtime: number | null; // active users in the last 30 minutes
  today: { users: number; views: number };
  yesterday: { users: number; views: number };
  week: { day: string; users: number }[];
  topPages: { path: string; title: string; views: number }[];
  sources: { source: string; users: number }[];
  error?: string;
};

const property = () => process.env.GA4_PROPERTY_ID?.replace(/^properties\//, "").trim() ?? "";
const gaScope = () => {
  try {
    const c = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "google.json"), "utf8"));
    return Array.isArray(c?.scopes) && c.scopes.some((s: string) => s.includes("analytics"));
  } catch {
    return false;
  }
};
export const gaState = (): "ready" | "no-property" | "no-scope" => (!property() ? "no-property" : !gaScope() ? "no-scope" : "ready");

type Row = { dimensionValues?: { value?: string }[]; metricValues?: { value?: string }[] };

async function ga(method: "runReport" | "runRealtimeReport", body: unknown): Promise<Row[]> {
  const res = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${property()}:${method}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  const b = (await res.json().catch(() => null)) as { rows?: Row[]; error?: { message?: string } } | null;
  if (!res.ok) throw new Error(`GA4: ${b?.error?.message ?? res.status}`);
  return b?.rows ?? [];
}

const num = (r: Row | undefined, i = 0) => Number(r?.metricValues?.[i]?.value ?? 0) || 0;
const dim = (r: Row | undefined, i = 0) => r?.dimensionValues?.[i]?.value ?? "";

let cache: Traffic | null = null;

export async function traffic(): Promise<Traffic | null> {
  if (gaState() !== "ready") return null;
  if (cache && Date.now() - Date.parse(cache.at) < 10 * 60_000) return cache;
  try {
    const [rt, days, pages, sources] = await Promise.all([
      ga("runRealtimeReport", { metrics: [{ name: "activeUsers" }] }).catch(() => null),
      ga("runReport", { dateRanges: [{ startDate: "6daysAgo", endDate: "today" }], dimensions: [{ name: "date" }], metrics: [{ name: "activeUsers" }, { name: "screenPageViews" }], orderBys: [{ dimension: { dimensionName: "date" } }] }),
      ga("runReport", { dateRanges: [{ startDate: "today", endDate: "today" }], dimensions: [{ name: "pagePath" }, { name: "pageTitle" }], metrics: [{ name: "screenPageViews" }], orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }], limit: 6 }),
      ga("runReport", { dateRanges: [{ startDate: "today", endDate: "today" }], dimensions: [{ name: "sessionSource" }], metrics: [{ name: "activeUsers" }], orderBys: [{ metric: { metricName: "activeUsers" }, desc: true }], limit: 5 }),
    ]);
    const byDay = days.map((r) => ({ day: `${dim(r).slice(0, 4)}-${dim(r).slice(4, 6)}-${dim(r).slice(6, 8)}`, users: num(r), views: num(r, 1) }));
    const t = byDay.at(-1);
    const y = byDay.at(-2);
    cache = {
      at: new Date().toISOString(),
      realtime: rt ? num(rt[0]) : null,
      today: { users: t?.users ?? 0, views: t?.views ?? 0 },
      yesterday: { users: y?.users ?? 0, views: y?.views ?? 0 },
      week: byDay.map(({ day, users }) => ({ day, users })),
      topPages: pages.map((r) => ({ path: dim(r), title: dim(r, 1), views: num(r) })),
      sources: sources.map((r) => ({ source: dim(r) || "(direct)", users: num(r) })),
    };
    return cache;
  } catch (e) {
    return { at: new Date().toISOString(), realtime: null, today: { users: 0, views: 0 }, yesterday: { users: 0, views: 0 }, week: [], topPages: [], sources: [], error: e instanceof Error ? e.message : String(e) };
  }
}
