import fs from "node:fs";
import path from "node:path";
import { keptStreak, mirror, mirrorText, patterns, staleGoals } from "./accountability";
import { addDays } from "./calendar";
import { goalProgress } from "./coach";
import { DATA_DIR } from "./config";
import { groqJSON } from "./groq";
import { readProfile } from "./buddy";
import { readReckoning, VERDICT_WORDS, type Reckoning } from "./reckoning";
import { recallMemory, recallText } from "./memory";
import { nemotron, nvidiaReady } from "./nvidia";
import { activeBlocks, readPlan } from "./plan-store";

// The morning push (v5.2, Lind's pick): a long, hard-edged message in the spirit of David Goggins,
// written fresh each morning from Lind's own record — yesterday's mirror, the streak, his patterns, the
// plan in front of him, the goals he's neglecting, what his memory says he wants. It is NOT a quote and
// never claims to be one: Goggins' own words are his (and copyrighted); this is written for Lind, in
// that voice. data/coach/goggins-<day>.json, shown on Today and pushed once.

export type Push = { day: string; title: string; text: string; model: string; createdAt: string };

const file = (day: string) => path.join(DATA_DIR, "coach", `goggins-${day}.json`);

export function readPush(day: string): Push | null {
  try {
    const p = JSON.parse(fs.readFileSync(file(day), "utf8")) as Push;
    return p?.text ? p : null;
  } catch {
    return null;
  }
}

const SYSTEM = `You are the voice Lind wakes up to, in the spirit of David Goggins: a reality check, not a pep talk. Raw, cold, direct, relentless. You don't care how he feels; you care what he DID. Every line is about Lind, built from the record given — never generic motivation, never "you've got this".
How it hits:
- Open with the verdict on yesterday in one blunt line, then the evidence: the blocks he said he'd do and didn't, the minutes he was late, the hours he planned vs the hours he actually worked, the streak he kept or killed. If he answered last night's reckoning, throw his own excuse back at him and take it apart.
- Name the pattern that keeps beating him and the goal he keeps running from, with how long he's been running.
- Call out the softness: comfort, scrolling, waiting to feel ready, feeling sorry for himself. Make him feel the gap between who he says he is (his goals) and what the record shows. Hard on the behaviour, never contempt for him as a person.
- Then today: the first block and its time, the hardest thing on the plan, and the exact moment he'll want to quit — and what he does in that moment instead.
- End with one order for the next 10 minutes. No sign-off.
Rules: never quote David Goggins or present any sentence as his words; no catchphrases of his; original lines in that energy. Every number, time and block name exactly as given — never compute or invent one. Don't recite who he is. 200-300 words, short paragraphs, second person. Hard language is allowed sparingly; no slurs, no emojis, no hashtags.
Return JSON {"title": string (≤8 words, the push notification title), "text": string}.`;

export async function writePush(day: string): Promise<Push> {
  const y = addDays(day, -1);
  const s = keptStreak(day);
  const last = readReckoning(y);
  const plan = activeBlocks(readPlan(day)).filter((b) => b.kind !== "break");
  const idle = staleGoals(day);
  const goals = goalProgress().slice(0, 4);
  const why = await recallMemory(goals.map((g) => g.goal.title).join(" "), 3).catch(() => []);
  const input = [
    `Yesterday (${y}), said vs did:\n${mirrorText(mirror(y, Number.MAX_SAFE_INTEGER))}`,
    `Kept-days streak: ${s.days} (a kept day = every block done, nothing missed, 80%+ started on time).`,
    ...(last?.answer ? [`Last night's reckoning (${last.day}): verdict ${last.verdict}, he did ${last.didMin} of ${last.saidMin} planned minutes. His answer: "${last.answer.slice(0, 600)}"`] : []),
    `His patterns, last two weeks:\n${patterns(day).lines.join("\n") || "(not enough blocks yet)"}`,
    `Today's plan:\n${plan.map((b) => `- ${b.start}–${b.end} ${b.title}`).join("\n") || "NO PLAN YET — he hasn't planned the day."}`,
    `Goals this week:\n${goals.map((g) => `- ${g.goal.title}: ${g.weekMin} of ${g.targetMin} min${g.goal.why ? ` — why: ${g.goal.why}` : ""}`).join("\n") || "none set"}`,
    ...(idle.length ? [`Goals he's avoiding: ${idle.map((g) => `${g.title} (${g.idleDays === null ? "never touched" : `${g.idleDays} days`})`).join("; ")}`] : []),
    `What the Buddy knows about him:\n${readProfile().text.slice(0, 1500) || "(nothing yet)"}`,
    ...(why.length ? [`From his own notes about these goals:\n${recallText(why)}`] : []),
  ].join("\n\n");
  let out = await groqJSON<{ title: string; text: string }>(SYSTEM, input, 0.7, { maxTokens: 1000, timeoutMs: 45_000 }).catch(() => null);
  let model = "groq";
  if (!out?.text && nvidiaReady()) {
    const raw = await nemotron(`${SYSTEM}\nReturn ONLY the JSON object.`, input, { maxTokens: 1200, temperature: 0.6 }).catch(() => "");
    try {
      out = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
      model = "nemotron";
    } catch {
      out = null;
    }
  }
  if (!out?.text?.trim()) throw new Error("no model answered");
  const push: Push = { day, title: (out.title || "No excuses today").trim().slice(0, 80), text: out.text.trim().slice(0, 3000), model, createdAt: new Date().toISOString() };
  fs.mkdirSync(path.dirname(file(day)), { recursive: true });
  fs.writeFileSync(`${file(day)}.tmp`, JSON.stringify(push, null, 2));
  fs.renameSync(`${file(day)}.tmp`, file(day));
  return push;
}

// The coach's answer to Lind's reckoning: his excuse, against the numbers. 2-4 sentences.
export async function reckonReply(r: Reckoning, said: string, record: string): Promise<string> {
  const system = `Lind just answered for his day in front of the accountability mirror. You answer him in the spirit of David Goggins: a reality check. If the day was ENOUGH, acknowledge it in one hard line and raise the bar for tomorrow. If not, take his answer apart against the numbers — separate the reason from the excuse, call out softness or self-pity if it's there — then give the one thing he does differently tomorrow, with a time. 2-4 sentences, second person, no quotes of anyone, no emojis. Return JSON {"reply": string}.`;
  const user = `Verdict: ${VERDICT_WORDS[r.verdict]} He planned ${r.saidMin} minutes and did ${r.didMin}; ${r.missed} blocks missed, ${r.onTimeRate}% started on time, streak ${r.streak}.\nThe record:\n${record}\n\nHis answer: "${said}"`;
  const out = await groqJSON<{ reply: string }>(system, user, 0.6, { maxTokens: 500, timeoutMs: 30_000 }).catch(() => null);
  if (out?.reply) return out.reply.trim();
  if (!nvidiaReady()) return "";
  const raw = await nemotron(`${system}\nReturn ONLY the JSON object.`, user, { maxTokens: 600, temperature: 0.6 }).catch(() => "");
  try {
    return String(JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)).reply ?? "").trim();
  } catch {
    return "";
  }
}
