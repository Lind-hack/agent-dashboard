"use client";

import { CalendarDays, Check, LoaderCircle, Trash2, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { Panel, StatusPill } from "@/components/kit";
import { cn } from "@/lib/utils";

// Connect a calendar: Google sign-in when the server has it (read and write: plan blocks land on the
// calendar), or any calendar's private link (read-only: Today and the planner work around your events).

type View = { owner: boolean; google: boolean; googleReady: boolean; feeds: { id: string; name: string; host: string; error: string | null; okAt: string | null }[] };

const HOWTO: { app: string; steps: string[] }[] = [
  { app: "Google Calendar", steps: ["On a computer, open calendar.google.com → ⚙ Settings.", "Under “Settings for my calendars”, pick your calendar → “Integrate calendar”.", "Copy “Secret address in iCal format” and paste it here."] },
  { app: "Apple / iCloud", steps: ["In the Calendar app on a Mac (or icloud.com), right-click your calendar → Share Calendar.", "Tick “Public Calendar” and copy the webcal:// link.", "Paste it here."] },
  { app: "Outlook", steps: ["outlook.com → ⚙ Settings → Calendar → Shared calendars.", "Under “Publish a calendar”, pick it, choose “Can view all details”, Publish.", "Copy the ICS link and paste it here."] },
];

export function CalendarConnect() {
  const [v, setV] = useState<View | null>(null);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [how, setHow] = useState(0);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    fetch("/api/calendar/feeds", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => b && setV(b))
      .catch(() => {});
    const msg = new URLSearchParams(window.location.search).get("calendar");
    if (msg) setNotice(msg === "connected" ? "Google Calendar is connected." : msg);
  }, []);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/calendar/feeds", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) }).catch(() => null);
    const b = await res?.json().catch(() => null);
    setBusy(false);
    if (!res?.ok) return setError(b?.error ?? "Couldn't read that calendar.");
    setV(b);
    setUrl("");
  }

  async function remove(id: string) {
    const res = await fetch("/api/calendar/feeds", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) }).catch(() => null);
    if (res?.ok) setV(await res.json());
  }

  async function disconnectGoogle() {
    await fetch("/api/calendar/google", { method: "DELETE" }).catch(() => null);
    setV((x) => (x ? { ...x, google: false } : x));
  }

  if (!v) return <p className="text-sm text-muted">Loading…</p>;
  if (v.owner) return <p className="text-sm text-muted">Your Google Calendar comes from the PC sign-in script (google-auth).</p>;
  return (
    <div id="calendar" className="flex flex-col gap-2">
      {notice && (
        <p className={cn("px-1 text-sm", notice.endsWith("connected.") ? "text-ok" : "text-bad")} role="status">
          {notice}
        </p>
      )}
      {v.googleReady && (
        <Panel className="flex flex-wrap items-center gap-3 !rounded-[14px] px-4 py-3.5">
          <CalendarDays className="h-5 w-5 shrink-0 text-hud" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block text-[15px]">Google Calendar</span>
            <span className="block text-[13px] text-muted">Best: your day&apos;s plan is added to your calendar as blocks.</span>
          </span>
          {v.google ? (
            <span className="flex items-center gap-1">
              <StatusPill tone="ok">
                <Check className="h-3 w-3" aria-hidden /> Connected
              </StatusPill>
              <button onClick={disconnectGoogle} className="h-10 rounded-[11px] px-3 text-sm text-faint hover:bg-white/5 hover:text-bad">
                Disconnect
              </button>
            </span>
          ) : (
            <a href={`/api/calendar/google?back=${typeof window !== "undefined" && window.location.pathname === "/setup" ? "setup" : "settings"}`} className="flex h-10 items-center rounded-[11px] bg-text px-4 text-sm font-medium text-bg">
              Connect Google
            </a>
          )}
        </Panel>
      )}

      <Panel className="!rounded-[14px] px-4 py-3.5">
        <p className="text-[15px]">{v.googleReady ? "Or any calendar, by private link" : "Your calendar, by private link"}</p>
        <p className="text-[13px] text-muted">Read-only: your events show on Today and the planner works around them. Works with Google, Apple and Outlook.</p>
        <div className="mt-3 flex flex-wrap gap-1.5" role="tablist" aria-label="Which calendar app">
          {HOWTO.map((h, i) => (
            <button key={h.app} role="tab" aria-selected={how === i} onClick={() => setHow(i)} className={cn("h-9 rounded-[10px] border px-3 text-[13px]", how === i ? "border-hud/60 bg-hud/10 text-text" : "border-line text-muted hover:text-text")}>
              {h.app}
            </button>
          ))}
        </div>
        <ol className="mt-3 flex list-decimal flex-col gap-1 pl-5 text-[13px] text-muted">
          {HOWTO[how].steps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
        <form onSubmit={add} className="mt-3 flex gap-2">
          <label className="sr-only" htmlFor="ics-url">
            Calendar link
          </label>
          <input
            id="ics-url"
            name="ics-url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://… or webcal://…"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            className="min-w-0 flex-1 rounded-[11px] border border-line bg-black/30 px-3 py-2.5 font-mono text-base outline-none focus-visible:border-hud/60 sm:text-sm"
          />
          <button disabled={busy || !url.trim()} className="flex h-11 shrink-0 items-center gap-2 rounded-[11px] bg-text px-4 text-sm font-medium text-bg disabled:opacity-30">
            {busy && <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />}
            {busy ? "Reading…" : "Add"}
          </button>
        </form>
        <p className={cn("mt-2 min-h-5 text-sm", error ? "text-bad" : "text-faint")} aria-live="polite">
          {error || "The link is private: anyone who has it can see your events, so it's stored only in your account."}
        </p>
        {v.feeds.length > 0 && (
          <ul className="mt-1 flex flex-col border-t border-line pt-2">
            {v.feeds.map((f) => (
              <li key={f.id} className="flex min-h-11 items-center gap-2 text-sm">
                {f.error ? <TriangleAlert className="h-4 w-4 shrink-0 text-warn" aria-hidden /> : <Check className="h-4 w-4 shrink-0 text-ok" aria-hidden />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{f.name}</span>
                  <span className="block truncate text-xs text-faint">{f.error ?? f.host}</span>
                </span>
                <button onClick={() => remove(f.id)} aria-label={`Remove ${f.name}`} className="grid h-10 w-10 place-items-center rounded-xl text-faint hover:bg-white/5 hover:text-bad">
                  <Trash2 className="h-4 w-4" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
