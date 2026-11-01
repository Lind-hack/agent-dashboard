import fs from "node:fs";
import path from "node:path";
import { ImageResponse } from "next/og";
import type { CSSProperties } from "react";
import type { WidgetData } from "./data";
import { WIDGET_HEADERS } from "./auth";

export const WIDGET_SIZES = {
  small: { width: 340, height: 340 },
  medium: { width: 728, height: 340 },
  large: { width: 728, height: 764 },
} as const;
export type WidgetSize = keyof typeof WIDGET_SIZES;
export type WidgetView = "today" | "goals" | "focus";

// Read the actual theme instead of maintaining a separate widget palette. Fonts are bundled,
// so personal text is never sent to a font service (including Satori's missing-glyph fallback).
const css = fs.readFileSync(path.join(process.cwd(), "app/globals.css"), "utf8");
function token(name: string) {
  const value = css.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1];
  if (!value) throw new Error("Missing widget design token");
  return value;
}
export const widgetTheme = {
  bg: token("color-bg"), text: token("color-text"), muted: token("color-muted"),
  faint: token("color-faint"), line: token("color-line"), hud: token("color-hud"),
  radius: parseInt(token("radius-panel")),
};
const fonts = [
  { name: "Geist", file: "Geist-Regular.ttf", weight: 400 as const },
  { name: "Geist", file: "Geist-SemiBold.ttf", weight: 600 as const },
  { name: "Geist Mono", file: "GeistMono-Medium.ttf", weight: 500 as const },
].map(({ file, ...font }) => ({ ...font, data: fs.readFileSync(path.join(process.cwd(), "lib/widget/fonts", file)) }));
const c = widgetTheme;
const clip = (text: string, max: number) => {
  // Geist covers Latin (including Albanian) and these punctuation marks. Replace other
  // scripts/emoji locally; ImageResponse otherwise sends missing text to Google Fonts.
  const chars = Array.from(text.replace(/[\r\n\t]/g, " ").replace(/[^\u0020-\u007e\u00a0-\u024f–—‘’“”•…]/gu, "?"));
  return chars.length > max ? chars.slice(0, max - 1).join("") + "…" : chars.join("");
};
const clock = (iso: string, tz: string) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
export type WidgetRow = { title: string; detail: string };

export function widgetContent(data: WidgetData, view: WidgetView) {
  const openTasks = [...data.tasks.overdue, ...data.tasks.today];
  const habits = `${data.habits.filter((h) => h.done).length}/${data.habits.length} habits`;
  const blocks = `${data.focus.done}/${data.focus.total} blocks`;
  const focus = `${data.focus.focusMin} min focus`;
  const calendar = data.calendar.syncedAt
    ? `Calendar synced ${new Intl.DateTimeFormat("en-GB", { timeZone: data.tz, day: "2-digit", month: "short" }).format(new Date(data.calendar.syncedAt))} ${clock(data.calendar.syncedAt, data.tz)}`
    : "Calendar unavailable";
  const taskRows = openTasks.map((t) => ({ title: t.title, detail: `TASK · ${t.due ? `due ${t.due}` : "Today"}` }));
  const eventRows = data.calendar.events.map((e) => ({ title: e.title, detail: `CALENDAR · ${e.allDay ? "All day" : clock(e.start, data.tz)}` }));
  const current = data.focus.current;
  if (view === "goals") return {
    title: "Goals", metric: `${data.goals.length}`, unit: "active goals",
    readout: `${focus} · ${openTasks.length} open tasks · ${habits}`,
    rows: data.goals.map(({ goal, weekMin, targetMin }) => ({ title: goal.title, detail: `${weekMin}/${targetMin} MIN THIS WEEK${goal.next ? ` · ${goal.next}` : ""}` })),
    empty: "No active goals", footer: `${blocks} · ${data.calendar.events.length} events`, calendar,
  };
  if (view === "focus") return {
    title: "Focus", metric: String(data.focus.focusMin), unit: "minutes completed",
    readout: `${blocks} · ${data.goals.length} goals · ${habits}`,
    rows: [
      ...(current ? [{ title: current.title, detail: `${current.status === "running" ? "RUNNING" : "SCHEDULED"} · ${current.start}–${current.end}` }] : []),
      ...data.blocks.filter((b) => b.status === "done" && b.kind !== "break").map((b) => ({ title: b.title, detail: `SESSION COMPLETE · ${b.start}–${b.end}` })),
      ...taskRows, ...eventRows,
    ],
    empty: "No focus sessions today", footer: `${openTasks.length} open tasks · ${data.calendar.events.length} events`, calendar,
  };
  return {
    title: "Today", metric: String(openTasks.length), unit: "open tasks",
    readout: `${blocks} · ${focus} · ${habits}`,
    rows: [
      ...data.blocks.filter((b) => b.status !== "done").map((b) => ({ title: b.title, detail: `PLAN · ${b.start}–${b.end} · ${b.status}` })),
      ...eventRows, ...taskRows,
    ],
    empty: "Nothing scheduled today", footer: `${data.goals.length} active goals · ${data.calendar.events.length} events`, calendar,
  };
}

