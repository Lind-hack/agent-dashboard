import fs from "node:fs";
import path from "node:path";

// The council (from the roast-room skill on Lind's PC, copied into council/): 12 seats, each a persona
// grounded in a brain compiled from that expert's public work. In the Roast room a seat debates like an
// agent, but through a long-context model with its persona + brain excerpt, no tools.

export type Seat = { key: string; name: string; short: string; initials: string; slug: string; pillar: string; question: string; dimension: string; color: string };

const dir = () => path.join(process.cwd(), "council");
let cache: Seat[] | null = null;

export function seats(): Seat[] {
  if (cache) return cache;
  try {
    const r = JSON.parse(fs.readFileSync(path.join(dir(), "roster.json"), "utf8"));
    cache = (Array.isArray(r?.seats) ? r.seats : []).filter((s: Seat) => s?.key && s?.slug && s?.name);
  } catch {
    cache = [];
  }
  return cache!;
}

export const seatByKey = (key: string) => seats().find((s) => s.key === key);
export const SEAT_PREFIX = "seat:";
export const isSeat = (debater: string) => debater.startsWith(SEAT_PREFIX);
export const seatKey = (debater: string) => debater.slice(SEAT_PREFIX.length);

const BRAIN_CAP = 28_000;
const read = (p: string) => {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return "";
  }
};

// Persona + brain excerpt: _hot.md first (the seat's own summary), then voice, frameworks, positions,
// principles — each cut so the whole stays under the cap.
export function seatSystem(key: string): string | null {
  const s = seatByKey(key);
  if (!s) return null;
  const persona = read(path.join(dir(), "seats", `${key}.md`));
  if (!persona) return null;
  const parts: string[] = [];
  let left = BRAIN_CAP;
  for (const f of ["_hot", "voice", "frameworks", "positions", "principles"]) {
    const text = read(path.join(dir(), "brains", s.slug, `${f}.md`)).trim();
    if (!text || left < 800) continue;
    const take = f === "_hot" ? Math.min(text.length, Math.floor(BRAIN_CAP * 0.4)) : Math.min(text.length, Math.floor(left / 2));
    parts.push(`### ${f}.md\n${text.slice(0, take)}${text.length > take ? "\n…" : ""}`);
    left -= take;
  }
  return `${persona.trim()}\n\n<brain seat="${s.name}">\n${parts.join("\n\n")}\n</brain>\n\nYou are debating in Lind's Roast room. Lind is a first-year CS student in Kosovo who runs @building.ai (200k followers, AI/tech), the 383 news site and an AI automation agency. Stay in your seat's voice and lens. No tools: reason from the task, the evidence and your brain only.`;
}
