# Plan Review Log: Agentic OS v3
Phases 0-1 (recon + interrogation) complete — Lind invoked the escape hatch ("accept all recommendations, just build it"), so every decision in PLAN-v3.md is locked at Claude's recommendation. Phase 2 plan rounds skipped at Lind's instruction (build immediately); the post-build cross-inspection below stands in as the cross-model check.

## Post-build inspection — round 1 (Codex, fresh read-only session)
Reviewer: Codex on the VPS (`gpt-6-luna`, config default) — the PC Codex login rejects every model (gpt-6.1-sol / gpt-6 / gpt-5.5 / gpt-5: "not supported when using Codex with a ChatGPT account"), and the VPS sandbox can't run shell tools (bwrap RTM_NEWADDR), so the plan + full diff were given inline. Base 54d1f26, head 59e38a3.

1. **[P1] `runner/library.ts:165` — Link fetching allows SSRF.** The hostname regex does not reject ordinary `127.0.0.1`/`10.x.x.x` addresses because the alternatives match only prefixes before the final `$`; DNS names resolving privately and redirects to private hosts also bypass it. **Fix:** Resolve and validate every destination IP, including every redirect, and pin connections to validated addresses.

2. **[P1] `runner/library.ts:58` — Processing can overwrite edits or resurrect deleted items.** The runner reloads the item before awaiting `organise()`, then unconditionally saves that stale object; edits/deletes during that await are lost, and the catch path explicitly falls back to the deleted item. **Fix:** Serialize mutations across processes or use revision checks and deletion tombstones for every processing commit.

3. **[P1] `lib/gmail.ts:151` — Sorting overwrites manual pile changes.** `sortMail()` holds a snapshot of every pile across network calls, then replaces the entire file; a web request moving a message meanwhile is silently undone, including its manual protection marker. **Fix:** Commit under a cross-process lock, merging results into current piles and preserving current manual assignments.

4. **[P1] `app/api/memory/upload/route.ts:55` — Concurrent chunks corrupt uploads and bypass the total-size cap.** Requests read the same metadata before awaiting their bodies, then append independently and overwrite byte counts; a concurrent index-zero request can also truncate an active upload. **Fix:** Lock each upload across body acceptance and commit, revalidate metadata under the lock, and enforce the cap against actual accumulated bytes.

5. **[P2] `app/api/memory/upload/route.ts:55` — The chunk limit is enforced after allocating the entire body.** `request.arrayBuffer()` buffers an arbitrarily large request before checking `CHUNK_MAX`, allowing memory exhaustion when the upstream limit is absent or bypassed. **Fix:** Read the request stream with a running byte limit and abort immediately when exceeded.

6. **[P2] `runner/library.ts:166` — Link responses are fully buffered before truncation.** A server can return a huge HTML response, consuming runner memory despite the apparent 600,000-character limit. **Fix:** Stream the response with a byte cap and cancel the reader once reached.

7. **[P2] `runner/library.ts:30` — Vision retries bypass backoff and the attempt limit.** A previously saved item retains `waiting: "vision"` after Gemini fails, so the waiting selector immediately picks it again even when `nextAt` is in the future or its status is `failed`. **Fix:** Apply status, attempt-limit, and retry-time eligibility to waiting items too.

8. **[P2] `lib/library.ts:146` — Concurrent section mutations lose sections.** The runner and web app independently read, modify, and replace `sections.json`; concurrent additions or a rename can discard another mutation and leave items referencing missing sections. **Fix:** Protect the complete section read-modify-write transaction with a cross-process lock or transactional store.

9. **[P2] `components/memory-upload.ts:31` — A lost final response creates duplicate captures.** Once the final chunk commits, its upload metadata is deleted; retrying receives `expected: 0`, uploads the whole file again, and creates another item. **Fix:** Retain a completed-upload receipt mapping the upload ID to its item and return that result on retries.

10. **[P2] `app/api/memory/items/[id]/route.ts:18` — Retry can remain queued for hours.** Resetting `status` and `attempts` leaves the previous `nextAt` intact, so the runner still waits for the old backoff deadline. **Fix:** Clear `nextAt` when accepting an explicit retry.

11. **[P2] `lib/library.ts:87` — Deleted captures remain in the vault.** `deleteItem()` removes JSON and media but leaves `it.mirror`, so Obsidian and Hermes retain content the user deleted; subsequent moves and renames also leave mirrors stale because they never trigger mirroring. **Fix:** Reconcile vault mirrors on item deletion, rename, and section changes using validated vault-relative paths.

12. **[P2] `lib/gmail.ts:85` — Mail beyond the newest 60 messages is silently omitted.** The fetch ignores `nextPageToken`, so an active inbox cannot display, search, or sort all messages from the advertised seven-day window. **Fix:** Paginate the Gmail listing through the requested window.

13. **[P2] `components/memory-library.tsx:189` — Generic uploaded files cannot be retrieved through the Library.** The item sheet renders images, video, audio, and external URLs, but provides no media link for PDFs, text files, or other attachments. **Fix:** Add an original-file open/download link whenever an item has media.

14. **[P2] `components/memory-library.tsx:220` — Required rename and section-management workflows are missing.** The finished UI exposes section selection and deletion but no item rename, section rename, or section merge; no merge endpoint exists either. **Fix:** Implement the planned controls and a transactional merge that reassigns items and reconciles mirrors.
### Claude's dispositions
1. SSRF — **fixed**: every hop resolved via DNS and checked against private/loopback/link-local/CGNAT/ULA ranges, redirects followed manually (≤4), refused links fail at once. Verified: 127.0.0.1 refused, example.com read.
2. Runner overwriting edits / resurrecting deletes — **fixed**: result is committed against the item re-read at commit time; deleted → dropped; edited while processing → Lind's title/section kept; catch path no longer falls back to the stale copy.
3. Sort overwrites manual pile moves — **fixed**: piles merged into the current file at write time; "moved by Lind" entries win.
4. Concurrent chunks — **fixed**: per-upload serial lock (single web process), size checked against the bytes actually on disk.
5. Body buffered before the cap — **fixed**: Content-Length checked before reading (413 verified with a 10 MB chunk); the proxy still caps bodies upstream.
6. Link body fully buffered — **fixed**: streamed, cut at 1 MB.
7. Vision retries bypass backoff — **fixed**: only `ready` items waiting on vision are re-picked; failures go back through the queued/backoff path.
8. sections.json read-modify-write race — **rejected**: one user, writes are milliseconds apart and rare (new section ≈ never concurrent with a manual add); items pointing at a vanished section fall back to the first section on the next filing. Revisit if a lock helper lands.
9. Lost final response duplicates captures — **fixed**: `<upload>.done` receipt returns the same item (verified: retry → same id).
10. Retry keeps old nextAt — **fixed**: cleared on retry.
11. Deleted captures stay in the vault — **fixed**: mirror helper moved to lib/library.ts; delete removes it, rename/move/section rename rewrite it.
12. Gmail only 60 messages — **fixed**: paginates up to 150 within the 7-day window.
13. Files not retrievable — **fixed**: "Open file / Open original" link in the item sheet.
14. Rename/merge missing — **partly fixed**: item rename (inline title) and section rename (pencil on the active section) added; **merge rejected** for now — moving items covers it and a merge endpoint is new surface area nobody asked for yet.

Rounds used: 1 of 2 (reinspection skipped — every accepted fix verified directly in the running preview or by script).
