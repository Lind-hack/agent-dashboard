import fs from "node:fs";
import path from "node:path";
import { agenda, calendarConnected } from "./calendar";
import { clockNow, coachNow, coachTz, dayProgress, goalProgress } from "./coach";
import { DATA_DIR } from "./config";
import { readDone, readMail, readPiles } from "./gmail";
import { groqJSON } from "./groq";
import { nemotron, nvidiaReady } from "./nvidia";
import { remainingMin, todosFor } from "./todos";

// The Day assistant (v5): knows today's plan, tasks, calendar and goals, and helps Lind finish the day.
// - chat: quick back-and-forth on a fast model (Groq, then Nemotron). Replies may carry actions —
//   add a task, schedule one, tick one, move a block, re-plan — that Lind applies with one tap.
// - briefings: gpt-6.1-sol writes the morning plan, the midday re-plan and the evening review
//   (runner/assistant.ts), stored in data/assistant/brief-<day>-<slot>.json and pushed.

export type AssistantAction =
  | { type: "add_task"; title: string; estimateMin?: number; priority?: 0 | 1 | 2 | 3; due?: string; goalId?: string; subtasks?: string[] }
  | { type: "schedule"; taskId: string; start?: string; length?: number }
  | { type: "done"; taskId: string }
  | { type: "move_block"; blockId: string }
  | { type: "focus"; blockId: string }
  | { type: "replan"; note?: string }
  | { type: "add_event"; title: string; date: string; start?: string; end?: string }
  | { type: "draft_reply"; mailId: string; note?: string };

export type ChatTurn = { role: "lind" | "assistant"; text: string; at: string; actions?: (AssistantAction & { label: string })[]; model?: string };
export type BriefSlot = "morning" | "midday" | "evening";
export type Brief = {
  day: string;
  slot: BriefSlot;
  headline: string; // one line, also the push title
  body: string; // markdown
  focus: string[]; // the 1-3 things that matter most now
  actions: (AssistantAction & { label: string })[];
  model: string;
  createdAt: string;
};

const dir = () => path.join(DATA_DIR, "assistant");
const chatFile = (day: string) => path.join(dir(), `chat-${day}.json`);
const briefFile = (day: string, slot: BriefSlot) => path.join(dir(), `brief-${day}-${slot}.json`);
const requestFile = () => path.join(dir(), "brief-request.json");

function readJSON<T>(f: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(f, "utf8")) ?? fallback;
  } catch {
    return fallback;
  }
}
function writeJSON(f: string, v: unknown) {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(`${f}.${process.pid}.tmp`, JSON.stringify(v, null, 2));
  fs.renameSync(`${f}.${process.pid}.tmp`, f);
}

export const readChat = (day: string): ChatTurn[] => {
  const v = readJSON<unknown>(chatFile(day), []);
  return Array.isArray(v) ? (v as ChatTurn[]).filter((t) => t?.text && (t.role === "lind" || t.role === "assistant")) : [];
};
export const writeChat = (day: string, turns: ChatTurn[]) => writeJSON(chatFile(day), turns.slice(-60));

export const readBrief = (day: string, slot: BriefSlot): Brief | null => {
  const b = readJSON<Brief | null>(briefFile(day, slot), null);
  return b?.headline ? { ...b, focus: Array.isArray(b.focus) ? b.focus : [], actions: Array.isArray(b.actions) ? b.actions : [] } : null;
};
export const saveBrief = (b: Brief) => writeJSON(briefFile(b.day, b.slot), b);
// The newest briefing today (evening > midday > morning).
export const latestBrief = (day: string): Brief | null => readBrief(day, "evening") ?? readBrief(day, "midday") ?? readBrief(day, "morning");

// "Ask Sol now" from the page: the runner picks the request up (Sol takes a minute; the web request
// can't wait that long behind the tunnel).
export const requestBrief = (slot: BriefSlot) => writeJSON(requestFile(), { slot, at: new Date().toISOString() });
// The runner claims a request by renaming it (atomic, so a newer request written meanwhile is never
// lost) and removes the claim only when Sol has finished — the page shows "thinking" until then.
const claimFile = () => path.join(dir(), "brief-claimed.json");
export const takeBriefRequest = (): { slot: BriefSlot; at: string } | null => {
  try {
    fs.renameSync(requestFile(), claimFile());
  } catch {
    return null;
  }
  const r = readJSON<{ slot?: BriefSlot; at?: string } | null>(claimFile(), null);
  if (!r?.slot || !r.at) {
    fs.rmSync(claimFile(), { force: true });
    return null;
  }
  return { slot: r.slot, at: r.at };
};
export const finishBriefRequest = () => fs.rmSync(claimFile(), { force: true });
const fresh = (f: string) => {
  try {
    return Date.now() - fs.statSync(f).mtimeMs < 15 * 60_000;
  } catch {
    return false;
  }
};
export const briefPending = () => fs.existsSync(requestFile()) || fresh(claimFile());

