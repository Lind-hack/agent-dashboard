// Client-safe: who speaks with which voice. Every agent has its own voice so you can tell them apart
// with the phone in your pocket; the Core (the OS's own voice assistant) has the warmest one.
//   kokoro  — Kokoro-82M on the VPS (free, unlimited, always there)
//   orpheus — Groq's Orpheus (free tier, more expressive; used first when the account has it)

import type { TaskAgent } from "./agents";

export type Speaker = TaskAgent | "core";
export type VoiceLang = "en" | "sq";
export const SPEAKERS: Speaker[] = ["core", "claude", "codex", "codex-cloud", "opencode", "hermes"];

export const VOICES: Record<Speaker, { kokoro: string; orpheus: string; mood: string }> = {
  core: { kokoro: "af_heart", orpheus: "hannah", mood: "warmly" },
  claude: { kokoro: "af_bella", orpheus: "diana", mood: "thoughtfully" },
  codex: { kokoro: "am_fenrir", orpheus: "troy", mood: "confidently" },
  "codex-cloud": { kokoro: "am_michael", orpheus: "daniel", mood: "calmly" },
  opencode: { kokoro: "am_puck", orpheus: "austin", mood: "casually" },
  hermes: { kokoro: "bf_emma", orpheus: "autumn", mood: "crisply" },
};

export const isSpeaker = (s: unknown): s is Speaker => typeof s === "string" && (SPEAKERS as string[]).includes(s);

// Whisper and the Core both report a language; keep only the two the voice stack can speak.
export function voiceLang(value: unknown): VoiceLang | undefined {
  if (typeof value !== "string") return;
  const v = value.trim().toLowerCase();
  if (v === "sq" || v.startsWith("sq-") || v.startsWith("sq_") || v === "albanian" || v === "sqi" || v === "alb") return "sq";
  if (v === "en" || v.startsWith("en-") || v.startsWith("en_") || v === "english") return "en";
}

// A cheap check for text that came from the Core (or a typed message) without a language tag.
// Albanian's ë/ç are the strong signal; the words catch short replies that happen to have neither.
const ALBANIAN = /[ëËçÇ]|\b(faleminderit|përshëndetje|mirëdita|mirëmëngjes|natën|nuk|është|sot|nesër|mund|një|për|dhe|por|shumë|mirë)\b/i;
export const looksAlbanian = (text: string) => ALBANIAN.test(text);

// What gets read aloud from an agent's markdown: the prose, not the code. Code blocks become "(code)",
// links keep their label, list markers and emphasis go. Capped so a long report doesn't talk for minutes.
export function speakable(md: string, max = 700): string {
  let t = md
    .replace(/```[\s\S]*?```/g, " (code) ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "a link")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/[*_~>|]/g, "")
    .replace(/\s*\n+\s*/g, ". ")
    .replace(/\.\s*\./g, ".")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (t.length > max) {
    const cut = t.slice(0, max);
    const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
    t = `${end > max * 0.4 ? cut.slice(0, end + 1) : cut} The rest is on screen.`;
  }
  return t;
}

// Sentences of at most ~180 characters (Orpheus takes 200 per request; short pieces also start
// playing sooner). Long sentences split at commas, then at spaces.
// The first piece is kept short (~70) so the voice starts sooner while the rest renders.
export function sentences(text: string, max = 180, first = 70): string[] {
  const out: string[] = [];
  for (const raw of text.match(/[^.!?…]+[.!?…]+["')\]]*|[^.!?…]+$/g) ?? []) {
    let s = raw.trim();
    for (let cap = out.length ? max : first; s.length > cap; cap = max) {
      const cut = s.slice(0, cap);
      const at = Math.max(cut.lastIndexOf(", "), cut.lastIndexOf("; "), cut.lastIndexOf(" — "));
      const i = at > cap * 0.4 ? at + 1 : cut.lastIndexOf(" ") > 0 ? cut.lastIndexOf(" ") : cap;
      out.push(s.slice(0, i).trim());
      s = s.slice(i).trim();
    }
    if (s) out.push(s);
  }
  return out;
}
