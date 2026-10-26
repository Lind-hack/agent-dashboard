# Plan Review Log: Agentic OS v2
Phases 0-1 (recon + interrogation) complete — plan locked with Lind (Q1 staging, Q2 goals, Q2b activity monitor, Q3 roast room, Q4 memory sources, Q5 planner authority, Q6 agent tools). Research tier: web. MAX_ROUNDS=3.

## Round 1 — Codex (thread 01a17577-b2ec-7612-a542-80e8caa91db9)

The plan still has material security and reliability gaps. This review concerns the supplied plan and assumptions; existing repository safeguards have not been verified.

1. **[Critical] A Cloudflare tunnel does not define application authorization.** The plan leaves dashboard authentication, bearer-token scope, token rotation, and approval-route protection unspecified; a stolen monitor token could become dashboard control.
   **Fix:** Require authenticated dashboard sessions and separate revocable device tokens scoped to specific ingestion routes, with request limits and origin/CSRF protection where applicable.

2. **[Critical] “Unprivileged user `agent`” is insufficient isolation.** Agents sharing that account may access dashboard data, OAuth credentials, CLI sessions, and other agents’ files; a Git worktree provides no security boundary.
   **Fix:** Run agent jobs in restricted environments with explicit filesystem mounts, minimal environment variables, controlled network access, and no dashboard credentials.

3. **[Critical] The read-only debate guarantee is incomplete.** Disabling Edit/Write does not establish equivalent restrictions on shell commands, MCP calls, hooks, or subprocesses across four different harnesses.
   **Fix:** Enforce read-only filesystem and external-tool policies outside the models, and test attempted writes and network side effects for every pinned CLI version.