// The emails sorted into "Reply today" / "Leads" that aren't done yet (newest 6).
function waitingMail() {
  const piles = readPiles();
  const done = readDone();
  return readMail()
    .messages.filter((m) => !done[m.id] && (piles[m.id]?.pile === "reply" || piles[m.id]?.pile === "leads"))
    .slice(0, 6);
}

const fmt = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}` : `${m}m`);

// Everything the assistant needs about today, as compact text with the ids actions refer to.
export async function dayContext(): Promise<string> {
  const tz = coachTz();
  const c = coachNow();
  const p = await dayProgress();
  const t = todosFor(c.day);
  const goals = goalProgress();
  let events: string[] = [];
  if (calendarConnected()) {
    const a = await agenda(1).catch(() => null);
    events = (a?.events ?? []).filter((e) => !e.planned && !e.allDay).map((e) => `${clockNow(tz, new Date(e.start))}-${clockNow(tz, new Date(e.end))} ${e.title}`);
  }
  const pri = ["none", "low", "medium", "high"];
  const task = (x: (typeof t.today)[number]) =>
    `- [${x.id}] ${x.title} | ${pri[x.priority]} | ${fmt(remainingMin(x))} left of ${fmt(x.estimateMin)}${x.due ? ` | due ${x.due.replace("T", " ")}` : ""}${x.goalId ? ` | goal ${x.goalId}` : ""}${x.subtasks.length ? ` | steps ${x.subtasks.filter((s) => s.done).length}/${x.subtasks.length}` : ""}`;
  return [
    `Now ${clockNow(tz)} on ${c.day} (${tz}). Work day ends ${process.env.PLAN_DAY_END ?? "23:00"}: ${fmt(p.untilEndMin)} left, ${fmt(p.freeMin)} of it free of calendar events.`,
    `Progress: ${p.percent}% of today's work done (expected ~${p.expected}% by now → ${p.pace}). Tasks ${p.tasksDone}/${p.tasksTotal}. ${fmt(p.workLeftMin)} of task work left${p.overloadMin ? ` — ${fmt(p.overloadMin)} MORE than the free time left` : ""}. Blocks ${p.blocksDone}/${p.blocksTotal}, ${fmt(p.focusMin)} focused.${p.blocks ? ` Time blocking: ${fmt(p.blocks.doneMin)} of the ${fmt(p.blocks.dueMin)} planned so far actually done (${p.blocks.behindMin ? `${fmt(p.blocks.behindMin)} behind` : "on track"})${p.blocks.missed.length ? `; missed blocks: ${p.blocks.missed.map((m) => `[${m.id}] ${m.start} ${m.title}`).join(", ")}` : ""}.` : ""}`,
    `Current block: ${c.current ? `[${c.current.id}] ${c.current.start}-${c.current.end} ${c.current.title} (${c.current.status})` : "none"}. Next: ${c.next ? `[${c.next.id}] ${c.next.start} ${c.next.title}` : "none"}.`,
    `Plan blocks still open:\n${c.blocks.map((b) => `- [${b.id}] ${b.start}-${b.end} ${b.title} (${b.status}${b.goal ? `, goal ${b.goal.id}` : ""})`).join("\n") || "none"}`,
    `Calendar events today:\n${events.map((e) => `- ${e}`).join("\n") || "none"}`,
    `Overdue tasks:\n${t.overdue.map(task).join("\n") || "none"}`,
    `Today's open tasks:\n${t.today.map(task).join("\n") || "none"}`,
    `Done today: ${t.done.map((x) => x.title).join("; ") || "nothing yet"}`,
    `Email waiting on him (id | from | subject):\n${waitingMail().map((m) => `- [${m.id}] ${m.from}${m.account ? ` → ${m.account}` : ""} | ${m.subject}`).join("\n") || "none"}`,
    `Goals (id | title | next action | this week):\n${goals.map((g) => `- [${g.goal.id}] ${g.goal.title} | next: ${g.goal.next || "—"} | ${fmt(g.weekMin)} of ${fmt(g.targetMin)}, ${g.streak}-day streak`).join("\n") || "none"}`,
  ].join("\n\n");
}

