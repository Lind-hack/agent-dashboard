# Plan Review Log: Phone-first continuity — two-way hand-off + Lind Brain
Phases 0-1 (recon + interrogation) complete — plan locked with Lind. MAX_ROUNDS=3.
Reviewer model: Codex CLI default (config `model = "gpt-6.1-sol"`) — codex-cli 0.146.0.

## Round 1 — Codex (gpt-6.1-sol, high; run on the VPS — the PC's Codex login refuses gpt-6.1-sol/gpt-6-luna; plan + code passed inline because bwrap read-only sandbox can't run on the VPS)

Material problems remain, especially around ownership, session portability, and recovery after partial failure.

1. **“Most recently written” does not identify the current session.** Two chats in the same repo, a background agent, or different worktrees can select the wrong conversation and code.
   **Fix:** Prefer an explicit session ID; otherwise require selection showing the transcript, repo root, worktree, and last messages.

2. **The hand-off is not a consistent checkpoint.** The invoking session can append transcript records and modify files while the script snapshots them; the hand-off tool’s own result may arrive after upload.
   **Fix:** Suspend the source session at a completed turn, then create one immutable checkpoint containing transcript and code hashes.

3. **Native resume portability is assumed rather than demonstrated.** The supplied code proves resume of existing VPS sessions, not that a copied Windows transcript is sufficient, discovers correctly, or preserves referenced artifacts and metadata.
   **Fix:** Make round-trip compatibility tests a prerequisite, covering both agents, compaction, tool calls, attachments, custom homes, and desktop-originated sessions.

4. **“VPS version ≥ PC version” is not a compatibility contract.** An unpinned upgrade in `update.sh` can change session lookup or serialization immediately before a return transfer.
   **Fix:** Pin tested CLI versions and retain compatibility fixtures and a rollback path.

5. **Deleting every other transcript with the same ID risks destroying valid history.** Repeated transfers also reuse `handoffs/<sessionId>/`, without a transfer generation or protection against stale uploads.
   **Fix:** Give every transfer an immutable generation ID, isolate imported session storage, and archive originals instead of deleting them.

6. **The temporary index recipe is incomplete.** An unseeded index loses tracking information for tracked-but-ignored files; an existing empty temporary file is not a valid Git index.
   **Fix:** Create a private temporary directory, seed its index with `git read-tree HEAD`, then add changes and clean up reliably.

7. **The snapshot does not capture all working state.** Dirty submodules, ignored files, staged-versus-working-tree differences, external directories, and runtime dependencies are not preserved; an unborn repository also breaks `-p HEAD`.
   **Fix:** Define the supported snapshot boundary, record exclusions, and explicitly handle or reject unsupported repository states.

8. **A hidden Git ref is not private storage.** `git add -A` can upload accidentally unignored credentials; later pushing `pc/...` can trigger repository workflows or deployments despite never touching `main`.
   **Fix:** Scan snapshot contents before upload and explicitly constrain workflows and credentials available to hand-off branches.

9. **The existing job path contradicts “waiting, no automatic turn.”** `createChat()` always queues a prompt and discards imported session metadata; `ensureWorktree()` has no `fromRef` support and constructs `origin/<branch>` references.
   **Fix:** Implement a dedicated import event carrying session ID, pinned snapshot SHA, context hash, ownership, and waiting state through the complete store/runner pipeline.

10. **The relocation preamble will not appear through the normal brief path.** Setting `job.sessionId` causes `runTurn()` to skip `brief()`, so imported sessions need a separate mechanism.
    **Fix:** Persist an initialization flag and explicitly prepend the relocation instructions to the first resumed phone turn.

11. **The phone will not show the full prior conversation.** Importing a native transcript does not populate dashboard `turns` or logs; the visible job begins with empty history.
    **Fix:** Add a paginated, safely rendered transcript-history view alongside subsequent dashboard turns.

12. **The ownership rule does not stop the PC from continuing.** The original CLI remains usable, so `owner: "vps"` is merely dashboard metadata.
    **Fix:** Require source-session shutdown and enforce ownership in supported local launch/resume commands, with explicit conflict handling for bypasses.

13. **Take-back explicitly permits downloading an active VPS session.** C.2 allows selecting “any VPS-owned” hand-off without first performing C.1; existing replies and `finally` can also requeue work during return.
    **Fix:** Route every return through the runner’s durable freeze transition and gate replies, scheduling, restart recovery, and export on ownership.

