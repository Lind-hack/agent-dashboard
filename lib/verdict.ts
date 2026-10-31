// The day's verdict words (v5.2) — no server imports, so the reckoning screen can use them too.
export type DayVerdict = "enough" | "not-enough" | "soft" | "no-plan" | "pending";
export const VERDICT_WORDS: Record<DayVerdict, string> = { enough: "ENOUGH.", "not-enough": "NOT ENOUGH.", soft: "YOU SOFTENED.", "no-plan": "NO PLAN. NO DAY.", pending: "NOTHING DUE YET." };
export const VERDICT_TONE: Record<DayVerdict, string> = { enough: "text-ok", "not-enough": "text-warn", soft: "text-bad", "no-plan": "text-bad", pending: "text-muted" };
export const fmtMin = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${String(m % 60).padStart(2, "0")}m` : ""}` : `${m}m`);