export const ACTIONS_SPEC = `Actions Lind can apply with one tap (only use ids that appear above; never invent them):
{"type":"add_task","title":string,"estimateMin":number,"priority":0-3,"due":"YYYY-MM-DD" or "YYYY-MM-DDTHH:MM" (optional),"goalId":string (optional),"subtasks":[string] (optional)}
{"type":"schedule","taskId":string,"start":"HH:MM" (optional, else the next free slot),"length":minutes (optional)}
{"type":"done","taskId":string}
{"type":"move_block","blockId":string}  — moves a plan block to tomorrow
{"type":"focus","blockId":string}  — opens focus mode on it
{"type":"replan","note":string}  — re-plans the rest of today
{"type":"add_event","title":string,"date":"YYYY-MM-DD","start":"HH:MM","end":"HH:MM"}  — puts an event on his Google Calendar (with alarms)
{"type":"draft_reply","mailId":string,"note":string}  — writes a reply into his Gmail Drafts (never sends); note = what to say
Each action also has "label": the button text, 2-5 words.`;

const VOICE = `You are Lind's day assistant. He's a first-year CS student in Pristina running AI products, a 200k-follower TikTok and a news site, and he wants to finish everything he planned today and move his goals every day. Be a sharp, warm coach: short, concrete, honest about time. Prefer the smallest next step that starts now. Reply in the language he writes in.`;

export function cleanActions(raw: unknown): (AssistantAction & { label: string })[] {
  const types = ["add_task", "schedule", "done", "move_block", "focus", "replan", "add_event", "draft_reply"];
  return (Array.isArray(raw) ? raw : [])
    .filter((a) => a && typeof a === "object" && types.includes((a as { type?: string }).type ?? ""))
    .map((a) => ({ ...(a as AssistantAction), label: String((a as { label?: string }).label ?? "Apply").slice(0, 40) }))
    .slice(0, 4);
}

// One chat reply. Groq first (fast), Nemotron when Groq is out of quota.
export async function chatReply(day: string, message: string): Promise<ChatTurn> {
  const history = readChat(day).slice(-10);
  const system = `${VOICE}
Answer from the live context below. Keep replies under ~120 words unless he asks for more. When an action would help, propose it.
Return JSON: {"reply": "<markdown>", "actions": [ ... ]}.
${ACTIONS_SPEC}`;
  const user = `${await dayContext()}\n\nConversation so far:\n${history.map((h) => `${h.role === "lind" ? "Lind" : "You"}: ${h.text}`).join("\n") || "(none)"}\n\nLind: ${message}`;
  let model = "groq";
  let out = await groqJSON<{ reply: string; actions: unknown[] }>(system, user, 0.4, { maxTokens: 900, timeoutMs: 30_000 }).catch(() => null);
  if (!out?.reply && nvidiaReady()) {
    model = "nemotron";
    const raw = await nemotron(`${system}\nReturn ONLY the JSON object.`, user, { maxTokens: 1200, temperature: 0.4 }).catch(() => "");
    const m = raw.match(/\{[\s\S]*\}/);
    try {
      out = m ? JSON.parse(m[0]) : null;
    } catch {
      out = null;
    }
  }
  return {
    role: "assistant",
    text: out?.reply?.trim() || "I couldn't think just now (both fast models are busy). Try again in a minute — or tap “Ask Sol” for a full plan.",
    actions: cleanActions(out?.actions),
    at: new Date().toISOString(),
    model,
  };
}

export const BRIEF_PROMPT: Record<BriefSlot, string> = {
  morning: `Write Lind's MORNING briefing. Lay out how today wins: the 1-3 things that matter most (tie them to his goals), the order to do them in, which task to start first and when, and what to cut if time runs short. If there's no plan yet, propose a replan action. If tasks have no time on the plan, propose schedule actions for the most important ones.`,
  midday: `Write Lind's MIDDAY check-in. Compare what's done with what was planned, say plainly whether he's on pace, and re-plan the afternoon: what to do next, what to shrink or move to tomorrow so the important things still get finished. Propose concrete actions (schedule, move_block, done, replan).`,
  evening: `Write Lind's EVENING review. Score the day honestly in one line, name what moved each goal forward, what slipped and why, and set up tomorrow: the first task to start in the morning and anything to move. Propose add_task or move_block actions for tomorrow where useful.`,
};

export function parseBrief(day: string, slot: BriefSlot, raw: Partial<{ headline: string; body: string; focus: unknown[]; actions: unknown[] }> | null, model: string): Brief | null {
  if (!raw?.headline || !raw.body) return null;
  return {
    day,
    slot,
    headline: String(raw.headline).slice(0, 120),
    body: String(raw.body).slice(0, 4000),
    focus: (Array.isArray(raw.focus) ? raw.focus : []).map(String).slice(0, 3),
    actions: cleanActions(raw.actions),
    model,
    createdAt: new Date().toISOString(),
  };
}

export const BRIEF_SYSTEM = `${VOICE}
Return JSON: {"headline": "<one line, under 70 chars, works as a phone notification title>", "body": "<markdown, 80-200 words>", "focus": ["<the 1-3 things that matter most>"], "actions": [ ... ]}.
${ACTIONS_SPEC}`;
