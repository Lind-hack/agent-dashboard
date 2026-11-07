import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ics-test-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";

const { eventsFromIcs, normalizeFeedUrl, addFeed, listFeeds, icsEvents } = await import("../lib/ics");
const { createInvite, signUp, tenantOf } = await import("../lib/users");
const { runAs, ownerTenant } = await import("../lib/tenant");
const { agenda, calendarReadable, calendarConnected } = await import("../lib/calendar");

const realFetch = globalThis.fetch;
test.after(() => {
  globalThis.fetch = realFetch;
});

const BERLIN = `BEGIN:VTIMEZONE
TZID:Europe/Berlin
BEGIN:DAYLIGHT
TZOFFSETFROM:+0100
TZOFFSETTO:+0200
DTSTART:19700329T020000
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU
END:DAYLIGHT
BEGIN:STANDARD
TZOFFSETFROM:+0200
TZOFFSETTO:+0100
DTSTART:19701025T030000
RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU
END:STANDARD
END:VTIMEZONE`;

const ICS = `BEGIN:VCALENDAR
VERSION:2.0
X-WR-CALNAME:Uni
${BERLIN}
BEGIN:VEVENT
UID:lecture
SUMMARY:Algorithms lecture
DTSTART;TZID=Europe/Berlin:20261005T100000
DTEND;TZID=Europe/Berlin:20261005T113000
RRULE:FREQ=WEEKLY;BYDAY=MO
EXDATE;TZID=Europe/Berlin:20261102T100000
END:VEVENT
BEGIN:VEVENT
UID:lecture
RECURRENCE-ID;TZID=Europe/Berlin:20261109T100000
SUMMARY:Algorithms lecture (moved)
DTSTART;TZID=Europe/Berlin:20261109T140000
DTEND;TZID=Europe/Berlin:20261109T153000
END:VEVENT
BEGIN:VEVENT
UID:holiday
SUMMARY:Holiday
DTSTART;VALUE=DATE:20261110
DTEND;VALUE=DATE:20261111
END:VEVENT
BEGIN:VEVENT
UID:outlook
SUMMARY:Dentist
DTSTART;TZID=W. Europe Standard Time:20261110T090000
DTEND;TZID=W. Europe Standard Time:20261110T093000
END:VEVENT
BEGIN:VEVENT
UID:cancelled
SUMMARY:Called off
STATUS:CANCELLED
DTSTART:20261110T120000Z
DTEND:20261110T130000Z
END:VEVENT
END:VCALENDAR`;

const range = (from: string, to: string) => [Date.parse(from), Date.parse(to)] as const;

test("a weekly lecture repeats, skips the cancelled week and shows the moved one at its new time", () => {
  const [a, b] = range("2026-11-01T00:00:00Z", "2026-11-17T00:00:00Z");
  const ev = eventsFromIcs(ICS, a, b, "Europe/Berlin", "Uni", "t").filter((e) => e.title.startsWith("Algorithms"));
  assert.deepEqual(
    ev.map((e) => [e.title, e.start]),
    [
      ["Algorithms lecture (moved)", "2026-11-09T13:00:00.000Z"], // 14:00 Berlin, winter time
      ["Algorithms lecture", "2026-11-16T09:00:00.000Z"],
    ],
  );
});

test("summer and winter time come from the calendar's own zone", () => {
  const [a, b] = range("2026-10-05T00:00:00Z", "2026-10-06T00:00:00Z");
  assert.equal(eventsFromIcs(ICS, a, b, "UTC", "Uni", "t")[0].start, "2026-10-05T08:00:00.000Z"); // 10:00 CEST
});

test("all-day stays a date, a zone the file doesn't define is read as the user's own, cancelled events don't show", () => {
  const [a, b] = range("2026-11-10T00:00:00Z", "2026-11-11T00:00:00Z");
  const ev = eventsFromIcs(ICS, a, b, "Europe/Berlin", "Uni", "t");
  const holiday = ev.find((e) => e.title === "Holiday")!;
  assert.equal(holiday.allDay, true);
  assert.equal(holiday.start, "2026-11-10");
  assert.equal(ev.find((e) => e.title === "Dentist")?.start, "2026-11-10T08:00:00.000Z");
  assert.ok(!ev.some((e) => e.title === "Called off"));
});

