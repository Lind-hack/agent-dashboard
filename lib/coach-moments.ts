// When the Coach speaks up during a block (pure, so it's tested in deploy/coach.test.ts):
//   start   — the first 3 minutes of a planned block: "time for X"
//   nudge   — 10+ minutes in and not started (until 10 minutes before its end): start, shrink or move?
//   checkin — halfway through a running block of 40+ minutes: how's it going?
//   end     — the first 15 minutes after a running block's end: done?
// Keys are stable per block and moment, so notify()'s dedupe sends each one once.

export type MomentBlock = { id: string; title: string; kind: string; status: string; startMs: number; endMs: number };
export type Moment = { key: string; kind: "start" | "nudge" | "checkin" | "end"; block: MomentBlock };

const MIN = 60_000;

export function coachMoments(blocks: MomentBlock[], now: number): Moment[] {
  const out: Moment[] = [];
  for (const b of blocks) {
    if (b.kind === "break" || b.status === "done" || b.status === "dropped" || b.status === "moved") continue;
    const len = b.endMs - b.startMs;
    const add = (kind: Moment["kind"]) => out.push({ key: `coach:${kind}:${b.id}`, kind, block: b });
    if (b.status === "planned" || b.status === "blocked") {
      if (now >= b.startMs && now < b.startMs + 3 * MIN) add("start");
      else if (now >= b.startMs + 10 * MIN && now < b.endMs - 10 * MIN) add("nudge");
    } else if (b.status === "running") {
      if (now >= b.endMs && now < b.endMs + 15 * MIN) add("end");
      else if (len >= 40 * MIN && now >= b.startMs + len / 2 && now < b.startMs + len / 2 + 5 * MIN) add("checkin");
    }
  }
  return out;
}
