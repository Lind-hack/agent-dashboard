import crypto from "node:crypto";
import https from "node:https";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import ICAL from "ical.js";
import type { CalEvent } from "./calendar";
import { publicAddress } from "./net-guard";
import { dataDir, perTenant } from "./tenant";

// Calendars by private link (iCal / .ics), for accounts without Google sign-in: Google, Apple iCloud and
// Outlook all publish one. Read-only: events show on Today and the planner works around them, but plan
// blocks can't be written back. Each feed is fetched at most every 15 minutes and kept on disk, so a
// slow calendar server never holds up a page. Recurring events, their moved/cancelled instances and the
// file's own time zones are expanded with ical.js.

export type IcsFeed = { id: string; url: string; name: string; addedAt: string; error?: string; okAt?: string };

const file = () => path.join(dataDir(), "calendar-ics.json");
const cacheFile = (id: string) => path.join(dataDir(), "sources", `ics-${id}.ics`);
const REFRESH_MS = 15 * 60_000;
const MAX_BYTES = 5 * 1024 * 1024;

export function listFeeds(): IcsFeed[] {
  try {
    const v = JSON.parse(fs.readFileSync(file(), "utf8"));
    return Array.isArray(v) ? v.filter((f) => f && typeof f.url === "string" && typeof f.id === "string") : [];
  } catch {
    return [];
  }
}