14. **Transcript replacement and code return are not one coherent operation.** The PC resumes in its unchanged checkout after receiving a transcript describing VPS code; fetching a branch does not install that code.
    **Fix:** Export a transcript-plus-commit manifest and require an explicit checkout/reconciliation step before declaring the session ready or closing the transfer.

15. **Take-back still has overwrite races.** The PC transcript can change between hashing and replacement; the plan does not require a frozen export, atomic installation, or a locally trusted destination.
    **Fix:** Lock the local session, resolve its destination from a local manifest, verify the complete export, and atomically install it with a durable backup.

16. **Context parity is both incomplete and globally mutable.** One hardcoded Claude memory directory misses other projects, while replacing shared rules and skills can change another job’s environment mid-run.
    **Fix:** Build an explicit context manifest per session and mount or install its versioned pack into an isolated job environment.

17. **Memory continuity only works outbound.** Take-back transfers transcript and code, but not memory or skill changes made on the VPS.
    **Fix:** Include changed memory and approved context artifacts in the return manifest with conflict-aware merging.

18. **“Agent-only” permissions provide no isolation from the agents.** All jobs run as `agent` with approval bypass; they can read other transcripts and modify the newly writable vault. Git authentication headers also appear in process arguments.
    **Fix:** Separate the credential-holding service from sandboxed job identities and expose only job-specific files and narrowly brokered Git operations.

19. **The new bearer endpoint is currently unauthorized.** `proxy.ts` matches `/api/handoff` exactly, so `/api/handoff/v2` and its chunk/status/download routes will reject the script’s token.
    **Fix:** Add an explicit authenticated endpoint set with a dedicated, scoped hand-off credential.

20. **Chunking specifies transport size, not a safe upload protocol.** There are no total/decompressed limits, chunk bounds, expiry, duplicate rules, atomic finalization, or stated defenses against path traversal and symlink writes.
    **Fix:** Validate server-issued upload IDs and metadata, enforce quotas, verify chunk and whole-file hashes, and publish only fully validated staged imports.

21. **The existing queue can lose an accepted hand-off.** `drainInbox()` deletes requests before processing, while `createChat()` failures are only logged; a crash can leave a returned URL with no job.
    **Fix:** Use durable claim/process/ack semantics and idempotency keys, acknowledging completion only after job persistence.

22. **Restart recovery can repeat actions, and cancellation does not guarantee quiescence.** Startup automatically retries interrupted turns, session IDs persist only after completion, and killing the CLI parent can leave tool descendants running; `runAgent()` also accepts a parsed success despite a later abnormal exit.
    **Fix:** Persist session IDs on initialization, mark interrupted turns for reconciliation, terminate process trees, and require clean completion before export.

23. **The Syncthing “create-only” guarantee contradicts the collector design.** Growing chats regenerate existing pages; human Obsidian edits and other maintainers remain additional writers.
    **Fix:** Use immutable, versioned collector outputs and explicitly assign ownership of canonical pages, with conflict detection for human edits.

24. **There are multiple VPS vault writers without coordination.** Nightly processing, weekly synthesis, and the unidentified existing maintainer can overlap after delays or retries; inbox moves do not make multi-file edits transactional.
    **Fix:** Locate every writer, serialize them with a shared lock, and journal applied inbox IDs so retries cannot duplicate partial updates.

25. **Syncthing does not deliver a batch atomically.** An inbox file can arrive before its referenced pages, and filename timestamps do not provide reliable deduplication or ordering.
    **Fix:** Publish content hashes in a batch manifest and process it only when all dependencies are present and verified.

26. **Collector progress is unsafe under rewrites and overlapping runs.** Line counts assume append-only files, while compaction, replacement during take-back, partial JSONL records, and concurrent scheduled runs can cause skips or duplicates; title-based filenames can collide or be invalid on Windows.
    **Fix:** Use a collector mutex, atomic checkpoints tied to file generations and record IDs, and stable session-ID-based filenames.

27. **“Every chat” is not delivered by the proposed discovery rules.** Desktop/custom-home/WSL storage coverage is unproven, and skipping single-message chats and sidechains deliberately omits potentially durable decisions.
    **Fix:** Inventory and test each actual session source, expose coverage gaps, and replace blanket skips with explicit retention rules.

28. **Redaction is an unproven security boundary and is missing from some sources.** Regexes miss private keys, cookies, arbitrary tokens, and multiline secrets; the VPS GitHub/Linear/dashboard paths do not explicitly pass through the same redaction gate.
    **Fix:** Apply a tested redaction-and-exclusion pipeline to every external-model input, using local processing for material that cannot be safely exported.

