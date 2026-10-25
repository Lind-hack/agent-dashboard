# Plan: Phone-first continuity — two-way hand-off + the Lind Brain framework
_Locked via claudex-loop — by Claude + Lind (2026-10-25). Revision 3 after Codex rounds 1–2; "Rev 3 rules" at the end override anything above._

## Goal
When the laptop is off, absent, or Lind doesn't want to sit at it, he continues any Claude Code or Codex
chat from his phone at agents.383ks.com **with the full conversation, his uncommitted code, and his
rules/memory/skills** — after he explicitly hands it off. When he's back, `/takeback` brings the chat, the
VPS's code and any memory changes home, so `claude --resume` / Codex resume continues on the PC.
Separately, a "brain" framework analyses everything he does with agents — every Claude/Codex chat
(terminal + desktop app), graphify graphs, GitHub commits across all repos, dashboard chats, Linear — and
crystallizes it into the Obsidian vault (Karpathy LLM-Wiki pattern, vault `AGENTS.md`). Standing rule:
**capture as much durable memory as possible.**

## Build order (each stage gated on the previous)
0. **Portability gate (before any UI):** round-trip smoke tests on the real stack — a PC Claude transcript
   (with tool calls, a compaction, attachments; one CLI and one desktop-app session) and a PC Codex rollout
   copied to the VPS → resumed with a "what were we doing?" turn → copied back → resumed on the PC. Pin the
   VPS Claude CLI to the tested version (PC is 2.1.310; VPS 2.1.197 is below the 2.1.223 cross-project
   lookup) and Codex to the tested version; `update.sh` installs exactly those, never "latest". If either
   agent fails the gate, that agent's hand-off ships as **summary hand-off** (brief + code, today's flow)
   and the gap is reported, not hidden.
1. Hand-off v2 + take-back. 2. Brain collector (PC) + VPS brain job. 3. Weekly synthesis. 4. Observability.

## A. Hand-off v2 (PC → VPS), manual only
1. **Session identity:** `handoff.mjs --session <id>` is authoritative. Without it, the script lists
   candidates in the invoking repo (transcript path, repo root, worktree, last 2 user messages, last write);
   inside `/handoff` the candidate whose *latest user record contains the hand-off invocation* is
   preselected and shown for confirmation. `--list` picks any chat from the last 14 days (Claude CLI +
   desktop-app sessions under `~/.claude/projects`, Codex CLI + app rollouts under `~/.codex/sessions`).
2. **Checkpoint semantics:** the transcript is copied (read once, sha256 recorded) at the moment the script
   runs; the `/handoff` turn's own trailing records are not part of the checkpoint (harmless). The skill's
   last instruction tells Lind to exit that PC chat. The PC CLI can't be locked; divergence is detected at
   take-back by hash and never overwrites (see C).
3. **Code snapshot (PC checkout untouched):** in the repo of the chat's last cwd, in a private temp dir:
   `GIT_INDEX_FILE=<tmp>/index git read-tree HEAD`, `git add -A` (honours .gitignore), `git write-tree`,
   `git commit-tree -p HEAD` → push to `refs/agent-handoff/<sessionId>/<generation>`. Boundary, stated in
   the hand-off result: tracked + untracked non-ignored files; **not** ignored files, submodule dirt,
   staged-vs-unstaged distinction, files outside the repo. Unborn repo / no GitHub remote / repo not on the
   write token → conversation-only hand-off, said explicitly. **Secret scan** of the snapshot's changed
   files (filename patterns `.env*`, `*.pem`, `id_*`, `*.key`, credentials JSON, plus content regexes); hit
   → abort with the list unless `--allow-secrets`.
4. **Generation:** every hand-off gets `generation = <unix ms>`; storage is
   `handoffs/<sessionId>/<generation>/` — nothing is reused or deleted, older generations are archived.
5. **Upload protocol** (`/api/handoff/v2/*`, Bearer `HANDOFF_TOKEN`; `proxy.ts` allows exactly
   `/api/handoff`, `/api/handoff/v2/start|chunk|finish|list|export`): `start` returns an upload id after
   validating metadata (agent, sessionId and generation as strict patterns — no paths from the client are
   ever used as filesystem paths); `chunk` (≤ 40 MB, index, sha256) idempotent per index; `finish` verifies
   count + whole-file sha256 + max 1 GB decompressed, then atomically renames the staged dir into place and
   writes an **import request** to the runner inbox with an idempotency key. Uploads expire after 24 h.
