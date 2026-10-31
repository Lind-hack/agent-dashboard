import { gmailConnected, refreshMail, sortMail } from "../lib/gmail";

// Every 10 minutes: fetch the inbox and sort anything new into piles, so the Inbox is ready before
// Lind opens it.
const EVERY = 10 * 60_000;
let last = 0;
let busy = false;
const log = (...a: unknown[]) => console.log(new Date().toISOString(), "mail:", ...a);

export function mailTick() {
  if (busy || Date.now() - last < EVERY || !gmailConnected()) return;
  last = Date.now();
  busy = true;
  void (async () => {
    const { messages, error } = await refreshMail();
    if (error) return log("refresh", error);
    const { sorted } = await sortMail();
    if (sorted) log(`sorted ${sorted} of ${messages.length}`);
  })()
    .catch((e) => log(e instanceof Error ? e.message : e))
    .finally(() => (busy = false));
}