function saveFeeds(feeds: IcsFeed[]) {
  fs.mkdirSync(dataDir(), { recursive: true });
  const tmp = `${file()}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(feeds, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file());
}

export const icsConnected = () => listFeeds().length > 0;

// webcal:// is how calendar apps hand these out; it's plain https underneath.
export function normalizeFeedUrl(raw: string): URL | null {
  try {
    const u = new URL(raw.trim().replace(/^webcals?:\/\//i, "https://"));
    if (u.protocol !== "https:" || u.username || u.password) return null;
    if (u.port && u.port !== "443") return null;
    return u;
  } catch {
    return null;
  }
}

type Got = { status: number; location: string | null; body: Buffer };

// One GET over TLS to the exact address that was checked (DNS isn't asked twice, so a name can't answer
// "public" for the check and "private" for the download). The certificate is still checked for the name.
function pinnedGet(u: URL, ip: string): Promise<Got> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      u,
      {
        headers: { Accept: "text/calendar, */*", "User-Agent": "AgenticOS-calendar/1" },
        servername: net.isIP(u.hostname) ? undefined : u.hostname,
        lookup: (_host, opts, cb) => {
          const family = net.isIP(ip);
          if ((opts as { all?: boolean })?.all) (cb as unknown as (e: null, a: { address: string; family: number }[]) => void)(null, [{ address: ip, family }]);
          else cb(null, ip, family);
        },
        timeout: 20_000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size > MAX_BYTES) {
            req.destroy(new Error("That calendar is too big to read (over 5 MB)"));
            return;
          }
          chunks.push(c);
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, location: typeof res.headers.location === "string" ? res.headers.location : null, body: Buffer.concat(chunks) }));
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new Error("The calendar server took too long")));
    req.on("error", reject);
  });
}

// Swappable in tests only (they have no network).
let transport: (u: URL, ip: string) => Promise<Got> = pinnedGet;
export function setFeedTransport(t: ((u: URL, ip: string) => Promise<Got>) | null) {
  transport = t ?? pinnedGet;
}

// Only public servers, every redirect checked again: a link can't point the server at itself.
async function fetchFeed(url: URL): Promise<string> {
  let u = url;
  for (let hop = 0; hop < 4; hop++) {
    const ip = await publicAddress(u.hostname);
    const res = await transport(u, ip);
    if (res.status >= 300 && res.status < 400) {
      const next = normalizeFeedUrl(new URL(res.location ?? "", u).toString());
      if (!next) throw new Error("The calendar link redirects somewhere it can't follow");
      u = next;
      continue;
    }
    // One answer for every failure: the reason a server refused isn't something to probe with.
    if (res.status !== 200 || !/BEGIN:VCALENDAR/i.test(res.body.toString("utf8", 0, 4096))) throw new Error("Couldn't read a calendar at that link. Check that it's the private iCal/.ics address");
    return res.body.toString("utf8");
  }
  throw new Error("The calendar link redirects too many times");
}

export async function addFeed(raw: string, name?: string): Promise<IcsFeed> {
  const u = normalizeFeedUrl(raw);
  if (!u) throw new Error("Paste the calendar's https or webcal link");
  const text = await fetchFeed(u);
  const parsed = new ICAL.Component(ICAL.parse(text));
  const calName = String(parsed.getFirstPropertyValue("x-wr-calname") ?? "").trim();
  const feeds = listFeeds();
  const id = crypto.createHash("sha256").update(u.toString()).digest("hex").slice(0, 12);
  const feed: IcsFeed = { id, url: u.toString(), name: (name?.trim() || calName || u.hostname).slice(0, 60), addedAt: new Date().toISOString(), okAt: new Date().toISOString() };
  fs.mkdirSync(path.dirname(cacheFile(id)), { recursive: true });
  fs.writeFileSync(cacheFile(id), text);
  saveFeeds([...feeds.filter((f) => f.id !== id), feed]);
  return feed;
}

export function removeFeed(id: string) {
  saveFeeds(listFeeds().filter((f) => f.id !== id));
  fs.rmSync(cacheFile(id), { force: true });
}

// The runner (and a stale page read) refreshes feeds; a failure keeps the last good copy and is shown.
export async function refreshFeeds(force = false) {
  const feeds = listFeeds();
  let changed = false;
  for (const f of feeds) {
    let age = Infinity;
    try {
      age = Date.now() - fs.statSync(cacheFile(f.id)).mtimeMs;
    } catch {
      /* never fetched */
    }
    if (!force && age < REFRESH_MS) continue;
    const u = normalizeFeedUrl(f.url);
    if (!u) continue;
    try {
      const text = await fetchFeed(u);
      fs.mkdirSync(path.dirname(cacheFile(f.id)), { recursive: true });
      fs.writeFileSync(cacheFile(f.id), text);
      f.okAt = new Date().toISOString();
      delete f.error;
    } catch (e) {
      f.error = e instanceof Error ? e.message : String(e);
    }
    changed = true;
  }
  if (changed) {
    // Merge into what's on disk now: a feed removed meanwhile stays removed.
    const now = listFeeds();
    saveFeeds(now.map((x) => feeds.find((f) => f.id === x.id) ?? x));
  }
}

// Wall-clock time in a zone → the real instant. Used for floating times and zones the file didn't define.
function zonedInstant(y: number, mo: number, d: number, h: number, mi: number, s: number, tz: string): Date {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(guess));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asLocal = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return new Date(guess - (asLocal - guess));
}

function toIso(t: ICAL.Time, tz: string): string {
  if (t.isDate) return `${String(t.year).padStart(4, "0")}-${String(t.month).padStart(2, "0")}-${String(t.day).padStart(2, "0")}`;
  const zone = t.zone?.tzid;
  if (!zone || zone === "floating" || (zone !== "UTC" && zone !== "Z" && !t.zone?.component && !ICAL.TimezoneService.has(zone))) {
    // No usable zone: Outlook's Windows zone names, or a floating time. Read it as the user's local time.
    return zonedInstant(t.year, t.month, t.day, t.hour, t.minute, t.second, tz).toISOString();
  }
  return t.toJSDate().toISOString();
}

export function eventsFromIcs(text: string, fromMs: number, toMs: number, tz: string, calendar: string, prefix: string): CalEvent[] {
  const root = new ICAL.Component(ICAL.parse(text));
  const vevents = root.getAllSubcomponents("vevent");
  const masters = new Map<string, ICAL.Event>();
  const exceptions: ICAL.Event[] = [];
  for (const c of vevents) {
    const e = new ICAL.Event(c, { strictExceptions: false });
    if (e.isRecurrenceException()) exceptions.push(e);
    else masters.set(e.uid, e);
  }
  for (const x of exceptions) {
    const m = masters.get(x.uid);
    if (m && m.isRecurring()) m.relateException(x);
  }
  const out: CalEvent[] = [];
  const push = (id: string, s: ICAL.Time, e: ICAL.Time, item: ICAL.Event) => {
    if (String(item.component.getFirstPropertyValue("status") ?? "").toUpperCase() === "CANCELLED") return;
    const start = toIso(s, tz);
    const end = toIso(e, tz);
    const startMs = s.isDate ? Date.parse(`${start}T00:00:00Z`) : Date.parse(start);
    const endMs = e.isDate ? Date.parse(`${end}T00:00:00Z`) : Date.parse(end);
    if (endMs <= fromMs || startMs >= toMs) return;
    out.push({ id: `${prefix}:${id}`, title: item.summary || "(busy)", start, end, allDay: s.isDate, location: item.location || undefined, calendar });
  };
  for (const m of masters.values()) {
    if (!m.startDate) continue;
    const end = m.endDate ?? m.startDate;
    if (!m.isRecurring()) {
      push(m.uid, m.startDate, end, m);
      continue;
    }
    const it = m.iterator();
    for (let n = 0, next = it.next(); next && n < 20_000; n++, next = it.next()) {
      const at = next.toJSDate().getTime();
      if (at >= toMs + 86_400_000) break;
      const d = m.getOccurrenceDetails(next);
      push(`${m.uid}:${next.toString()}`, d.startDate, d.endDate, d.item);
    }
  }
  return out;
}

// Every feed's events between two instants, from the copies on disk.
export function icsEvents(fromMs: number, toMs: number, tz: string): CalEvent[] {
  return listFeeds().flatMap((f) => {
    try {
      return eventsFromIcs(fs.readFileSync(cacheFile(f.id), "utf8"), fromMs, toMs, tz, f.name, `ics-${f.id}`);
    } catch {
      return [];
    }
  });
}

// Runner: keep every account's calendar links fresh (each feed is only fetched once it's 15 minutes old).
const refreshing = perTenant(() => ({ busy: false }));
export function icsTick() {
  const s = refreshing();
  if (s.busy || !icsConnected()) return;
  s.busy = true;
  void refreshFeeds()
    .catch(() => {})
    .finally(() => (s.busy = false));
}