6. **Context pack** (only when its hash changed; versioned dir, atomic symlink swap on the VPS):
   `C:\Users\PC1\CLAUDE.md`, `~/.claude/rules/*.md`, enabled `~/.claude/skills` (minus `skillOverrides:
   off`), **every** project memory dir `~/.claude/projects/*/memory/`, Codex `~/.codex/AGENTS.md` +
   `~/.agents/skills`. Never settings.json, hooks, credentials, MCP config.

## B. VPS import and runner
1. Runner inbox gets **claim/ack** semantics: an item is moved to `inbox/claimed/` before processing and
   deleted only after the job file is written; on startup claimed items are re-processed (idempotency key
   prevents duplicates). Applies to all inbox kinds.
2. **Import event** → job `H-<short>`: `agent`, `sessionId`, `generation`, `repo`, `snapshotSha`,
   branch `pc/<slug>-<short>`, `owner: "vps"`, `imported: { pcTranscriptPath, pcSha, projectDir,
   memoryDir, needsPreamble: true }`, status **waiting** with **no pending turn** (the phone's first
   message starts it).
3. Before the first turn: install the transcript — Claude: into `~/.claude/projects/<encoded VPS worktree
   cwd>/<sessionId>.jsonl`; an older copy of the same id elsewhere is **moved** to
   `DATA_DIR/handoffs/archive/` (never deleted) so lookup is unambiguous. Codex: under
   `$CODEX_HOME/sessions/YYYY/MM/DD/<original filename>` (existing same-id file archived the same way).
   Worktree: `ensureWorktree` gains `fromSha`: fetch `refs/agent-handoff/<sid>/<gen>` explicitly, create
   `pc/...` at that SHA.
4. **Preamble:** `needsPreamble` makes `runTurn` prepend the relocation note to the first resumed prompt
   (the normal `brief()` path is skipped when `sessionId` is set): PC path → VPS path, branch, snapshot time
   and boundary, unavailable tools (Chrome/DevTools MCP, D:, Windows apps, local dev servers), "rules and
   memory are the same as on the PC". Cleared after the turn succeeds.
5. **Per-job context**, not global mutation: Claude runs with `--settings <job settings.json>` whose
   `autoMemoryDirectory` = the pack's copy of *that chat's* project memory dir; rules/skills/CLAUDE.md come
   from the pack version pinned on the job (installed into `~/.claude` only between turns under the runner's
   per-agent lock; jobs pin the pack version they started with). Codex: `AGENTS.md`/skills likewise.
6. **History on the phone:** `GET /api/jobs/<id>/history?before=<cursor>` parses the imported transcript
   (user text, assistant text, compact tool lines; thinking dropped) newest-first, paginated; rendered with
   the existing safe markdown component as "Earlier on PC" above the dashboard turns.
7. Session ids for normal jobs are persisted on `init` events (not only after the turn), so a restart
   mid-turn doesn't lose them.

## C. Take-back (VPS → PC)
1. **Only via freeze:** phone "Bring back to PC" (or `takeback.mjs` calling `/api/handoff/v2/return`)
   sets `owner: "returning"`; the runner stops accepting replies/requeues for it, waits for a running turn
   to end, pushes the branch, then writes an **export manifest**: generation, transcript sha256, final
   branch + commit SHA, memory-dir diff (changed/added files with hashes), status `ready`. `export` serves
   only `ready` jobs.
2. `takeback.mjs` (PC): takes a local lock file; resolves the destination from the **local** hand-off
   record written at hand-off time (`~/.agent-dashboard/handoffs/<sid>-<gen>.json`), never from the server;
   downloads + verifies the export; if the current PC transcript hash ≠ the hand-off hash, the PC file is
   renamed to `<id>.pc-backup-<ts>.jsonl.bak`; installs via temp file + atomic rename.
