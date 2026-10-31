import fs from "node:fs";
import path from "node:path";
import { mirror, mirrorText, patterns } from "./accountability";
import { ACTIONS_SPEC, cleanActions, dayContext, type AssistantAction } from "./assistant";
import { addDays } from "./calendar";
import { coachNow, readRecap } from "./coach";
import { DATA_DIR } from "./config";
import { groqJSON } from "./groq";
import { moodWord, recentJournal } from "./journal";
import { recallMemory, recallText } from "./memory";
import { nemotron, nvidiaReady } from "./nvidia";

// The Buddy (v5.1): one long conversation with someone who knows Lind — his goals, his days, his
// journal, how he works — and helps him reach what he's going for. Replies come from a fast model
// (Groq, then Nemotron); every night Sol rewrites data/buddy/profile.md ("what I know about Lind")
// from the journal, this thread and the recaps (runner/buddy.ts), and every reply reads it.

export type BuddyTurn = { role: "lind" | "buddy"; text: string; at: string; voice?: boolean; actions?: (AssistantAction & { label: string })[] };

const dir = () => path.join(DATA_DIR, "buddy");
const threadFile = () => path.join(dir(), "thread.json");
export const profileFile = () => path.join(dir(), "profile.md");

function writeAtomic(f: string, body: string) {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(`${f}.${process.pid}.tmp`, body);
  fs.renameSync(`${f}.${process.pid}.tmp`, f);
}

export function readThread(): BuddyTurn[] {
  try {
    const v = JSON.parse(fs.readFileSync(threadFile(), "utf8"));
    return Array.isArray(v) ? v.filter((t) => t?.text && (t.role === "lind" || t.role === "buddy")) : [];
  } catch {
    return [];
  }
}
export const appendThread = (...turns: BuddyTurn[]) => writeAtomic(threadFile(), JSON.stringify([...readThread(), ...turns].slice(-400)));

export function readProfile(): { text: string; at?: string } {
  try {
    return { text: fs.readFileSync(profileFile(), "utf8"), at: fs.statSync(profileFile()).mtime.toISOString() };
  } catch {
    return { text: "" };
  }
}
export const saveProfile = (md: string) => writeAtomic(profileFile(), md.trim() + "\n");

export const BUDDY_VOICE = `You are Lind's Buddy: a close, honest friend and coach who knows his life. Lind is a first-year CS student in Pristina, Kosovo; he runs the @building.ai TikTok (200k followers), an AI agency and the 383 news site, and he's building toward passive income. You care about him reaching his goals AND being okay.
How you talk: like a friend texting — warm, direct, specific, a little playful; never generic self-help. Use what you know (his profile, journal, goals, today's plan) and say so ("you said on Tuesday…"). Ask one good question when it helps. When he's drifting, say it kindly and give the smallest next step. Celebrate real wins with the numbers. Reply in the language he writes in (Albanian or English).`;

function journalBlock(today: string): string {
  return (
    recentJournal(today, 7)
      .map((j) => `${j.day}:\n${j.entries.map((e) => `- ${e.mood ? `(${moodWord(e.mood)}) ` : ""}${e.text.replace(/\s+/g, " ").slice(0, 600)}`).join("\n")}`)
      .join("\n\n") || "(no journal entries this week)"
  );
}

function recapBlock(today: string): string {
  return (
    [1, 2, 3]
      .map((i) => readRecap(addDays(today, -i)))
      .filter((r): r is NonNullable<typeof r> => !!r)
      .map((r) => `${r.day}: ${r.score}/100, ${r.done}/${r.total} blocks, ${r.focusMin} focus min`)
      .join("\n") || "(no recaps)"
  );
}

export async function buddyReply(message: string, voice = false): Promise<BuddyTurn> {
  const today = coachNow().day;
  const history = readThread().slice(-16);
  const system = `${BUDDY_VOICE}
Keep it under ~150 words unless he asks for more. When something concrete would help, propose an action.
Return JSON: {"reply": "<markdown>", "actions": [ ... ]}.
${ACTIONS_SPEC}`;
  const user = [
    `What you know about Lind (your notes, updated nightly):\n${readProfile().text || "(nothing yet — learn as you go)"}`,
    `His journal, last 7 days:\n${journalBlock(today)}`,
    `Recent day scores:\n${recapBlock(today)}`,
    `Today, live:\n${await dayContext()}`,
    `From his memory (notes, chats, exports) about what he just said — cite it when it helps ("in your notes from…"):\n${recallText(await recallMemory(message, 4).catch(() => [])) || "(nothing relevant)"}`,
    `Your conversation so far:\n${history.map((h) => `${h.role === "lind" ? "Lind" : "You"} (${h.at.slice(0, 10)}): ${h.text.slice(0, 800)}`).join("\n") || "(this is your first chat)"}`,
    `Lind${voice ? " (spoken)" : ""}: ${message}`,
  ].join("\n\n");
  let out = await groqJSON<{ reply: string; actions: unknown[] }>(system, user, 0.6, { maxTokens: 1000, timeoutMs: 30_000 }).catch(() => null);
  if (!out?.reply && nvidiaReady()) {
    const raw = await nemotron(`${system}\nReturn ONLY the JSON object.`, user, { maxTokens: 1300, temperature: 0.6 }).catch(() => "");
    const m = raw.match(/\{[\s\S]*\}/);
    try {
      out = m ? JSON.parse(m[0]) : null;
    } catch {
      out = null;
    }
  }
  return {
    role: "buddy",
    text: out?.reply?.trim() || "I'm here — the models are busy for a second. Say that again in a minute?",
    actions: cleanActions(out?.actions),
    at: new Date().toISOString(),
  };
}

// The nightly profile prompt (Sol): what it reads and what it must keep.
export function profileInput(today: string): string {
  const since = new Date(Date.now() - 3 * 86_400_000).toISOString();
  return [
    `Current profile:\n${readProfile().text || "(empty — write the first one)"}`,
    `Journal, last 7 days:\n${journalBlock(today)}`,
    `Day scores:\n${recapBlock(today)}`,
    `Said vs did, block by block — today and yesterday:\n${[today, addDays(today, -1)].map((d) => `${d}:\n${mirrorText(mirror(d))}`).join("\n")}`,
    `His patterns over two weeks of time blocks:\n${patterns(today).lines.join("\n") || "(not enough blocks yet)"}`,
    `Conversations with the Buddy, last 3 days:\n${readThread()
      .filter((t) => t.at >= since)
      .map((t) => `${t.role === "lind" ? "Lind" : "Buddy"}: ${t.text.slice(0, 600)}`)
      .join("\n")}`,
  ].join("\n\n");
}

export const PROFILE_SYSTEM = `You keep the Buddy's private notes about Lind: a living profile used in every conversation. Update it from the new journal entries, scores and conversations. Keep what's still true, change what changed, drop what's stale. Be concrete (names, numbers, dates). Never invent.
Sections, as markdown with these headings: ## Right now (this week's focus, mood, energy), ## Goals and where they stand, ## What works for him, ## What trips him up (when he starts late, what he skips, what overruns — from the block-by-block record), ## People and projects, ## Things to follow up on (with dates).
Under 450 words. Return ONLY the markdown.`;