29. **External-service and cursor behavior is underspecified.** A PC model cache does not establish VPS model access; free-tier quotas are unverified; timestamp-only collection can miss pagination boundaries, late events, and commits outside the default branch.
    **Fix:** Probe exact runtime capabilities and implement bounded retries, pagination, overlapping scans, and stable-ID deduplication.

30. **The observability strip cannot establish completeness.** “Last run” and page counts can look healthy while individual sessions, repos, redactions, uploads, or synthesis steps repeatedly fail.
    **Fix:** Record per-source checkpoints, transfer generations, failure counts, retry state, coverage lag, and actionable stale-work alerts.

A simpler architecture worth evaluating is to keep authoritative sessions and worktrees on the VPS and access them from both PC and phone. Local-session imports can then remain an explicit compatibility feature with a summary fallback, rather than making bidirectional copying of native session stores the core reliability mechanism.

VERDICT: REVISE
### Claude's response (round 1)
Accepted and folded into PLAN.md rev 2: 1 (explicit session id + confirmed candidate), 2 (checkpoint semantics stated; divergence handled at take-back), 3+4 (gate 0 round-trip tests; pinned CLI versions), 5 (generations, archive never delete), 6 (read-tree-seeded private index), 7 (stated snapshot boundary; unborn/no-remote → conversation-only), 8 (secret scan of snapshot), 9+10 (dedicated import event, needsPreamble), 11 (paginated "Earlier on PC" history), 13+14+15 (freeze → export manifest; local destination record; atomic install; code switched only when safe), 16 (per-job pinned pack + --settings autoMemoryDirectory per chat project), 17 (memory diff returned), 19+20 (explicit endpoint set; upload ids, hashes, limits, staging, expiry), 21 (claim/ack inbox), 22 partly (session id persisted on init), 23 (writer-ownership table, generated banner), 24 (flock + staggered times; existing writers located), 25 (batch manifests with hashes, applied-ids journal), 26 (mutex, generation+uuid checkpoints, stable id filenames), 27 (source inventory; skip only trivial), 28 (shared tested redaction gate for all sources), 29 (Luna verified on VPS; pagination/overlap/dedupe), 30 (per-source status + Inbox alerts).
Partially/rejected: 12 — the PC CLI cannot be locked; we detect divergence by hash and back up instead of enforcing. 18 — per-job OS isolation rejected: single-user box, agents already run full-access by an earlier decision; risk recorded. 22 process-tree kill — existing behaviour, out of scope. "VPS-authoritative sessions" alternative rejected: Lind works natively in PC terminals/apps.

## Round 2 — Codex (same thread, gpt-6.1-sol high)

Revision 2 addresses much of round 1: version pinning, explicit imports, phone history, freeze-before-export, local destination records, and source coverage reporting. I’m treating the shared-user security boundary as an accepted risk. Material correctness gaps remain:

1. **The temporary-index commands still touch the real index if implemented literally.** `GIT_INDEX_FILE=<tmp>/index git read-tree HEAD` scopes the variable to that command; subsequent `git add -A` and `git write-tree` use the ordinary index.
   **Fix:** Pass the temporary index through the environment of every snapshot Git subprocess.

2. **The checkpoint can still be inconsistent.** Reading once while the originating agent runs can capture an incomplete JSONL record or unresolved tool invocation, while the code snapshot represents a different moment. Calling omitted trailing records “harmless” needs evidence.
   **Fix:** Checkpoint at a validated completed-record boundary with the source quiescent, and test the actual `/handoff` invocation sequence.

3. **The portability gate tests recall more than operational continuity.** “What were we doing?” does not prove that tools use the correct checkout, attachments remain accessible, memory writes work, or returned changes resume correctly. Pinning only the VPS also leaves future PC upgrades unchecked.
   **Fix:** Test actual file reads/writes and memory changes in both directions, and invalidate compatibility approval when either source or destination version changes.

4. **The return endpoint is missing from authentication routing.** A.5’s explicit bearer allowlist omits `/api/handoff/v2/return`, which C.1 requires.
   **Fix:** Include every required transfer endpoint in one shared, tested authorization definition.

5. **Archiving duplicate session IDs still breaks existing jobs.** Two generations of the same source session share one native session ID; importing the second can remove or replace the transcript the first job needs.
   **Fix:** Reject overlapping generations of a session or give each job an independently scoped native session store.