4. **[Critical] The proposed Claude approval override may remain denied.** Claude evaluates deny rules before allow rules; adding a temporary allow cannot override an applicable deny. [Claude permissions documentation](https://code.claude.com/docs/en/permissions)
   **Fix:** Implement a supported tool-call approval mechanism or a runner-owned capability broker instead of relying on conflicting settings.

5. **[Critical] “One tool allowed for one turn” authorizes too much.** A turn can contain multiple calls with different recipients, payloads, or targets; retries and resumed sessions can repeat an approved action.
   **Fix:** Bind each approval to one immutable tool name, argument hash, session, expiry, and single-use execution record, with replay-safe handling.

6. **[High] Read-only tools still enable disclosure.** A connector can fetch private material that subsequently enters Nemotron prompts, other debaters’ contexts, transcripts, or persistent memory.
   **Fix:** Define source-specific permissions for reading, provider disclosure, persistence, and downstream sharing rather than treating “read-only” as sufficient.

7. **[High] Imported content can become instructions.** Screenshots, window titles, vault files, Telegram logs, skills, and MCP responses can contain prompt injection that influences planning or “Run it.”
   **Fix:** Treat imported content as untrusted data and validate every consequential action through deterministic authorization and schema checks.

8. **[High] Skills synchronization is a deployment mechanism disguised as file copying.** Markdown can contain executable instructions and secrets; uploads can also exploit traversal, symlinks, oversized files, and collisions, while nightly replacement changes running agents’ behavior.
   **Fix:** Use a reviewed allowlist of skills, validated relative paths, secret scanning, immutable versions, and atomic activation outside active sessions.

9. **[High] The screenshot blocklist does not protect the captured image.** A blocked application can remain visible behind the foreground window or on another monitor, and focus can change between checking and capture.
   **Fix:** Capture only explicitly allowed windows, revalidate the target immediately before capture, and fail closed when lock state or capture scope is uncertain.

10. **[High] “Never written to disk” and “never saved” exceed the proposed controls.** Application buffers do not control swap, crash dumps, request tracing, provider retention, or secrets missed by a redactor; the accepted cloud-upload tradeoff does not establish those guarantees.
    **Fix:** Replace absolute promises with verified handling and retention policies covering the complete pipeline, including provider processing and diagnostics.

11. **[High] Remote pause has undefined failure behavior.** A disconnected PC may continue capturing after the dashboard says “paused,” and queued frames may upload after a pause.
    **Fix:** Use an expiring capture authorization lease, a visible local pause indicator, and immediate queue cancellation when capture authorization expires or is revoked.

12. **[High] “Forget this” will resurrect deleted memories.** Removing a generated vault entry and search record leaves source transcripts, summaries, cached answers, backups, and future reimports.
    **Fix:** Give records stable source identities and derivation links, propagate deletion through derived stores, and retain content-free tombstones that prevent reingestion.

13. **[High] Source toggles have no enforceable meaning.** It is unclear whether switching off a source stops collection, stops retrieval, deletes history, or prevents other sources from recapturing the same material.
    **Fix:** Specify separate collection, retrieval, retention, and deletion controls, and apply them consistently to every ingestion path.

14. **[Critical] Shared JSON writes can lose updates even with atomic rename.** Two web/runner processes can read the same revision, independently modify it, and replace each other’s changes.
    **Fix:** Make the runner the sole durable writer with serialized commands and revision checks, or use SQLite transactions.

15. **[High] JSON, NDJSON, vault mirrors, and indexes have no consistency contract.** A crash can leave truncated activity records, a saved goal without its mirror, or an index that disagrees with its source.
    **Fix:** Declare one canonical store, use stable event IDs and a durable operation journal, and make mirrors/indexes rebuildable with partial-record recovery.

16. **[High] The scheduler has no restart or duplicate-run semantics.** Deployment overlap can produce two planners, downtime can miss 07:00, and repeated wall-clock times can duplicate jobs.
    **Fix:** Persist timezone-aware job identities, execution leases, catch-up rules, and deduplication, with exactly one active scheduler owner.

17. **[High] Jobs lack a durable lifecycle.** CLI hangs, interactive prompts, expired logins, runner restarts, and cancellation can leave orphaned processes or rooms permanently marked “working.”
    **Fix:** Define persisted job states, deadlines, process-group termination, bounded retries, restart reconciliation, and terminal cleanup.

18. **[Critical] Calendar and TickTick updates cannot be one transaction.** Google may accept a write before the runner crashes, causing duplicate events on retry; TickTick may fail after the calendar has already changed.
    **Fix:** Persist intended operations before execution, use provider-supported idempotent identifiers, reconcile ambiguous results, and expose partial success.

19. **[High] Planner ownership contradicts its TickTick behavior.** The plan says it only owns tagged events/tasks, yet it changes times on existing user tasks; neither ownership nor “Clear” defines how those edits are restored.
    **Fix:** Track ownership per object and field, preserve previous values, and define bounded undo that cannot overwrite later user edits.

20. **[High] Tagged events can still overwrite human decisions.** Lind may manually move an OS-created block while replanning uses an older snapshot; recurring events, all-day events, cancellations, and multiple calendars also need explicit treatment.
    **Fix:** Persist event IDs and ownership metadata, pin manual edits, expand busy intervals correctly, and use conditional updates with ETags. [Google Calendar versioning](https://developers.google.com/workspace/calendar/api/guides/version-resources)

21. **[High] The planner lacks enough data to produce a feasible schedule.** Tasks have no defined duration, splitting rules, dependencies, working hours, buffers, or overload policy; missing input could be mistaken for free time.
    **Fix:** Add scheduling constraints and deterministic overlap validation, leaving excess work unscheduled and withholding auto-application when required inputs are stale.

22. **[High] TickTick write capability is assumed too late.** Existing read-only integration does not establish authorization or correct behavior for times, recurrence, all-day tasks, subtasks, and retries.
    **Fix:** Gate planner activation on live write/read-back tests with the actual account, scopes, and representative task types.

23. **[High] Goal progress mixes incompatible quantities.** Commits, completed blocks, and check-in answers measure activity, not necessarily the declared target; retries can double-count them.
    **Fix:** Define units, baselines, aggregation rules, stable project/task IDs, deduplicated evidence, and explicit distinction between outcome metrics and activity indicators.

24. **[High] Activity samples cannot justify precise behavioral claims.** Minute samples miss transitions, PC data misses offline work, and missing uploads do not mean inactivity; “2 h on trading-brain” may be false.
    **Fix:** Record sampling coverage and unknown periods, distinguish observations from inferred durations, and allow corrections without automatically increasing goal progress.

25. **[High] Push delivery cannot carry correctness.** Notifications can expire or arrive late, subscriptions can disappear, and the daily cap conflicts with block starts, check-ins, reviews, and approvals. [Apple push delivery documentation](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers)
    **Fix:** Keep a durable in-app inbox with priorities, deduplication, expiry, subscription cleanup, and generic lock-screen text; require authenticated approval after opening the app.

26. **[High] The usage guard is neither measurable nor protective as specified.** Historical weekly percentage does not establish the cost of another debate; the Claude opt-in condition above 70% is ambiguous, and judge/context/tool usage is omitted.
    **Fix:** Define explicit start rules plus enforced per-run call, output, time, concurrency, and daily limits, labeling unavailable quota estimates as unknown.

27. **[High] Agent brands do not guarantee model diversity.** OpenCode and Hermes may use the same underlying model or provider; “worktree per room” also leaves isolation between parallel participants undefined.
    **Fix:** Record actual provider/model identities and configuration, pin the base commit, and give parallel executions separate working state.

28. **[High] An agreement score is not a correctness test.** Debaters can converge on the same unsupported claim, and the judge has no specified way to distinguish verified evidence from fabricated command output.
    **Fix:** Require attributable evidence artifacts and explicit acceptance checks, and label the result as a recommendation requiring authorization before execution.

29. **[High] Debate failure and reasoning presentation are underspecified.** Timeouts, unavailable judges, malformed votes, and missing agents can masquerade as consensus; full internal reasoning is not uniformly available across providers.
    **Fix:** Define incomplete/no-verdict outcomes, validate structured responses, and display concise rationales, evidence, and dissent rather than promising internal reasoning.

30. **[High] “Free models” are an operational dependency without a tested contract.** The exact vision model, fallback, limits, retention, and account access remain unverified; NVIDIA describes its free APIs as development endpoints subject to throttling. [NVIDIA endpoint documentation](https://build.nvidia.com/nvidia/cosmos3-nano-reasoner)
    **Fix:** Gate each integration on authenticated capability tests and documented data handling, then enforce backoff, circuit breakers, and title-only/no-model degradation without paid fallback.

31. **[High] Shared VPS capacity has no admission control.** Parallel CLIs, builds, TTS, and existing pipelines can exhaust RAM, CPU, or disk; an isolated Kokoro benchmark does not measure performance under that load.
    **Fix:** Set resource and queue limits, reserve capacity for the runner, cap TTS input, and benchmark representative concurrent workloads.

32. **[High] Recovery and observability are missing from “production-grade.”** There is no stated backup/restore procedure, schema migration strategy, credential-refresh handling, scheduler heartbeat, queue-age alert, or disk-capacity policy.
    **Fix:** Add versioned schemas, encrypted tested backups, protected credential storage, retention limits, and redacted health/audit records with actionable failure alerts.

33. **[High] The shipping checks primarily validate appearance and compilation.** Builds, screenshots, and diff review will not expose duplicate external writes, approval replay, deletion resurrection, corrupt JSON, expired OAuth, or a runner crash.
    **Fix:** Add targeted acceptance tests for those failure modes and complete persistence/authentication safeguards before shipping Room or enabling automatic writes.

VERDICT: REVISE
### Claude's response
Accepted (fully or partly) 29 of 33, as rules R1–R26 in PLAN-v2.md: scoped monitor token + session auth (1); untrusted-content rule (7); connector writes cut from v2 instead of an approval override, because deny beats allow (4, 5); disposable per-debater worktrees with no creds/MCP (3, 27); structured debater/judge JSON + outcome states + recommendation labelling (28, 29); room limits and the real model shown (26, 27); foreground-window-only capture + re-check (9); capture lease (11); honest retention wording (10); activity coverage + effort != progress (23, 24); the runner as sole writer + schemaVersion + rebuildable mirrors (14, 15); scheduler keys + catch-up (16); idempotent calendar ids, op journal, pinned manual edits, freebusy (18, 20); TickTick per-task ownership + restore + live write gate (19, 22); planner feasibility (21); toggle semantics (13); tombstones (12); skill-sync validation (8, partly); notification center as source of truth (25); free-model capability gates + circuit breakers (30); VPS admission (31); health + backups (32, partly); failure-mode acceptance tests (33).
Rejected: per-job OS isolation (2) — single-user box, previously rejected, env already stripped; allowlist-only skills (8) — contradicts the Q6 decision; encrypted backups (32) — root-only single box; per-source disclosure policies (6) — dashboard chats feeding the brain was accepted.

## Round 2 — Codex

Rev 1 resolves several earlier findings at the plan level: connector approval scope is removed by R3; R5–R8 define structured debate outcomes and recovery; R11–R13 correct privacy wording and progress accounting; R18 adds scheduling constraints; R22 makes push supplementary; and R26 adds meaningful failure tests. The remaining problems are concentrated in isolation, persistence, external-write races, and deletion semantics.

The rejections are acceptable only in these respects:

- **Separate users/sandboxes: contest the justification.** A single-user machine still contains production data and credentials; stripping environment variables does not restrict file access or localhost access. Separate users are optional, but disposable worktrees cannot substitute for containment.
- **Skill allowlist: accept the product choice.** Syncing almost all trusted personal skills is reasonable, provided the plan acknowledges that a denylist and redactor do not establish safety.
- **Encrypted backups: accept for a deliberately local, root-protected backup.** Encryption is not essential to approve this personal deployment; backup execution, recoverability, and disk-loss coverage remain separate problems.
- **Downstream disclosure policies: accept the stated consent.** There is no need to demand granular provider controls after Lind accepts that disclosure, but source-off and forget controls must still work on derived content.

Material findings remain:

1. **[Critical — R4] The fallback explicitly abandons read-only enforcement.** Without a working sandbox, a shell command can modify DATA_DIR, the main checkout, CLI configuration, or other files owned by `agent`; deleting its worktree does not undo those effects.
   **Fix:** Fail closed when confinement is unavailable, or run that participant through a tool-free model request with runner-supplied evidence.

2. **[High — R2/R3] Schema validation does not establish authorization.** A perfectly valid planner result could name an unrelated calendar, change arbitrary task IDs, or include attendees; read-only connector restrictions also need to reject newly discovered write tools by default.
   **Fix:** Enforce explicit object, field, destination, and operation allowlists independently of model output, with unknown connector tools denied.

3. **[High — R1] Cookie authentication leaves browser-request attacks unspecified.** Cross-site requests can potentially trigger authenticated mutations, and a stolen monitor token can submit unlimited images or poison the activity record.
   **Fix:** Require CSRF/origin protection for cookie mutations and enforce exact monitor methods/routes, token revocation, body-size limits, and request/provider quotas.

4. **[High — R9] A foreground window’s screen rectangle can contain somebody else’s pixels.** Cropping the desktop to that rectangle can capture overlapping windows or notifications; checking the foreground handle afterward does not detect that exposure.
   **Fix:** Use a window-specific capture mechanism with tested occlusion behavior, dropping frames when it cannot isolate the intended window.

5. **[High — R10] Remote pause is delayed, not immediate.** A previously issued five-minute lease remains valid after the dashboard pauses collection, and a frame already in flight may still reach the provider.
   **Fix:** Display pause as pending until acknowledged, reject incoming frames while paused before provider dispatch, and document the bounded capture delay.

6. **[High — R14/R15] “Sole writer” and “one runner” are assertions without enforcement.** Async handlers can still interleave read-modify-write operations, deployments can overlap runners, and schema versions do not prevent truncated JSON or incompatible rollback.
   **Fix:** Add an exclusive runner lock, serialized durable mutations, atomic JSON replacement, acknowledged command IDs, and explicit migration/rollback rules.

7. **[High — R16] Manual-edit detection still has a race.** Lind can edit an event after the runner checks `updated` but before its update or deletion; the runner then overwrites the edit it promised to preserve.
   **Fix:** Use ETag-based `If-Match` for modifications and deletions, treating a conflict as a pin rather than retrying over it. [Google Calendar conditional modifications](https://developers.google.com/workspace/calendar/api/guides/version-resources)

8. **[High — R16, new] Freebusy will include the planner’s own movable blocks.** Treating those as fixed busy time makes replanning block itself; subtracting their intervals from aggregated busy ranges could accidentally erase an overlapping real appointment.
   **Fix:** Reconstruct busy intervals from events with ownership metadata, or put OS blocks on a dedicated calendar and separately include pinned/current OS blocks.

9. **[High — R16, new] The stated OAuth scope does not establish Freebusy access.** `calendar.events` is not among the documented Freebusy scopes, and successful HTTP responses can contain per-calendar errors that must not be interpreted as availability.
   **Fix:** Verify the actual token has a supported Freebusy scope and withhold application if any required calendar reports an embedded error. [Freebusy API authorization and response](https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query)

10. **[High — R16/R17] Retry and undo semantics remain incomplete.** Calendar journaling does not cover TickTick task creation; a lost creation response can produce duplicates, while successful calendar writes followed by failed TickTick writes leave a partially applied plan.
    **Fix:** Journal both providers’ operations, define stable block/task identities and ambiguous-result reconciliation, and expose partial application with safe retry/undo.

11. **[High — R17] TickTick’s “wasn’t edited since” check may itself race.** A read-back test proves basic API functionality, not that concurrent manual edits can be protected during restore; repeated replans can also overwrite the original restoration baseline.
    **Fix:** Preserve the original baseline across replans and require conditional-write support for safe restore, otherwise make restoration an explicit reviewed action.

12. **[High — R19/R20] Source controls still miss derived memories.** A disabled source can remain searchable through a combined summary, and forgetting one transcript entry leaves summaries, check-ins, cached answers, and other copies that already incorporate it.
    **Fix:** Track source ancestry and stable record IDs through derived records, invalidate affected derivatives on exclusion/deletion, and reapply tombstones after backup restoration.

13. **[High — R20, new] Deletion granularity is inconsistent with monthly pages.** Memories and check-ins share monthly files, but R20 says to delete the generated page; forgetting one item could delete unrelated entries or depend on fragile text matching.
    **Fix:** Store canonical memories as individually identified records and regenerate monthly vault pages after deleting only the selected record.

14. **[High — R7/R24] Resource controls do not bound actual consumption.** A pre-start RAM check races with other starts, “one turn per agent” does not define a global room limit, and a ten-minute turn can still generate unbounded tool output or expensive context.
    **Fix:** Add global concurrency admission, per-turn context/output/tool-call limits, daily usage ceilings, runtime resource monitoring, and bounded log retention.

15. **[High — R25, new] The backup cannot be written by the stated process.** An unprivileged runner cannot write into a genuinely root-only backup directory without a separately provisioned mechanism; a backup on the same disk also cannot recover disk loss.
    **Fix:** Have Lind provision a narrow root-owned backup job, verify restoration including tombstones and versions, and explicitly accept local-only recovery or add an independent copy.

16. **[High — build order/R26] Several safeguards arrive after the feature that needs them.** Stage 3 already captures activity and creates memories, while source controls and forget semantics are assigned to Stage 4; cross-cutting persistence and isolation rules have no explicit shipping gate.
    **Fix:** Make authorization, durable storage, confinement, retention/deletion, and their failure tests prerequisites for the first stage that uses them.

VERDICT: REVISE
### Claude's response
Accepted all 16 as Rev 2 rules R27–R39: confinement gated on a write-attempt test, tool-free debaters with runner-gathered evidence otherwise (1); deterministic output allowlists, no attendees, unknown connector tools denied (2); origin checks + monitor token limits (3); PrintWindow per-window capture (4); server-side pause rejection + an acknowledged pause state (5); runner pid lock + serialized mutation queue + migration backups (6); a dedicated OS calendar with If-Match/ETag and 412 → pin (7, 8); events.list instead of freebusy, plus the calendar.app.created scope (needs one Google re-auth) (9); two-provider journal with stable ids + partial apply (10); a TickTick baseline kept for the day + reviewed restore (11); per-record memories with ancestry, Forget removes derived brain lines, weekly-synthesis trace accepted until the next rewrite (12, 13); global room admission + output caps + log retention (14); an agent-owned backup dir, local-only recovery accepted (15); safety prerequisites moved into stages 1–3 (16).
Isolation: kept as accepted residual risk, now stated explicitly with mitigations (tool-free debaters unless proven, root-only secrets). The other three rejections were accepted by Codex.

## Round 3 — Codex

Most round-2 findings are addressed at plan level: confinement now fails closed, calendar ownership and conditional writes are defined, TickTick restore is reviewed, capture/pause semantics are clearer, and backup execution and stage ordering are workable. I accept the explicitly documented isolation, local-backup, and weekly-synthesis residual risks.

Five material gaps remain:

1. **R28 still confuses tool names with read-only behavior.** A tool named `query` can execute mutations; `get` or `fetch` can have side effects. A new tool matching those patterns could become automatically authorized.
   **Fix:** Allow exact reviewed server/tool identities with constrained arguments and read-scoped credentials; deny newly discovered tools regardless of their names.

2. **R35 serializes writes but does not make them crash-safe.** A crash during JSON replacement can corrupt canonical records; deleting a memory before persisting its tombstone can allow resurrection. Journals must also become durable before external writes occur.
   **Fix:** Require atomic JSON replacement, durable journal-before-action ordering, and recoverable multi-file operations, including tombstone-before-delete.

3. **R36 does not fully implement source-off for derived records.** Filtering by a record’s `source_kind` misses a brain summary whose ancestry includes a disabled source. The accepted weekly rewrite delay concerns retained text, not continued retrieval after source-off.
   **Fix:** Apply source-off and tombstone checks transitively through ancestry at retrieval time, excluding affected derivatives until regenerated.

4. **R37 caps retained logs, not model consumption.** Truncating output after generation does not limit generated tokens, accumulated context, tool calls, or judge retries; five rooms can still exhaust subscription or free-provider capacity.
   **Fix:** Enforce generation/context limits and tool-call budgets before execution, with one shared per-room budget covering repairs and judges.

5. **R27’s evidence pack introduces a privacy path outside participant confinement.** A tracked symlink can point outside the worktree, and keyword-selected files can include credentials or private configuration; the 150 KB cap limits quantity, not disclosure.
   **Fix:** Build packs using fixed runner operations, reject symlinks and paths outside the checkout, exclude sensitive files, and redact content before provider submission.

VERDICT: REVISE
### Claude's response
Accepted all 5 as R40–R44 (exact tool identities, crash-safe write ordering, transitive source-off/tombstone filtering, budgets before execution, a safe evidence pack). MAX_ROUNDS=3 reached without a formal APPROVED. No open disagreement remains: every round-3 finding is folded in, and Codex accepted the documented residual risks (isolation, local backups, weekly-synthesis trace).

## Stage 1 — post-build inspection (fresh read-only Codex session)
Findings:
1. [P1] runner/index.ts — lock acquisition could admit two runners (a half-written lock read as stale; two stale recoveries both overwriting).
2. [P2] components/core.tsx — under reduced motion the canvas never redrew on energy/tint changes, so it could show a stale status.
3. [P2] app/page.tsx — "Tap the core to start one" pointed at a non-interactive canvas.
Dispositions: all accepted. Lock now published with link() (atomic, never half-written), stale locks moved aside with rename() and verified (put back if another runner won), and EPERM counts as alive (found while testing). Core redraws on status change when paused. Copy now points at Talk/Voice.
Verification: tsc clean; next build clean; lock tests in a throwaway DATA_DIR on the VPS: live holder → second runner exits; stale lock → taken over and released on exit; two concurrent starts → exactly one runs. Visual: desktop 1440 and phone 390 screenshots of Home + Agents, one fix round (directive clamp, dock backdrops, wrapping readout, denser core, inbox link). Rounds used: 1.