3. **Code:** `git fetch origin pc/<branch>`; if the original worktree is clean or exactly at the snapshot
   state, `git switch` it to `pc/<branch>` (fast-forward); otherwise stop and print the exact commands — the
   session is reported "ready to resume" only once the code is in place.
4. **Memory back:** changed memory files from the manifest are written into the PC memory dir; a file that
   also changed on the PC since hand-off is written as `<name>.vps.md` next to it and listed.
5. Dashboard marks the job `owner: "pc"`, closed.

## D. Brain framework
**Writer ownership** (prevents Syncthing conflicts between our own writers):
| File(s) | Only writer |
|---|---|
| `wiki/sources/chats/*`, `wiki/sources/graphs/*` (PC-origin chats) | PC collector |
| `wiki/sources/commits/*`, dashboard-chat pages, `wiki/maintenance/brain-status.md` | VPS brain job |
| `log.md`, `index.md`, `wiki/entities/*`, `wiki/concepts/Lind — working style.md` (append sections) | VPS brain job (append-only) |
| merges/rewrites of entity pages, `synthesis.md`, Open Questions | weekly Luna job |
Generated pages carry `generated: true` + a "regenerated by the brain — edit the project page instead"
banner. All VPS writers take `flock /var/lib/agent-dashboard/vault.lock`; times are staggered away from the
existing `daily-lind-brain-planner.timer` (05:40 UTC) and Hermes cron jobs that also touch the vault.

1. **PC collector** `brain-collect.mjs` (Task Scheduler: at logon + every 2 h, hidden; single-instance
   mutex): state per transcript = generation (inode/ctime/first-record uuid), last processed record uuid,
   page path; a rewritten/shrunk file is re-processed from scratch. Processes chats quiet ≥ 20 min; skips only
   trivial ones (< 200 chars of user text). Sources inventoried on first run and listed in status (CLI and
   desktop-app Claude sessions, Codex CLI/app rollouts; anything unreadable is reported, not skipped silently).
   - Condense locally (user text, assistant text, compact tool lines, error first lines; no thinking/bulky
     results), **redact** (tested regex suite: provider keys incl. `nvapi-`, `github_pat_`, `gh?_`, `sk-`,
     `AKIA`, JWTs, PEM/private-key blocks, `Authorization:`/`Cookie:` headers, URL credentials, KEY=value with
     secret-like names, long high-entropy tokens) — a unit-tested function shared by PC and VPS.
   - Nemotron 3 Ultra map-reduce (bounded retries/backoff) → page `wiki/sources/chats/<YYYY-MM-DD> <agent>
     <sid8> <slug>.md` (stable id in the name; title in frontmatter). Sections: Summary · Goals · Decisions
     (with reasons) · Lind's corrections & preferences · Built & verified · Failures & fixes · Commands,
     files, commits, URLs · People & services · Open threads.
   - Graphify: `graphify-out/` report per repo, when changed → `wiki/sources/graphs/<repo> <date>.md`.
   - Emits one **batch manifest** per run `wiki/maintenance/brain-inbox/<ts>-pc.json`: page paths + content
     sha256, recent-work bullets per project, working-style candidates, log lines. Written last.
2. **VPS brain job** (systemd timer 02:30 UTC daily, under the vault lock):
   - GitHub (new read-only token, all repos): list repos, per repo all branches pushed since the cursor
     (paginated, overlapping 24 h window, dedupe by SHA) → `wiki/sources/commits/<repo> <date>.md`.
   - Dashboard chats + Linear updated since cursors (same redaction gate) → pages/bullets.
   - Applies batch manifests **only when every referenced file is present with matching hash**; records
     applied manifest ids in `wiki/maintenance/brain-applied.json` so retries never double-append.
3. **Weekly synthesis** (Sunday 18:00 UTC, under the lock): `codex exec -m gpt-6-luna -c
   model_reasoning_effort="max"` as `agent` in the vault, following vault `AGENTS.md` (verified: the VPS
   Codex login accepts gpt-6-luna). VPS bubblewrap sandbox is unavailable, so the job runs in a **staging
   copy** of the vault; the runner diffs it, applies only changes under `wiki/`, `index.md`, `log.md`,
   `synthesis.md`, then records every changed file in `log.md`.