export function widgetElement(data: WidgetData, view: WidgetView, size: WidgetSize) {
  const content = widgetContent(data, view);
  const small = size === "small";
  const large = size === "large";
  const rowCount = large ? 4 : 1;
  const rows = content.rows.slice(0, rowCount);
  const label: CSSProperties = { fontFamily: "Geist Mono", fontWeight: 500, fontSize: 21, letterSpacing: "0.18em", color: c.faint };
  const column: CSSProperties = { display: "flex", flexDirection: "column" };
  return <div style={{ ...column, width: "100%", height: "100%", padding: 32, backgroundColor: c.bg, color: c.text, fontFamily: "Geist", fontSize: 30, lineHeight: 1.1,
    backgroundImage: "radial-gradient(ellipse at 50% 0%, rgba(169,228,245,0.07), transparent 62%)" }}>
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", height: large ? 72 : 48 }}>
      <span style={{ fontSize: large ? 64 : 40, fontWeight: 600, letterSpacing: "-0.035em" }}>{content.title}</span>
      <span style={{ ...label, color: c.hud, letterSpacing: 0, fontSize: small ? 18 : 21 }}>{clock(data.at, data.tz)}</span>
    </div>
    <div style={{ display: "flex", alignItems: "baseline", gap: 12, height: large || small ? 64 : 56 }}>
      <span style={{ fontSize: 64, lineHeight: 1, fontWeight: 600, letterSpacing: "-0.05em", fontFeatureSettings: '"tnum"' }}>{content.metric}</span>
      <span style={{ color: c.muted, fontSize: small ? 22 : 26 }}>{small && view === "focus" ? "min done" : content.unit}</span>
    </div>
    {large && <div style={{ ...label, display: "flex", height: 40, alignItems: "center", letterSpacing: 0 }}>{content.readout.toUpperCase()}</div>}
    <div style={{ ...column, marginTop: large ? 16 : 8, paddingLeft: 24, paddingRight: 24,
      border: `2px solid ${c.line}`, borderRadius: c.radius * 2,
      backgroundImage: "linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.015))",
      boxShadow: "0 2px 0 rgba(255,255,255,0.04) inset, 0 36px 80px -48px rgba(0,0,0,0.8)" }}>
      {(rows.length ? rows : [{ title: content.empty, detail: "" }]).map((row, i) => <div key={i} style={{ ...column, justifyContent: "center", height: 112, ...(i ? { borderTop: `2px solid ${c.line}` } : {}) }}>
        <span style={{ fontSize: 30, lineHeight: 1.6 }}>{clip(row.title, small ? 14 : 36)}</span>
        <span style={{ ...label, fontSize: small ? 16 : 20, letterSpacing: 0 }}>{clip(row.detail.toUpperCase(), small ? 22 : 48)}</span>
      </div>)}
    </div>
    <div style={{ ...column, marginTop: "auto", paddingTop: 8, gap: 6 }}>
      <span style={{ ...label, fontSize: small ? 16 : large ? 20 : 18, letterSpacing: 0 }}>{small ? clip(content.readout, 24) : large ? content.footer : content.readout}</span>
      {!small && <span style={{ ...label, fontSize: large ? 18 : 16, letterSpacing: 0 }}>{content.calendar}{content.rows.length > rowCount ? ` · +${content.rows.length - rowCount} more` : ""}</span>}
    </div>
  </div>;
}

export async function renderWidget(data: WidgetData, view: WidgetView, size: WidgetSize) {
  const image = new ImageResponse(widgetElement(data, view, size), {
    ...WIDGET_SIZES[size], fonts,
  });
  // Consume the stream here: render failures become a generic private error in the route,
  // rather than escaping later into Next's response stream/logs.
  return new Response(await image.arrayBuffer(), { headers: { ...WIDGET_HEADERS, "Content-Type": "image/png" } });
}
