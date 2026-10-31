import fs from "node:fs";
import path from "node:path";
import { keptStreak, mirror, mirrorText, patterns, staleGoals } from "./accountability";
import { addDays } from "./calendar";
import { goalProgress } from "./coach";
import { DATA_DIR } from "./config";
import { groqJSON } from "./groq";
import { readProfile } from "./buddy";
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

const SYSTEM = `You write Lind's morning push, in the spirit of David Goggins: raw, direct, demanding, zero excuses, built on accountability and callusing the mind — but every line about LIND, from the facts given, never generic.
Lind is a first-year CS student in Pristina, Kosovo, building AI products, a 200k-follower TikTok (@building.ai) and the 383 news site.
Rules:
- Never quote David Goggins or present any sentence as his words. Don't use his signature catchphrases. Write original lines in that energy.
- Use the record: name yesterday's misses and late starts by block and minute, the streak (kept or broken), the pattern that keeps beating him, and the goal he's been avoiding. Then today: the first block and its time, the hardest thing on the plan, and the exact moment he'll be tempted to quit.
- Call out the excuse before he makes it. End with one concrete order for the next 10 minutes.
- Every number, time and block name exactly as given — never compute or invent one. Don't recite who he is; he knows.
- 180-260 words, short paragraphs, second person ("you"). No hashtags, no emojis, no profanity.
Return JSON {"title": string (≤8 words, the push notification title), "text": string}.`;

export async function writePush(day: string): Promise<Push> {
  const y = addDays(day, -1);
  const s = keptStreak(day);
  const plan = activeBlocks(readPlan(day)).filter((b) => b.kind !== "break");
  const idle = staleGoals(day);
  const goals = goalProgress().slice(0, 4);
  const why = await recallMemory(goals.map((g) => g.goal.title).join(" "), 3).catch(() => []);
  const input = [
    `Yesterday (${y}), said vs did:\n${mirrorText(mirror(y, Number.MAX_SAFE_INTEGER))}`,
    `Kept-days streak: ${s.days} (a kept day = every block done, nothing missed, 80%+ started on time).`,
    `His patterns, last two weeks:\n${patterns(day).lines.join("\n") || "(not enough blocks yet)"}`,
    `Today's plan:\n${plan.map((b) => `- ${b.start}–${b.end} ${b.title}`).join("\n") || "NO PLAN YET — he hasn't planned the day."}`,
    `Goals this week:\n${goals.map((g) => `- ${g.goal.title}: ${g.weekMin} of ${g.targetMin} min${g.goal.why ? ` — why: ${g.goal.why}` : ""}`).join("\n") || "none set"}`,
    ...(idle.length ? [`Goals he's avoiding: ${idle.map((g) => `${g.title} (${g.idleDays === null ? "never touched" : `${g.idleDays} days`})`).join("; ")}`] : []),
    `What the Buddy knows about him:\n${readProfile().text.slice(0, 1500) || "(nothing yet)"}`,
    ...(why.length ? [`From his own notes about these goals:\n${recallText(why)}`] : []),
  ].join("\n\n");
  let out = await groqJSON<{ title: string; text: string }>(SYSTEM, input, 0.6, { maxTokens: 900, timeoutMs: 45_000 }).catch(() => null);
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
