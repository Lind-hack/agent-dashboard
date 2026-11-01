import fs from "node:fs";
import path from "node:path";
import { ImageResponse } from "next/og";
import type { CSSProperties, ReactNode } from "react";
import type { WidgetData } from "./data";
import { AGENT_LABELS } from "../agents";
import { CLAUDE_MARK, NOUS_MARK, OPENAI_MARK, OPENCODE_MARK } from "../agent-marks";
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
  ok: token("color-ok"), warn: token("color-warn"), bad: token("color-bad"),
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
const col: CSSProperties = { display: "flex", flexDirection: "column", minWidth: 0 };
const row: CSSProperties = { display: "flex", alignItems: "center", minWidth: 0 };
const mono: CSSProperties = { fontFamily: "Geist Mono", fontWeight: 500, fontSize: 20, color: c.faint, letterSpacing: "0.08em" };
const duration = (min: number) => min >= 60 ? `${Math.floor(min / 60)}h${min % 60 ? ` ${min % 60}m` : ""}` : `${min}m`;
const dateTime = (iso: string, tz: string) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
// Bound text by conservative font-advance estimates: WWW and iii must both fit.
// These conservative Geist widths reserve room for the ellipsis at every body size.
export function fitText(text: string, width: number, fontSize = 26) {
  const clean = clip(text, 500);
  const advance = (ch: string) => /[MW@%&]/.test(ch) ? 1 : /[ilI.,:;'!| ]/.test(ch) ? 0.32 : /[A-Z0-9]/.test(ch) ? 0.7 : 0.6;
  let used = 0, result = "";
  for (const ch of clean) {
    used += advance(ch) * fontSize;
    if (used > width - fontSize) return result.trimEnd() + "…";
    result += ch;
  }
  return result;
}
function Label({ children, color = c.faint }: { children: ReactNode; color?: string }) {
  return <span style={{ ...mono, color }}>{children}</span>;
}
function Text({ children, width, size = 26, color = c.text }: { children: string; width: number; size?: number; color?: string }) {
  return <span style={{ fontSize: size, lineHeight: 1.25, color, whiteSpace: "nowrap" }}>{fitText(children, width, size)}</span>;
}
function Scale({ percent, width, color = c.hud }: { percent: number; width: number; color?: string }) {
  return <div style={{ ...row, gap: 4, width, height: 10 }}>{Array.from({ length: 24 }, (_, i) => <div key={i} style={{ width: (width - 92) / 24, height: 8, borderRadius: 2, backgroundColor: i < Math.round(percent * 24 / 100) ? color : "rgba(169,228,245,0.12)" }} />)}</div>;
}
function Ring({ percent, available, color, diameter = 108 }: { percent: number; available: boolean; color: string; diameter?: number }) {
  return <div style={{ ...row, justifyContent: "center", width: diameter, height: diameter, position: "relative", flexShrink: 0, borderRadius: diameter / 2, backgroundImage: "radial-gradient(circle at 34% 25%, rgba(169,228,245,0.14), rgba(8,8,10,0.2) 55%, rgba(0,0,0,0.8) 80%)", boxShadow: "0 1px 0 rgba(255,255,255,0.15) inset, 0 12px 20px rgba(0,0,0,0.35)" }}>
    <svg width={diameter} height={diameter} viewBox="0 0 120 120" style={{ position: "absolute", top: 0, left: 0 }}>
      <circle cx="60" cy="60" r="56" stroke="rgba(169,228,245,0.12)" strokeWidth="1" fill="none" />
      <circle cx="60" cy="60" r="48" stroke="rgba(169,228,245,0.12)" strokeWidth="6" fill="none" />
      <circle cx="60" cy="60" r="48" stroke={color} strokeWidth="6" fill="none" strokeDasharray={`${available ? Math.max(0, Math.min(100, percent)) * 3.016 : 0} 302`} transform="rotate(-90 60 60)" strokeLinecap={percent > 0 ? "round" : "butt"} />
    </svg>
    <span style={{ fontSize: 32, fontWeight: 600, letterSpacing: "-0.04em" }}>{available ? `${percent}%` : "—"}</span>
  </div>;
}
function AgentMark({ agent }: { agent: WidgetData["agents"][number]["agent"] }) {
  const color = token(`color-${agent}`);
  const paths = agent === "claude" ? CLAUDE_MARK : agent === "hermes" ? NOUS_MARK : OPENAI_MARK;
  return <div style={{ ...row, width: 30, height: 30, justifyContent: "center", backgroundColor: "#0d0d11", border: `1px solid ${color}`, borderRadius: 9, flexShrink: 0 }}>
    <svg width="21" height="21" viewBox={agent === "opencode" ? "0 0 240 300" : "0 0 24 24"} fill={color} fillRule="evenodd">
      {agent === "opencode" ? <path d={OPENCODE_MARK.frame} /> : paths.map((p, i) => <path key={i} d={p} />)}
    </svg>
  </div>;
}

export function widgetContent(data: WidgetData, view: WidgetView) {
  const p = data.progress;
  const now = Date.parse(data.at);
  const current = data.focus.current;
  const tasks = [...data.tasks.overdue, ...data.tasks.today].sort((a, b) =>
    Number(data.tasks.overdue.includes(b)) - Number(data.tasks.overdue.includes(a)) || b.priority - a.priority || (a.due ?? "9999").localeCompare(b.due ?? "9999"));
  const nextEvent = data.calendar.events.find((e) => !e.allDay && Date.parse(e.end) > now);
  const allDay = data.calendar.events.filter((e) => e.allDay);
  const upcoming = data.blocks.filter((b) => b.status !== "done" && b.id !== current?.id && b.start > clock(data.at, data.tz)).sort((a, b) => a.start.localeCompare(b.start));
  const taskRows = tasks.map((t) => ({ title: t.title, detail: `${data.tasks.overdue.includes(t) ? "OVERDUE" : t.priority === 3 ? "HIGH PRIORITY" : "TASK"}${t.due ? ` · ${t.due.length === 10 ? t.due : dateTime(t.due, data.tz)}` : " · Today"}`, color: data.tasks.overdue.includes(t) ? c.bad : t.priority === 3 ? c.warn : c.faint }));
  const goalRows = data.goals.map((g) => ({ title: g.goal.title, detail: `${g.weekMin}/${g.targetMin} MIN THIS WEEK` }));
  const focusRows = [
    ...(current ? [{ title: current.title, detail: `${current.start}–${current.end}` }] : []),
    ...data.blocks.filter((b) => b.status === "done" && b.kind !== "break").map((b) => ({ title: b.title, detail: `SESSION COMPLETE · ${b.start}–${b.end}` })),
  ];
  const rows = view === "goals" ? goalRows : view === "focus" ? [...focusRows, ...taskRows] : [...focusRows, ...taskRows, ...data.calendar.events.map((e) => ({ title: e.title, detail: e.allDay ? "ALL DAY" : clock(e.start, data.tz) }))];
  const nextAction = view === "goals" && data.goals.length ? { title: data.goals[0].goal.next || data.goals[0].goal.title, detail: "GOAL · NEXT ACTION" }
    : current ? { title: current.title, detail: `${current.start}–${current.end}` }
    : tasks[0] ? { title: tasks[0].title, detail: tasks[0].due ? `Due ${tasks[0].due.length === 10 ? tasks[0].due : dateTime(tasks[0].due, data.tz)}` : "Today · Unscheduled" } : (upcoming[0] ? { title: upcoming[0].title, detail: `${upcoming[0].start}–${upcoming[0].end}` } : nextEvent ? { title: nextEvent.title, detail: clock(nextEvent.start, data.tz) } : { title: "Your day is open", detail: "No next action scheduled" });
  const alerts = [
    ...(p.overloadMin > 0 ? [`${duration(p.overloadMin)} over capacity`] : []),
    ...(p.pace === "behind" ? [p.blocks?.behindMin ? `${duration(Math.round(p.blocks.behindMin))} behind schedule` : `${p.percent}% complete · ${p.expected}% expected`] : []),
    ...(data.blocks.some((b) => b.status === "blocked") ? ["A planned block is blocked"] : []),
  ];
  return { tasks, taskRows, rows, nextAction, current, upcoming, nextEvent, allDay, alerts,
    available: p.tasksTotal > 0 || p.blocksTotal > 0,
    color: alerts.length ? c.warn : p.percent >= 80 ? c.ok : c.hud,
    pace: p.pace === "not-started" ? "NOT STARTED" : p.pace.replace("-", " ").toUpperCase(),
    calendar: data.calendar.syncedAt ? `Cal sync ${dateTime(data.calendar.syncedAt, data.tz)}` : "Calendar unavailable",
  };
}

function Hero({ data, compact = false }: { data: WidgetData; compact?: boolean }) {
  const m = widgetContent(data, "today"), p = data.progress;
  return <div style={{ ...row, height: compact ? 100 : 110, width: compact ? 460 : 480, flexShrink: 0, gap: 22, position: "relative" }}>
    <Ring percent={p.percent} available={m.available} color={m.color} diameter={compact ? 100 : 116} />
    <div style={{ ...col, gap: 9, flex: 1 }}>
      <Label color={m.color}>{m.available ? m.pace : "DAY OVERVIEW"}</Label>
      <span style={{ fontSize: 30, fontWeight: 600 }}>{p.tasksTotal ? `${p.tasksDone} done · ${p.tasksTotal - p.tasksDone} left` : p.blocksTotal ? `${p.blocksDone} of ${p.blocksTotal} blocks done` : "No tasks planned"}</span>
      <Scale percent={m.available ? p.percent : 0} width={compact ? 260 : 320} color={m.color} />
    </div>
  </div>;
}
function Focus({ data, width, compact = false }: { data: WidgetData; width: number; compact?: boolean }) {
  const b = data.focus.current;
  const running = b?.status === "running";
  const elapsed = running && b.startedAt ? Math.max(0, Math.floor((Date.parse(data.at) - Date.parse(b.startedAt)) / 60000)) : null;
  return <div style={{ ...col, gap: 6 }}>
    <Label color={running ? c.hud : b?.status === "blocked" ? c.bad : c.faint}>{compact && b ? `${b.status.toUpperCase()} · ${b.start}–${b.end}` : running ? "FOCUS · RUNNING" : b ? `FOCUS · ${b.status.toUpperCase()}` : "CURRENT FOCUS"}</Label>
    <Text width={width}>{b?.title ?? "No active session"}</Text>
    {b && !compact && <span style={{ ...mono, letterSpacing: 0 }}>{b.start}–{b.end}{elapsed !== null ? ` · ${duration(elapsed)} elapsed` : ""}</span>}
  </div>;
}
function Event({ data, width }: { data: WidgetData; width: number }) {
  const m = widgetContent(data, "today"), e = m.nextEvent;
  return <div style={{ ...col, gap: 6 }}>
    <Label>NEXT CALENDAR</Label>
    <Text width={width}>{e ? `${Date.parse(e.start) <= Date.parse(data.at) ? "Now" : clock(e.start, data.tz)} · ${e.title}` : !data.calendar.syncedAt ? "Calendar unavailable" : m.allDay[0] ? `All day · ${m.allDay[0].title}` : "No more events today"}</Text>
  </div>;
}
function Footer({ data, small = false }: { data: WidgetData; small?: boolean }) {
  return <div style={{ ...row, justifyContent: "space-between", marginTop: "auto", paddingTop: 10 }}>
    <span style={{ ...mono, fontSize: 20, letterSpacing: 0, color: c.hud }}>Updated {clock(data.at, data.tz)}</span>
    {!small && <span style={{ ...mono, fontSize: 20, letterSpacing: 0 }}>{widgetContent(data, "today").calendar}</span>}
  </div>;
}
function Goals({ data, width, count }: { data: WidgetData; width: number; count: number }) {
  return <div style={{ ...col, gap: 8, width }}>
    <Label>GOALS · WEEK</Label>
    {!data.goals.length && <Text width={width} color={c.muted}>No active goals</Text>}
    {data.goals.slice(0, count).map((g) => <div key={g.goal.id} style={{ ...col, gap: 6 }}>
      <Text width={width} size={24}>{g.goal.title}</Text>
      <div style={{ ...row, justifyContent: "space-between" }}>
        <Scale percent={g.targetMin > 0 ? Math.min(100, g.weekMin / g.targetMin * 100) : 0} width={width - 164} color={g.targetMin > 0 && g.weekMin >= g.targetMin ? c.ok : c.hud} />
        <span style={{ ...mono, fontSize: 20, letterSpacing: 0 }}>{fitText(g.targetMin > 0 ? `${duration(g.weekMin)} / ${duration(g.targetMin)}` : `${duration(g.weekMin)} logged`, 164, 20)}</span>
      </div>
    </div>)}
  </div>;
}

export function widgetElement(data: WidgetData, view: WidgetView, size: WidgetSize) {
  const m = widgetContent(data, view), p = data.progress;
  const small = size === "small", large = size === "large";
  return <div style={{ ...col, position: "relative", width: "100%", height: "100%", padding: 32, backgroundColor: c.bg, color: c.text, fontFamily: "Geist", fontSize: 26, lineHeight: 1.15,
    backgroundImage: "radial-gradient(ellipse at 65% 0%, rgba(169,228,245,0.16), transparent 65%), linear-gradient(150deg, rgba(255,255,255,0.045), transparent 45%)" }}>
    {/* A baked instrument grid and specular edge: no unsupported filters or animation. */}
    <div style={{ position: "absolute", display: "flex", top: 0, left: 0, width: "100%", height: "100%" }}>
      {Array.from({ length: small ? 7 : 15 }, (_, i) => <div key={`x${i}`} style={{ position: "absolute", left: i * 48, top: 0, width: 1, height: large ? 240 : 160, backgroundImage: "linear-gradient(rgba(169,228,245,0.05), transparent)" }} />)}
      {[48, 96, 144, 192].map((y) => <div key={y} style={{ position: "absolute", top: y, left: 0, width: "100%", height: 1, backgroundColor: "rgba(169,228,245,0.035)" }} />)}
      <div style={{ position: "absolute", left: 20, right: 20, top: 16, height: 1, backgroundImage: "linear-gradient(90deg, transparent, rgba(169,228,245,0.5), transparent)" }} />
      {[false, true].map((right) => <div key={String(right)} style={{ position: "absolute", top: 27, ...(right ? { right: 22 } : { left: 22 }), width: 12, height: 22, borderTop: `1px solid ${c.hud}`, ...(right ? { borderRight: `1px solid ${c.hud}` } : { borderLeft: `1px solid ${c.hud}` }), opacity: 0.45 }} />)}
    </div>
    <div style={{ ...row, height: 32, flexShrink: 0, justifyContent: "space-between", marginBottom: small ? 18 : 12 }}>
      <span style={{ fontWeight: 600, fontSize: small ? 26 : 28, letterSpacing: "-0.035em" }}>{view === "today" ? "Daily command" : view === "goals" ? "Goal command" : "Focus command"}</span>
      {!small && data.agents.length > 0 && large ? <div style={{ ...row, gap: 8 }}><AgentMark agent={data.agents[0].agent} /><Text width={340} size={22} color={token(`color-${data.agents[0].agent}`)}>{`${AGENT_LABELS[data.agents[0].agent]} · ${data.agents[0].status}`}</Text></div> : !small && <Label>{new Intl.DateTimeFormat("en-GB", { timeZone: data.tz, weekday: "short", day: "2-digit", month: "short" }).format(new Date(data.at)).toUpperCase()}</Label>}
    </div>
    {small ? <div style={{ ...col, flex: 1 }}>
      <div style={{ ...row, justifyContent: "space-between", marginBottom: 20 }}>
        <span style={{ fontSize: 36, fontWeight: 600, color: m.color }}>{m.available ? `${p.percent}%` : "—"}</span>
        <Scale percent={m.available ? p.percent : 0} width={172} color={m.color} />
      </div>
      <div style={{ ...col, gap: 10 }}>
        <Label>{m.current?.status === "running" ? "FOCUS NOW" : "NEXT ACTION"}</Label>
        <Text width={276} size={28}>{m.nextAction.title}</Text>
        <Text width={276} size={22} color={c.muted}>{m.nextAction.detail}</Text>
      </div>
      <Footer data={data} small />
    </div> : large ? <div style={{ ...col, flex: 1 }}>
      <div style={{ ...row, borderBottom: `1px solid ${c.line}`, paddingBottom: 10, marginBottom: 12, backgroundImage: "linear-gradient(180deg, rgba(255,255,255,0.025), transparent)", borderRadius: c.radius, justifyContent: "space-between", flexShrink: 0 }}>
        <Hero data={data} />
        <div style={{ ...col, width: 155, gap: 8, paddingLeft: 12, borderLeft: `1px solid ${c.line}` }}>
          <Label>FOCUS DONE</Label><span style={{ fontSize: 30, fontWeight: 600 }}>{duration(p.focusMin)}</span>
          <Label>FREE EST.</Label><span style={{ fontSize: 26 }}>{duration(p.freeMin)}</span>
        </div>
      </div>
      <div style={{ ...row, alignItems: "flex-start", height: 140, flexShrink: 0, gap: 24, marginBottom: 12 }}>
        <div style={{ ...col, width: 320, gap: 9 }}>
          <div style={{ ...row, justifyContent: "space-between" }}><Label>TIME RAIL</Label><Label color={c.hud}>NOW {clock(data.at, data.tz)}</Label></div>
          <Focus data={data} width={320} compact />
          {m.upcoming.slice(0, 1).map((b) => <div key={b.id} style={{ ...row, gap: 10 }}><Label>{b.start}</Label><Text width={240} size={24}>{b.title}</Text></div>)}
        </div>
        <div style={{ ...col, width: 320, gap: 8, paddingLeft: 20, borderLeft: `1px solid ${c.line}` }}>
          <Label>TOP PRIORITIES</Label>
          {m.taskRows.length ? m.taskRows.slice(0, 3).map((t, i) => <div key={i} style={{ ...row, gap: 10, height: 32 }}><span style={{ ...mono, color: t.color }}>{String(i + 1).padStart(2, "0")}</span><Text width={260} size={24}>{t.title}</Text></div>) : <Text width={300} color={c.muted}>No open tasks today</Text>}
        </div>
      </div>
      <div style={{ borderTop: `1px solid ${c.line}`, borderBottom: `1px solid ${c.line}`, padding: "10px 0", flexShrink: 0, ...col }}><Event data={data} width={664} /></div>
      <div style={{ ...row, alignItems: "flex-start", gap: 24, marginTop: 12, height: 144, flexShrink: 0 }}>
        <Goals data={data} width={320} count={2} />
        <div style={{ ...col, width: 320, paddingLeft: 20, gap: 8, borderLeft: `1px solid ${c.line}` }}>
          <Label>HABITS · STREAKS</Label>
          {data.habits.length ? data.habits.slice(0, 3).map((h) => <div key={h.habit.id} style={{ ...row, justifyContent: "space-between", gap: 12, height: 30 }}><Text width={148} size={24} color={h.done ? c.ok : c.text}>{h.habit.title}</Text><span style={{ ...mono, letterSpacing: 0, color: h.done ? c.ok : c.faint }}>{fitText(`${h.done ? "Done" : `${h.value}/${h.habit.target}`}${h.streak ? ` · ${h.streak}d` : ""}`, 140, 20)}</span></div>) : <Text width={300} color={c.muted}>No habits scheduled</Text>}
        </div>
      </div>
      <div style={{ ...row, gap: 10, marginTop: 8, height: 30, flexShrink: 0 }}>
        {m.alerts.length ? <Text width={664} size={23} color={c.warn}>{m.alerts.join(" · ")}</Text> : <Text width={664} size={23} color={c.muted}>{m.available ? `${duration(p.workLeftMin)} work remaining · ${m.pace.toLowerCase()}` : "Add tasks or time blocks to shape today"}</Text>}
      </div>
      <Footer data={data} />
    </div> : <div style={{ ...col, flex: 1 }}>
      <div style={{ ...row, alignItems: "flex-start", gap: 24, height: 214 }}>
        <div style={{ ...col, width: 292, gap: 10, paddingRight: 20, borderRight: `1px solid ${c.line}` }}>
          <div style={{ ...row, gap: 14 }}><Ring percent={p.percent} available={m.available} color={m.color} diameter={100} /><div style={{ ...col, gap: 8 }}><Label color={m.color}>DAY DONE</Label><span style={{ fontSize: 25 }}>{p.tasksTotal ? `${p.tasksDone} done` : "No tasks"}</span><span style={{ fontSize: 25 }}>{p.tasksTotal ? `${p.tasksTotal - p.tasksDone} left` : "planned"}</span></div></div>
          <span style={{ fontSize: 25 }}>{duration(p.focusMin)} focus done</span>
          <span style={{ ...mono, letterSpacing: 0 }}>{duration(p.freeMin)} free · est.</span>
          <Label color={m.color}>{m.available ? m.pace : "DAY OPEN"}</Label>
        </div>
        <div style={{ ...col, width: 348, gap: 18 }}>
          {view === "goals" ? <Goals data={data} width={348} count={1} /> : <Focus data={data} width={348} />}
          {!m.current && view !== "goals" && m.tasks[0] && <Text width={348} size={24} color={c.muted}>{`Next: ${m.tasks[0].title}`}</Text>}
          <Event data={data} width={348} />
        </div>
      </div>
      <Footer data={data} />
    </div>}
  </div>;
}

export async function renderWidget(data: WidgetData, view: WidgetView, size: WidgetSize) {
  const image = new ImageResponse(widgetElement(data, view, size), { ...WIDGET_SIZES[size], fonts });
  return new Response(await image.arrayBuffer(), { headers: { ...WIDGET_HEADERS, "Content-Type": "image/png" } });
}
