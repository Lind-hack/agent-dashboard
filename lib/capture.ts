import { calendarConnected, dayString, timeZone, type EventDraft } from "./calendar";
import { groqJSON } from "./groq";
import { ticktickConnected, type TaskDraft } from "./ticktick";

// One box for the whole day: whatever Lind says becomes a TickTick task ("buy milk", "finish the
// essay by Friday") or a calendar event ("dentist Friday 3pm", "gym 7–8"). He confirms before saving.

export type Capture = { kind: "task"; task: TaskDraft } | { kind: "event"; event: EventDraft };

export async function capture(text: string): Promise<Capture> {
  const canTask = ticktickConnected();
  const canEvent = calendarConnected();
  const tz = canEvent ? await timeZone().catch(() => "Europe/Belgrade") : "Europe/Belgrade";
  const now = new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date());
  const p = await groqJSON<{
    kind: "task" | "event";
    title: string;
    date: string | null;
    start: string | null;
    end: string | null;
    location: string | null;
    priority: "high" | "medium" | "low" | "none";
  }>(
    `You sort one dictated note into a to-do or a calendar event. Now it is ${now} (${tz}).
Return JSON: {"kind": "task"|"event", "title": string, "date": "YYYY-MM-DD"|null, "start": "HH:MM"|null, "end": "HH:MM"|null, "location": string|null, "priority": "high"|"medium"|"low"|"none"}.
- "event": something that happens at a time or place (meeting, class, appointment, gym, call at 3). "task": something to get done (buy, finish, send, fix, remember to).
- Resolve relative dates ("tomorrow", "nesër", "të premten", "by Friday") against now. A task with "by/until" gets that date.
- An event with a start but no end: end = start + 1 hour. An event with no time: start/end null.
- priority from words like "urgent", "important", "asap" → high; else none.
- title: short, in the note's language, without the date/time words.`,
    text,
    0,
  );
  const hhmm = (v?: string | null) => (v && /^\d{1,2}:\d{2}$/.test(v) ? v.padStart(5, "0") : undefined);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(p?.date ?? "") ? p!.date! : undefined;
  const title = (p?.title || text).trim().slice(0, 120);
  let kind = p?.kind === "event" ? "event" : "task";
  if (kind === "task" && !canTask && canEvent) kind = "event";
  if (kind === "event" && !canEvent && canTask) kind = "task";
  if (kind === "event") {
    const start = hhmm(p?.start);
    return {
      kind: "event",
      event: {
        title,
        date: date ?? dayString(tz),
        start,
        end: start ? (hhmm(p?.end) ?? `${String((Number(start.slice(0, 2)) + 1) % 24).padStart(2, "0")}${start.slice(2)}`) : undefined,
        allDay: !start,
        location: p?.location || undefined,
      },
    };
  }
  const priority = ({ high: 5, medium: 3, low: 1, none: 0 } as const)[p?.priority ?? "none"] ?? 0;
  return { kind: "task", task: { title, date, time: hhmm(p?.start), priority } };
}