test("only https links to public servers are fetched, redirects included", async () => {
  assert.equal(normalizeFeedUrl("http://example.com/a.ics"), null);
  assert.equal(normalizeFeedUrl("https://user:pw@example.com/a.ics"), null);
  assert.equal(normalizeFeedUrl("https://example.com:8080/a.ics"), null);
  assert.equal(normalizeFeedUrl("webcal://p01-caldav.icloud.com/x")?.protocol, "https:");
  const a = signUp({ email: "ssrf@example.com", name: "S", password: "long enough pw", invite: createInvite().code });
  await runAs(tenantOf(a), async () => {
    await assert.rejects(addFeed("https://127.0.0.1/cal.ics"), /public|private|address/i);
    await assert.rejects(addFeed("https://localhost/cal.ics"), /public|private|address/i);
    let hops = 0;
    globalThis.fetch = (async () => {
      hops++;
      return new Response("", { status: 302, headers: { location: "http://169.254.169.254/latest" } });
    }) as typeof fetch;
    await assert.rejects(addFeed("https://93.184.215.14/cal.ics"), /redirects/);
    assert.equal(hops, 1);
    assert.equal(listFeeds().length, 0);
  });
});

test("an account with a calendar link gets its events on Today; the owner's Google sign-in isn't involved", async () => {
  const a = signUp({ email: "cal@example.com", name: "C", password: "long enough pw", invite: createInvite().code, tz: "Europe/Berlin" });
  globalThis.fetch = (async () => new Response(ICS, { status: 200 })) as typeof fetch;
  await runAs(tenantOf(a), async () => {
    assert.equal(calendarReadable(), false);
    const f = await addFeed("https://93.184.215.14/private/basic.ics");
    assert.equal(f.name, "Uni");
    assert.equal(calendarReadable(), true);
    assert.equal(calendarConnected(), false, "a link is read-only: nothing tries to write blocks to it");
    assert.ok(icsEvents(Date.parse("2026-11-09T00:00:00Z"), Date.parse("2026-11-10T00:00:00Z"), "Europe/Berlin").length >= 1);
    const day = await agenda(2);
    assert.equal(day.tz, "Europe/Berlin");
    assert.ok(Array.isArray(day.events));
  });
  assert.equal(runAs(ownerTenant(), () => listFeeds().length), 0, "the link stays in that account");
});

test("Google sign-in: the way out sets a state, and a callback without the matching state changes nothing", async () => {
  process.env.GOOGLE_OAUTH_CLIENT_ID = "cid.apps.googleusercontent.com";
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = "secret";
  const start = await import("../app/api/calendar/google/route");
  const cb = await import("../app/api/calendar/google/callback/route");
  const { makeSession } = await import("../lib/auth");
  const a = signUp({ email: "goauth@example.com", name: "G", password: "long enough pw", invite: createInvite().code });
  const h = { "x-forwarded-host": "agents.example.com", "x-forwarded-proto": "https" };
  await runAs(tenantOf(a), async () => {
    const out = await start.GET(new Request("http://x/api/calendar/google?back=setup", { headers: h }));
    const to = new URL(out.headers.get("location")!);
    assert.equal(to.host, "accounts.google.com");
    assert.equal(to.searchParams.get("redirect_uri"), "https://agents.example.com/api/calendar/google/callback");
    assert.equal(to.searchParams.get("access_type"), "offline");
    const state = to.searchParams.get("state")!;
    assert.match(out.headers.get("set-cookie") ?? "", new RegExp(`g_oauth_state=${state}\.setup`));
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return new Response("{}", { status: 400 });
    }) as typeof fetch;
    const forged = await cb.GET(new Request(`http://x/api/calendar/google/callback?code=abc&state=${state}`, { headers: { ...h, cookie: `ad_session=${(await makeSession(a.id, a.session)).value}; g_oauth_state=someone-elses.setup` } }));
    assert.match(forged.headers.get("location") ?? "", /\/setup\?calendar=That%20sign-in%20link%20expired/);
    assert.equal(called, false, "no code is exchanged without the matching state");
    assert.equal(calendarConnected(), false);
  });
  const owner = await runAs(ownerTenant(), () => start.GET(new Request("http://x/api/calendar/google")));
  assert.equal(owner.status, 400, "the owner's Google sign-in stays with the PC script");
  delete process.env.GOOGLE_OAUTH_CLIENT_ID;
  delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
});