4. `deploy/vault-access.sh` extended with rwX ACL (+default) for agent on the vault.
5. **Observability:** `wiki/maintenance/brain-status.md` + dashboard Brain strip: per source last success,
   lag, items processed, failures + last error, redaction counts, Nemotron/Luna run results. A source
   failing 2 runs in a row → Inbox item.

## Key decisions & tradeoffs
- Manual hand-off only (Lind, Q1); only redacted, condensed text reaches NVIDIA; only summaries enter the vault (Lind, B2).
- Free Nemotron for bulk, Luna 6 max weekly synthesis; Claude plan untouched (Lind, B1).
- Append-only bulk writer; one weekly editor (Lind, B3). Two tokens (Lind, Q3). Two-way, single owner (Lind, Q4).
- Rejected (logged): "VPS-authoritative sessions" (Lind works natively in PC terminals/apps — can't be
  forced); per-job OS user isolation (single-user box; agents already have full access by earlier decision).

## Assumptions
1. Claude resumes a copied transcript from any `~/.claude/projects/<dir>/` (≥ 2.1.223) — docs; **gate 0 proves it**.
2. Codex resumes a copied rollout — runner resumes VPS rollouts; **cross-OS proven in gate 0**.
3. Vault on PC `D:\Obsidian\Lind Brain`, Syncthing sendreceive with the VPS — day_planner.py, Syncthing config.
4. Existing vault writers: `daily-lind-brain-planner.timer` (VPS, 05:40 UTC), Hermes cron jobs — observed.
5. NVIDIA free tier ~40 req/min — to verify with a burst probe in stage 2.
6. VPS Codex login accepts `gpt-6-luna` and `gpt-6.1-sol`; the PC login accepts neither — verified 2026-10-25.

## Risks / open questions
- Gate 0 may fail for Codex cross-OS → summary hand-off for Codex.
- Very large transcripts (271 MB) — upload minutes over the tunnel.
- Hand-off transcripts are verbatim (needed for resume), stored agent-only; agents on the box could read them.
- Git auth header visible in process args to other local users (existing).

## Out of scope
- Background transcript mirroring (Lind rejected). Claude.ai web/mobile chats. Hermes' own pipelines.