6. **A take-back lock file does not lock Claude or Codex.** The local CLI can append after the hash check or continue writing while its transcript is renamed and replaced; a backup does not make that operation safe.
   **Fix:** Require the destination session to be stopped before installation and recheck its transcript immediately before replacement.

7. **Take-back installs the transcript before establishing the matching code.** A failed fetch or checkout leaves the canonical conversation describing code that is not present.
   **Fix:** Stage all return artifacts, establish the verified code state, and only then activate the returned transcript and memory.

8. **Branch return is ambiguous and insufficiently pinned.** B.2 stores `pc/<slug>-<short>`, while C.3 adds another `pc/`; fetching a mutable branch also does not prove it matches the export’s commit SHA. `git switch` alone does not fast-forward an existing local branch.
   **Fix:** Store one canonical full ref, verify the fetched commit against the manifest, and explicitly handle local branch creation or advancement.

9. **“Exactly at the snapshot state” is not enough to guarantee checkout succeeds.** Snapshot files that were untracked on the PC become tracked on the returned branch and can obstruct switching; staging distinctions also remain unresolved.
   **Fix:** Define and test reconciliation for tracked, untracked, and staged files, with a fresh worktree as the safe fallback.

10. **Pinned context packs are also writable memory stores.** Pointing `autoMemoryDirectory` into the pack changes its supposedly hash-addressed contents and can mix memory changes between jobs sharing that pack. Weekly Codex execution also bypasses the runner’s per-agent context lock.
    **Fix:** Keep packs immutable, provide private writable memory overlays, and coordinate every CLI consumer through the same context policy.

11. **Memory return remains incomplete and has a separate path-security boundary.** Changed/added files omit deletions; the plan does not define how server-supplied filenames and symlinks are confined to the locally recorded memory directory.
    **Fix:** Return three-way memory changes, including deletions, and validate contained regular-file destinations before applying them.

12. **The secret scan misses outgoing history.** Scanning only snapshot changes misses secrets in previously unpushed commits—including secrets deleted before the final snapshot. Seeding from HEAD also preserves tracked ignored files, contrary to the stated “not ignored files” boundary.
    **Fix:** Scan the newly uploaded commit history and final tree, and describe the boundary as excluding only untracked ignored files.

13. **Crash recovery is only partially addressed.** Persisting session IDs does not remove the existing startup behavior that automatically retries interrupted turns. Claim/ack also needs its deduplication marker committed with the mutation, or a crash after appending a reply can append it again.
    **Fix:** Persist event IDs atomically with job changes and reconcile interrupted turns instead of automatically replaying them.

14. **Process termination and result validation remain unchanged.** The supplied runner kills only the CLI parent and accepts a parsed success even if the process subsequently exits abnormally; surviving tools could modify a supposedly frozen export.
    **Fix:** Supervise and terminate the process tree, verify clean completion, and require quiescence before producing `ready`.

15. **Upload limits arrive too late unless enforced during ingestion.** A decompressed-size check at `finish` does not bound staged chunks, concurrent uploads, or decompression memory consumption.
    **Fix:** Enforce cumulative storage quotas, chunk-count limits, concurrency limits, and streaming decompression bounds before accepting excess data.

16. **Mutable pages make older batch manifests permanently unverifiable.** The collector runs every two hours but the VPS consumes nightly; a growing chat can overwrite a page several times, destroying the exact content an earlier manifest hashes.
    **Fix:** Reference immutable page versions or content-addressed batch artifacts that remain available until acknowledged.

17. **The applied-manifest ledger is not a transaction.** A crash after appending project/log entries but before recording the manifest ID causes duplicate appends; recording the ID first risks losing updates.
    **Fix:** Use a recovery journal and per-entry idempotency markers so partially applied manifests can safely resume.

18. **Weekly application violates the writer ownership table.** Allowing everything under `wiki/` permits synthesis to overwrite collector sources, status files, and the applied-manifest ledger. A staging copy also provides no execution confinement when the process can directly access the live vault.
    **Fix:** Apply only explicitly owned regular-file paths with preimage checks, and describe staging as review rather than sandboxing—or use tool-free patch generation.

19. **GitHub collection lacks a reliable branch-change cursor.** “Branches pushed since the cursor” needs a defined event source; commit timestamps are not push timestamps, and a fixed 24-hour recovery window misses longer outages.
    **Fix:** Persist branch-tip SHAs, traverse unseen commits with explicit force-push handling, and recover from the last durable checkpoint regardless of outage length.

