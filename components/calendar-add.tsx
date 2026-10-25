"use client";

import { CalendarPlus, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { EventDraft } from "@/lib/calendar";
import { ReplyBar } from "./reply-bar";

// Say or type an event → a draft card Lind can fix → written to Google only on "Add".
export function CalendarAdd() {
  const router = useRouter();
  const [draft, setDraft] = useState<EventDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const card = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (draft) card.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [draft]);

  async function add() {
    if (!draft) return;
    setSaving(true);
    setError("");
    const res = await fetch("/api/calendar/events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ draft }) }).catch(() => null);
    const body = await res?.json().catch(() => null);
    setSaving(false);
    if (!res?.ok) return setError(body?.error ?? "Couldn't add it — try again.");
    setDraft(null);
    router.refresh();
  }

  const set = (patch: Partial<EventDraft>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const field = "rounded-xl border border-line bg-black/30 px-3 py-2 text-[15px] outline-none focus:border-line-hi";

  return (
    <>
      {draft && (
        <div ref={card} className="rise panel mt-8 p-5">
          <p className="mb-3 flex items-center gap-2 text-xs text-muted">
            <CalendarPlus className="h-4 w-4" strokeWidth={1.75} /> New event — check it, then add
          </p>
          <input value={draft.title} onChange={(e) => set({ title: e.target.value })} aria-label="Title" className={`${field} w-full`} />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input type="date" value={draft.date} onChange={(e) => set({ date: e.target.value })} aria-label="Date" className={field} />
            {!draft.allDay && (
              <>
                <input type="time" value={draft.start ?? ""} onChange={(e) => set({ start: e.target.value })} aria-label="Starts" className={field} />
                <span className="text-faint">–</span>
                <input type="time" value={draft.end ?? ""} onChange={(e) => set({ end: e.target.value })} aria-label="Ends" className={field} />
              </>
            )}
            <label className="flex items-center gap-2 px-1 text-sm text-muted">
              <input
                type="checkbox"
                checked={draft.allDay}
                onChange={(e) => set(e.target.checked ? { allDay: true, start: undefined, end: undefined } : { allDay: false, start: "09:00", end: "10:00" })}
                className="accent-[var(--color-claude)]"
              />
              All day
            </label>
          </div>
          {draft.location !== undefined && (
            <input value={draft.location} onChange={(e) => set({ location: e.target.value })} aria-label="Location" placeholder="Location" className={`${field} mt-3 w-full`} />
          )}
          {error && <p className="mt-3 text-sm text-bad" aria-live="polite">{error}</p>}
          <div className="mt-4 flex gap-2">
            <button onClick={add} disabled={saving || !draft.title.trim()} className="flex items-center gap-2 rounded-full bg-text px-5 py-2.5 text-sm font-medium text-bg disabled:opacity-40">
              {saving && <LoaderCircle className="h-4 w-4 animate-spin" />} Add to calendar
            </button>
            <button onClick={() => setDraft(null)} className="rounded-full px-4 py-2.5 text-sm text-muted hover:bg-white/5 hover:text-text">
              Discard
            </button>
          </div>
        </div>
      )}
      {/* Room for the fixed bar so the last event isn't hidden under it. */}
      <div className="h-28" aria-hidden />
      <ReplyBar
        placeholder="Add an event — “dentist Friday 3pm”"
        onSend={async (text) => {
          const res = await fetch("/api/calendar/draft", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
          const body = await res.json().catch(() => null);
          if (!res.ok || !body?.draft) throw new Error(body?.error ?? `error ${res.status}`);
          setError("");
          setDraft(body.draft);
        }}
      />
    </>
  );
}