## Rev 3 rules (override the sections above where they differ)
**Hand-off**
- R1. Every snapshot git subprocess runs with `GIT_INDEX_FILE` in its environment (not a one-command prefix); temp dir removed in `finally`.
- R2. Checkpoint = transcript truncated at the record **before** the latest user record that contains the hand-off invocation (or at the last complete, JSON-valid line when `--session` is given for a chat that isn't running); a trailing partial line is dropped. Code snapshot is taken in the same script run immediately after.
- R3. Snapshot boundary wording: tracked files (incl. tracked-but-ignored) + untracked non-ignored files; excluded: untracked ignored files, submodule dirt, staged/unstaged distinction, files outside the repo.
- R4. Secret scan covers the final tree diff **and every commit being newly pushed** (`git log <remote-known-tip>..<snapshot> -p`), so secrets added then deleted are caught.
- R5. One open generation per session: a new hand-off of a session whose earlier generation is still `owner: vps|returning` is refused until it is taken back or closed.
- R6. Upload limits enforced while ingesting: ≤ 30 chunks, cumulative staged bytes ≤ 1.2 GB, one concurrent upload, streaming gunzip with a byte cap; all transfer endpoints (`start|chunk|finish|list|return|export`) come from one shared allowlist constant used by `proxy.ts`, with a test.
- R7. Summary mode (gate-0 fallback) uses the same v2 transfer (snapshot + wait, PC checkout untouched) but starts a **new** VPS session from a generated brief; the job is labelled "summary hand-off — not the original session" and take-back returns code + memory only.

**Runner robustness**
- R8. Processed event ids are stored in the job file in the same atomic write as the mutation they cause (inbox claim/ack dedupe survives crashes).
- R9. Interrupted turns are no longer auto-replayed on startup: they're marked `interrupted` and surface in the Inbox for Lind to resend.
- R10. Agents are spawned in their own process group; cancel/timeout kills the group; a turn counts as successful only with a parsed result **and** exit code 0; `ready` exports require no live process for the job.

**Context and memory**
- R11. Packs are immutable. Each imported job gets a private writable memory overlay `handoffs/<sid>/<gen>/memory/` initialised from the pack's copy of that chat's project memory dir; `--settings` points `autoMemoryDirectory` there.
- R12. Memory return is three-way (base = pack copy, VPS = overlay, PC = current): added/changed/deleted; conflicts → `<name>.vps.md`; filenames must match `^[\w.-]+\.md$`, regular files only, written only inside the locally recorded memory dir.

**Take-back**
- R13. The branch is stored once as a full ref (`refs/heads/pc/<slug>-<short>`) plus the export's commit SHA; take-back fetches it and verifies the SHA before anything else.
- R14. Order: download + verify all artifacts into a staging dir → establish code → install transcript → apply memory. If the code step fails, nothing is installed.
- R15. Code: if the original worktree is clean (or equals the snapshot tree), create/fast-forward the local branch explicitly (`git branch` only if ancestor) and switch; if switching is obstructed (e.g. formerly-untracked files), create a fresh worktree `<repo>-takeback-<short>` at the SHA and report its path (Claude's cross-project lookup still resumes the session there).
- R16. Transcript install requires the PC chat to be closed: refuse if the transcript was modified in the last 2 minutes or its hash changed since the hand-off unless Lind confirms; re-hash immediately before the atomic rename.
- R17. Portability gate checks real operations both ways (read + edit a file in the checkout, write a memory note, return, resume on PC and see both). Gate results are recorded per (PC CLI version, VPS CLI version); `handoff.mjs`/`takeback.mjs` warn when the current pair hasn't passed.

**Brain**
- R18. Batch manifests carry everything needed to apply them inline (bullets, log lines, candidates, page paths); applying needs only that referenced pages *exist*, not a specific hash — so chat pages may keep being regenerated.
- R19. Every appended line carries a hidden marker `<!-- brain:<entryId> -->`; apply skips entries already present, so a crash mid-apply is safe to resume. The applied-manifest list is an optimisation, not the source of truth.
- R20. Weekly synthesis = review, not sandbox: Codex edits a staging copy; the job applies changes only to the owned paths (entity pages, `synthesis.md`, `index.md`, Open Questions, working-style page), only if the live file still matches the staging preimage; everything else in the diff is discarded and listed.
- R21. GitHub cursor = persisted branch-tip SHA per repo/branch; new commits via the compare API from the stored tip; force-pushes (stored tip not an ancestor) are recorded as such; recovery resumes from the stored tips regardless of outage length.

## Rev 3.1 rules (after Codex round 3; override earlier text)
- R22. Take-back always asks Lind to confirm the PC chat is closed (every time); the 2-minute/hash checks are extra guards, not the proof.
- R23. Untested (PC CLI, VPS CLI) version pairs default to **summary mode**; native import/replace is enabled per agent only after the gate passes for that exact pair (incl. one desktop-app session and the fresh-worktree return path).
- R24. `POST /api/handoff/v2/complete {sessionId, generation, exportDigest}` (idempotent, in the shared allowlist) — ownership becomes `pc` only after the PC reports a successful install.
- R25. `finish` writes the import request into a durable **outbox** before/with the staged rename; runner startup reconciles finalized-but-unqueued transfers.
- R26. `start` atomically reserves the session (`O_EXCL` reservation file); the reservation is re-checked at import and released on take-back completion or explicit close.
- R27. Brain idempotency: after each appended entry the applicator records its entry id in an append-only ledger (fsync per entry); retries skip ids found in the ledger **or** as page markers — weekly rewrites can't cause duplicates.
- R28. Secret scan covers every newly uploaded blob (`git rev-list --objects <remote-known-tip>..<snapshot>` → scan each blob), not just patches.
- R29. The weekly Luna job takes the same Codex context lock the runner uses before touching `~/.codex` context.
- R30. GitHub force-push fallback: collect commits reachable from the new tip that aren't in the per-repo seen-SHA set (bounded to 500 per run, continues next run); the cursor advances only after the page is written.
- R31. Memory continuity guarantee is narrowed explicitly: Claude memory notes travel both ways; Codex gets `AGENTS.md` + skills, but Codex's internal memories (sqlite) are not transferred.