20. **The summary fallback references incompatible legacy behavior.** “Today’s flow” changes the PC checkout and automatically starts a turn, unlike v2’s snapshot-and-wait contract; it also creates a different conversation lineage.
    **Fix:** Reuse v2 transfer semantics for summary mode and explicitly distinguish its new session from the original resumable session.

VERDICT: REVISE
### Claude's response (round 2)
Accepted all 20 as Rev 3 rules R1–R21 in PLAN.md (4 → R6 shared allowlist incl. `return`; 16+25 resolved more simply by making manifests self-contained (R18) instead of content-addressed page copies; 17 by per-entry idempotency markers (R19)). Nothing rejected this round.

## Round 3 — Codex (same thread, gpt-6.1-sol high)

Rev 3 closes most round-2 findings: temporary-index handling, interrupted-turn replay, process supervision, immutable packs, snapshot boundaries, return ordering, and summary fallback are substantially improved. These material gaps remain:

1. **R16 does not establish that the PC session is closed.** An idle CLI can leave its transcript unchanged for more than two minutes while remaining capable of appending after replacement. Rehashing does not detect that condition.
   **Fix:** Verify session termination or require explicit confirmation of closure on every take-back; use timestamps only as an additional guard.

2. **R17 weakens the portability gate into a warning.** An automatic PC upgrade can therefore enable untested native imports and transcript replacement despite the gate’s stated purpose.
   **Fix:** Default untested version pairs to summary mode until they pass, including desktop-originated sessions and the fresh-worktree return path.

3. **There is still no defined take-back completion acknowledgement.** The server cannot know that local code, transcript, and memory installation succeeded; the shared endpoint allowlist contains no completion operation.
   **Fix:** Add an idempotent completion endpoint keyed by generation and export digest, and transfer ownership only after successful local installation.

4. **Finalizing an upload still has a crash gap.** The staged directory is renamed before the import request is written; a crash between those steps leaves a finalized transfer that the runner never sees. R8 cannot recover an event that was never queued.
   **Fix:** Treat finalized manifests as a durable outbox and reconcile them into the runner queue on startup and retry.

5. **R5 needs enforcement before asynchronous import creates the job.** Two sequential uploads can finish before the runner processes either import, so “one concurrent upload” does not prevent two generations from passing an owner check against existing jobs.
   **Fix:** Atomically reserve the source session during upload admission and validate that reservation again during import.

6. **R19’s retry markers can be destroyed by weekly synthesis.** R20 permits rewriting entity pages, the working-style page, and `index.md`, where markers live. If synthesis removes markers from a partially applied batch, its retry can duplicate previously applied content.
   **Fix:** Have the trusted applicator preserve all existing entry IDs across rewrites, independently of model-produced text.

7. **R4’s patch scan does not cover every outgoing historical blob.** Ordinary `git log … -p` omits merge diffs by default; a secret added and later removed solely through merge resolutions can escape both that scan and the final-tree diff.
   **Fix:** Scan newly uploaded Git blobs, including merge-result trees, rather than relying solely on commit patches.

8. **Weekly Codex still bypasses the context-switch lock.** B.5 protects shared `AGENTS.md` and skills using the runner’s per-agent lock, but weekly synthesis takes only the vault lock. A hand-off job can therefore switch those files while synthesis is running.
   **Fix:** Run weekly synthesis through the same context scheduler or give it an independent configuration home.

9. **R21 records force-pushes without defining complete recovery.** A stored tip may become unavailable, or the replacement history may be unrelated; recording the event does not establish which replacement commits get collected.
   **Fix:** Define a fallback that inventories current reachable commits, deduplicates them, and advances the cursor only after durable publication.

10. **The memory overlay mechanism is specified only for Claude.** R11 binds the overlay through Claude’s `autoMemoryDirectory`; no corresponding Codex memory destination or binding is defined, although memory return is promised for both agents.
    **Fix:** Specify and test Codex’s writable memory artifacts and return mapping, or explicitly narrow the memory-continuity guarantee.

VERDICT: REVISE
### Claude's response (round 3) and resolution
All 10 accepted as R22–R31 (10 narrowed the guarantee rather than building Codex sqlite memory sync). MAX_ROUNDS=3 reached without an APPROVED line: the final revision addresses every open finding but has **not** been re-reviewed. Trend 30 → 20 → 10 findings, each round narrower (architecture → correctness → edge cases). Recommendation to Lind: build in the gated order with the post-build Codex inspection on, rather than spend more review rounds on paper.
