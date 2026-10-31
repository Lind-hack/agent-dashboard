# Review Log: Agentic OS v4 (Coach, council Room, monitoring, chats, Orb everywhere)
Interview 2026-10-31 (Lind): Coach mode = "Coach" (block pushes + mid-block check-in + nudge + evening recap); monitoring = 383ks.com deep + GA4 + Supabase; Room verdict = decision memo; council seats as debaters. Built by Claude; cross-inspected by a fresh read-only Codex session on the VPS (gpt-6-luna; the PC Codex login rejects every model), diff given inline.

## Post-build inspection — round 1 (Codex)

1. **[P1] `deploy/db-stats.sh:48` — Root follows an agent-controlled temporary-file symlink.** The script gives `agent` ownership of `OUT_DIR`, then redirects root output into the predictable `db.json.tmp`. The agent can replace that path with a symlink and overwrite a root-owned file on the next timer run. **Fix:** Create the temporary file in a root-owned directory using `mktemp`, then atomically publish the completed snapshot.

2. **[P1] `lib/plan-store.ts:269` — Concurrent web and runner updates can lose plan changes.** `addBlock`, `shrinkBlock`, and `addCheckin` read and rewrite an entire plan while the runner can save a regenerated plan; whichever writes last can erase a newly added block, completion, or check-in. Atomic renaming alone does not prevent this. **Fix:** Serialize every plan read-modify-write operation with a shared cross-process lock or database transaction.

3. **[P2] `app/api/coach/route.ts:57` — “Focus now” can create multiple running blocks.** Adding a running block does not stop an existing one, and `coachNow()` selects the earliest running block. Starting another goal can therefore send the user into focus mode showing the previous goal while both receive coach notifications. **Fix:** Enforce one running block per day within the same transaction that starts or adds a block.

4. **[P2] `components/focus-view.tsx:36` — Block links can silently target a different block.** The requested ID is searched only in `current` and `next`; opening focus mode for any later block falls back to another block, whose Start, Done, Shrink, and Tomorrow buttons then operate on it. **Fix:** Resolve the requested ID against all of today’s blocks and explicitly handle missing IDs.

5. **[P2] `lib/coach.ts:28` — Time conversion is incorrect around DST transitions.** The offset is calculated at the UTC guess rather than the resolved instant. For example, `2026-03-29 01:30` in `Europe/Belgrade` resolves to `23:30Z` the previous day instead of `00:30Z`, shifting coach windows and notifications by an hour. **Fix:** Use timezone-aware wall-clock conversion with explicit handling of ambiguous and nonexistent times.

6. **[P2] `lib/coach.ts:130` — “Next free slot” ignores calendar appointments.** It checks only stored plan blocks, although the planner separately accounts for calendar events. Planning a goal or room action can therefore place work directly over a class or meeting. **Fix:** Include calendar busy intervals when finding and reserving a slot.

7. **[P2] `lib/plan-store.ts:317` — Very short completed blocks receive their full planned duration.** If start-to-done rounds to zero minutes, `blockMinutes()` falls back to scheduled length; starting and immediately finishing a 50-minute block credits 50 focused minutes and inflates goal progress and recap scores. **Fix:** Return zero for a valid zero-duration actual interval and use planned duration only when actual timestamps are unavailable.

8. **[P2] `runner/coach.ts:78` — The evening recap permanently freezes an unfinished day.** At 21:30, plans may still contain work through 23:00; later completions never update the saved recap because subsequent ticks require `!readRecap(day)`. Goals can consequently show a final score that counts completed evening work as skipped. **Fix:** Refresh the recap after subsequent plan changes or finalize it only after the day’s work ends.

9. **[P2] `runner/monitor.ts:26` — Restarting the runner can postpone scheduled monitoring by almost another full interval.** When a persisted PageSpeed or SEO result is still fresh, the code sets the in-memory timestamp to now. A PageSpeed result already almost six hours old then waits another six hours; SEO can similarly approach 48 hours between checks. **Fix:** Calculate due times from the persisted result timestamps on every tick.

10. **[P2] `lib/ga4.ts:63` — Sparse GA4 results are assigned to the wrong dates.** GA4 can omit dates without activity; using the last two returned rows as today and yesterday reports yesterday’s traffic as today’s when today has no users, and can mislabel still older days. **Fix:** Match rows to explicit dates in the property timezone and fill missing dates with zero.

11. **[P2] `lib/monitor.ts:67` — The seven-day reader omits part of its requested window.** Reading today and six preceding UTC files excludes the portion of the seventh preceding date still inside the rolling 168-hour window, making seven-day uptime depend on the current UTC hour. **Fix:** Read every date intersecting the requested interval, then filter by its exact timestamp cutoff.

12. **[P2] `components/room-view.tsx:307` — Failed scheduling is displayed as successful and cannot be retried.** The Today button marks an action as planned immediately after invoking the asynchronous request. A 409 for no available slot or a network failure leaves “On today” checked and disabled even though no block exists. **Fix:** Set `planned` only after the scheduling request succeeds.
### Claude's dispositions
1. Root follows agent-planted symlink in db-stats.sh — **fixed**: own root-owned folder /var/lib/agent-dashboard-db, mktemp + chmod 644 + mv; dashboard reads DB_STATS_FILE. Verified on the VPS.
2. Plan read-modify-write races — **rejected**: the runner never writes plan files (the coach only reads them); only two of Lind's own taps in the same instant could collide, and every write is an atomic rename.
3. Several running blocks — **fixed**: starting / adding / shrinking a block puts any other running block back to planned.
4. Focus links resolve only current/next — **fixed**: coachNow returns every open block; a stale link says so and shows what's on now.
5. DST offset — **fixed**: two-pass offset at the resolved instant; tests for summer, winter and both 2026 change days.
6. Next free slot ignores the calendar — **fixed**: today's timed Google events are passed as busy intervals (Goals "Plan", Room "Today").
7. Zero-length done block counted as planned length — **fixed** (+ test).
8. Recap frozen at 21:30 — **fixed**: refreshed quietly whenever the plan changes later that day (no second push).
9. Restart postpones PageSpeed/SEO — **fixed**: due time from the saved result; in-memory stamp only rate-limits retries (10 min).
10. GA4 sparse dates — **fixed**: explicit 7-day calendar in the dashboard's zone, gaps = 0.
11. 7-day probe window misses a day — **fixed**: reads every date the window touches.
12. Room "On today" shown before success — **fixed**: set only after the API answers OK.

Rounds used: 1 of 2 — accepted fixes verified by tests (coach 8/8, progress 5/5) and the VPS dry run.
