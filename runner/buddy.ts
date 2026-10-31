import { PROFILE_SYSTEM, profileInput, readProfile, saveProfile } from "../lib/buddy";
import { addDays } from "../lib/calendar";
import { coachNow } from "../lib/coach";
import { readJournal } from "../lib/journal";
import { sol } from "../lib/sol";
import { notify } from "./notify";

// The Buddy, runner side (v5.1):
// - 21:00 every day: "How was your day?" — a push that opens the journal (text or voice). If nothing
//   is written by 22:30, one gentler nudge.
// - 03:30: Sol rewrites the Buddy's profile of Lind from the last day's journal, chats and scores.

const log = (...a: unknown[]) => console.log(new Date().toISOString(), "buddy:", ...a);
const JOURNAL_AT = () => process.env.JOURNAL_AT ?? "21:00";
const JOURNAL_NUDGE_AT = () => process.env.JOURNAL_NUDGE_AT ?? "22:30";
const PROFILE_AT = () => process.env.BUDDY_PROFILE_AT ?? "03:30";
let profiling = false;

export async function buddyTick(minute: string) {
  const day = coachNow().day;
  const wrote = readJournal(day).entries.length > 0;

  if (minute === JOURNAL_AT() && !wrote)
    await notify({
      key: `coach:journal:${day}`,
      kind: "coach",
      title: "How was your day?",
      body: "Tell your Buddy in a minute — type it or just talk. It's how tomorrow gets better.",
      push: { title: "How was your day?", body: "Tap and tell me — 30 seconds of voice is enough." },
      href: "/buddy?journal=1",
      priority: 3,
      expiresAt: new Date(Date.now() + 5 * 3600_000).toISOString(),
    });

  if (minute === JOURNAL_NUDGE_AT() && !wrote)
    await notify({
      key: `coach:journal-nudge:${day}`,
      kind: "coach",
      title: "Two lines before bed?",
      body: "What went well, what didn't. That's it.",
      push: { title: "Two lines before bed?", body: "What went well, what didn't. Tap to say it." },
      href: "/buddy?journal=1",
      priority: 2,
      expiresAt: new Date(Date.now() + 3 * 3600_000).toISOString(),
    });

  // Nightly profile — once, and only when something new happened since the last one.
  if (minute === PROFILE_AT() && !profiling) {
    const yesterday = addDays(day, -1);
    const last = readProfile().at ?? "";
    if (last.slice(0, 10) >= day) return;
    if (!readJournal(yesterday).entries.length && last) {
      // Nothing written yesterday: the profile still gets the chats and scores, but at most every 3 days.
      if (Date.now() - Date.parse(last) < 3 * 86_400_000) return;
    }
    profiling = true;
    void sol(PROFILE_SYSTEM, profileInput(day), 8 * 60_000)
      .then((md) => {
        const clean = md.replace(/^```(?:markdown)?\s*|\s*```$/g, "").trim();
        if (clean.length > 80) {
          saveProfile(clean);
          log("profile updated", clean.length);
        }
      })
      .catch((e) => log("profile", e instanceof Error ? e.message : e))
      .finally(() => (profiling = false));
  }
}
