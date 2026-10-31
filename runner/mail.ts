import { coachNow } from "../lib/coach";
import { mailConnected, refreshMail, sortMail } from "../lib/gmail";
import { extractMailActions } from "../lib/mail-actions";

// Every 10 minutes: fetch the inbox and sort anything new into piles, so the Inbox is ready before
// Lind opens it.
const EVERY = 10 * 60_000;
let last = 0;
let busy = false;
const log = (...a: unknown[]) => console.log(new Date().toISOString(), "mail:", ...a);

export function mailTick() {
  if (busy || Date.now() - last < EVERY || !mailConnected()) return;
  last = Date.now();
  busy = true;
  void (async () => {
    const { messages, error } = await refreshMail();
    if (error) return log("refresh", error);
    const { sorted, left } = await sortMail();
    if (sorted || left) log(`sorted ${sorted} of ${messages.length}${left ? `, ${left} still unsorted` : ""}`);
    // What the sorted mail asks Lind to do (the web app turns these into tasks).
    if (!left) {
      const read = await extractMailActions(coachNow().day).catch(() => 0);
      if (read) log(`read ${read} for tasks`);
    }
    // Rate-limited with some left: come back in 2 minutes instead of 10.
    if (left) last = Date.now() - EVERY + 2 * 60_000;
  })()
    .catch((e) => log(e instanceof Error ? e.message : e))
    .finally(() => (busy = false));
}
