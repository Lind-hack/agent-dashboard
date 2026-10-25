# Plan: Agentic OS v2 — a sleek multi-agent command center that runs Lind's day toward his goals
_Locked via claudex-loop — by Claude + Lind (2026-10-26). Research tier: web._

## Goal
Turn the dashboard into a production-grade, futuristic "Agentic OS" whose whole point is reaching Lind's
personal and business goals. It (1) looks like the HUD/visual-cortex references (images 20–23) with the
real Claude / Codex / OpenCode / Hermes logos and no generic circles; (2) has a multi-agent **Room**
(Solo · Team · Roast debate with visible per-model reasoning, votes and a judged verdict); (3) has a
**Goals** system that steers an automatic 07:00 day plan synced to Google Calendar + TickTick; (4) learns
what he actually does through a PC activity monitor + push-notification check-ins; (5) saves memory
automatically into a much deeper **Memory** (rings / timeline / network, per-source toggles); (6) speaks
replies with a free voice; (7) gives the VPS agents his skills/MCPs/connectors safely, with a Connectors
page showing PC vs VPS.

## Build order (locked Q1 — each stage ships and is usable before the next)
1. Design system v2 + shell + home HUD + agent logos
2. Room (Solo · Team · Roast)
3. Goals + activity monitor + check-ins + notifications + 07:00 auto-planner
4. Memory v2 (visual cortex, sources, automatic capture, forget)
5. Voice replies + connectors (skills/MCP/connector sync, approvals, Connectors page)

Every stage: `next build` on the VPS scratch worktree, phone (390px) + desktop screenshots via Chrome
DevTools against a preview, `design-loop` critique vs the reference images for UI stages, fresh read-only
Codex cross-review of the diff, then Lind deploys (update.sh).

## Stage 1 — Design system v2 ("Night Console v2")
- Evolve DESIGN.md (impeccable `document`/refine, not replace): keep near-black glass, Geist, agent
  colours (coral Claude, blue Codex, mint OpenCode, violet Hermes); add a cool white-cyan HUD accent,
  Geist Mono uppercase micro-labels, hairline data lines/sparklines, corner-bracket frames on key cards,
  a particle "core" (canvas, ~30 fps, paused offscreen / reduced-motion still frame) replacing the orb as
  the signature. Ban list: plain coloured circles as agent avatars, generic gradient blobs, glyph icons.
- `components/agent-logo.tsx`: inline SVG marks (Claude starburst, OpenAI knot for Codex/Codex cloud,
  OpenCode, Hermes/Nous) in 12–14px-radius tiles with the agent colour glow; sizes xs–xl; used
  everywhere an agent appears (chats, inbox, room, agents, usage meters). Sources: LobeHub /
  Dashboard Icons (MIT) and the Nous Research GitHub; personal use only.
- Shell: sidebar groups Workspace (Home, Inbox, Room, Today, Memory) / Tools (Agents, Connectors,
  Website) / Settings; phone tab bar Home · Inbox · core(Talk) · Room · More.
- Home HUD (desktop 3 columns, phone 1): left = goal progress + today's plan blocks + directives;
  centre = live core with agent status ring (logos, working/idle) + "now" line from the activity
  monitor; right = quick skills (Plan today, Inbox brief, Roast this…), voice, Claude/Codex usage meters.
  Real data or honest empty states only (PRODUCT.md principle 3).

## Stage 2 — Room (locked Q3)
- One page `/room`, three modes:
  - **Solo**: pick one agent (logo cards), chat as today.
  - **Team**: pick 2–4 agents; same task in parallel (today's Ask all) or Relay plan→build→review.
  - **Roast**: debate until consensus.
- Roast protocol (runner, new group kind `roast`):
  - Round 1: each selected agent answers independently (heterogeneous models; prompts ask them to
    defend their position unless shown real evidence — "stubborn" prompting improves debates).
  - Rounds 2–3: each agent gets the others' latest answers, must name the weakest claim in each
    ("roast"), state what it now agrees with, and revise. Max 3 rounds; early stop.
  - Judge = Nemotron (neutral, not a debater) after each round: agreement score 0–100, open
    disagreements, per-agent stance + confidence, who changed position and why; told to weigh
    evidence (files, commands, facts) over eloquence and to flag premature/sycophantic agreement.
    Stop when score ≥ 80 and no open blocking disagreement, or after round 3.
  - Final verdict card (image-23 style): chosen approach, each model's final position, vote matrix,
    dissent kept visible. Lind can override; "Run it" sends the verdict as a task to a chosen agent or a
    Relay on a normal branch.
- Read-only during debates: Claude `--permission-mode plan` + disallowed Edit/Write/NotebookEdit,
  Codex `-s read-only`, OpenCode plan agent, Hermes chat only. Worktree per room on base, discarded.
- Usage guard: show estimated cost before start (per-agent % of weekly limit from the usage meters);
  default team OpenCode + Hermes + Codex; Claude opt-in when its weekly usage > 70%.
- UI: per agent a column (phone: swipeable cards) with logo, round answers (collapsible), roast lines,
  confidence; live agreement meter; verdict card.

## Stage 3 — Goals, activity monitor, check-ins, notifications, planner (locked Q2, Q2b, Q5)
- **Goals model** `data/goals.json` (runner/web shared lib): vision (read from vault Personal Goals),
  3–6 active goals {id, title, kind personal|business, metric, target, current, due, why, projects[]},
  projects {name, repo?, linearLabel?, tickTickList?}. The OS writes a generated mirror to the vault
  (`100 - Me/Goals (OS).md`); the OS is the source of truth. First draft generated from vault + brain
  pages by Nemotron, shown for Lind to correct before activation.
- Goals page (inside Today): progress per goal (manual + automatic signals: commits/PRs per project,
  plan blocks completed, check-in answers), weekly score from the Sunday Luna pass.
- Agent briefs include the goal a task serves (runner `brief()` gets a "Serves goal" line).
- **PC activity monitor** `handoff/pc-monitor.mjs` (Task Scheduler at logon, long-running, hidden;
  Lind installs): every 60 s active app + window title (PowerShell Win32 GetForegroundWindow);
  every 10 min a screenshot only if active (GetLastInputInfo < 5 min), not locked, not night
  (00:30–07:00), not paused, foreground not on the blocklist (banking, WhatsApp, Instagram/TikTok
  DMs, password managers, private/incognito, user additions). Screenshot JPEG in memory → POST to
  `/api/activity/frame` → VPS calls the free vision model (Cosmos Nemotron 34B free endpoint; fallback
  Groq vision) for ONE line ("Editing 383 Tregu leaderboard in VS Code") → image discarded, never
  written to disk on either side. Window-title samples are redacted before upload. Pause toggle on
  PC (tray-less: a flag file + `--pause`) and in the OS (Settings + notification action).
- Activity timeline `data/activity/<date>.ndjson` (text only) → feeds planner, check-ins, memory.
- **Notifications**: web push (`web-push`, VAPID keys generated once and persisted in data/, never
  regenerated), service worker in the PWA; works on Android and iOS 16.4+ home-screen installs.
  Kinds: 07:00 plan, block start, re-plan heads-up, check-in question, evening review, approvals
  (stage 5), brain failures. Quiet hours; max ~6/day; actions open the relevant page.
- **Check-ins** (2–4/day + 21:30 evening): Nemotron writes one specific question from the last hours
  of activity + plan + goals ("2 h on trading-brain — what were you trying to get done?"). Answer by
  voice or text in a `/checkin/<id>` sheet → saved to memory (vault `100 - Me/Check-ins/YYYY-MM.md`
  append-only) and to the day record.
- **07:00 auto-planner** (runner, Europe/Belgrade): inputs = goals (time weighted to the highest-leverage
  goal), Google Calendar fixed events (never touched), TickTick due/overdue tasks, yesterday's
  unfinished blocks, activity patterns (when he actually works). Writes its own tagged events
  (`agentDashPlan`) to Google Calendar immediately; TickTick: sets times on existing tasks, may create
  clearly labelled tasks, never completes/deletes. Push with Adjust / Re-plan / Clear. Midday re-plan
  only moves its own future blocks (never the current one) with a heads-up. Evening check-in closes the
  day → feeds tomorrow + memory. Google token must include calendar.events (already authorised).

## Stage 4 — Memory v2 (locked Q4)
- Sources registry with toggles, counts, last sync: Claude chats, Codex chats, dashboard chats, GitHub,
  graphify, activity, check-ins, voice/quick captures, plans/goals/day reviews, Hermes + Telegram bot
  conversations, TickTick, Google Calendar (titles/times only), Obsidian vault. Opt-in later (off):
  Gmail (subjects + sent), Notion, Granola, Drive, ChatGPT export.
- Automatic capture: anything said/typed to "remember" (voice, chat, capture box — Groq intent check)
  → `100 - Me/Memories/YYYY-MM.md` + index; Hermes/Telegram transcripts via their logs on the VPS/PC.
- Never saved: secrets (shared redactor), blocklisted apps, other people's private messages, raw
  screenshots/audio.
- Visual cortex page: Rings (records by source, image 20), Timeline (24h/7d/30d/90d/1y/All lanes per
  source with density, image 22), Network (vault link graph, sampled), search bar, "Explore network".
  Data from a memory index endpoint (counts per source/day, nodes/links capped for phone).
- "Forget this": removes an item from the search index and deletes/redacts its vault entry (generated
  pages) with a log line.

## Stage 5 — Voice + connectors (locked Q6)
- Voice replies: Kokoro-82M (ONNX, q8) as a small service on the VPS (Python `kokoro-onnx` or
  `kokoro-js`, chosen by an ARM benchmark at build time; target RTF < 0.5) → `/api/tts`; default voice
  `am_michael`; speaks short replies (first ~400 chars / summary) with mute toggle; browser
  speechSynthesis fallback; Piper if Kokoro is too slow.
- Skills sync: PC collector uploads skill folders (markdown/text only, no binaries/secrets) nightly →
  VPS `~agent/.claude/skills` + `~/.codex/skills`, skipping skills that need Windows/Chrome/PC paths.
- MCP on VPS agents: context7 + GitHub (read token). Not chrome-devtools, not nanobanana.
- claude.ai connectors: first verify they load for the VPS Claude login. If yes: read tools allowed;
  write/send/delete tools denied via per-turn `--settings` deny rules; an agent needing one emits an
  approval request → push notification Approve/Deny → on approve the runner continues the session with
  that single tool allowed for one turn. Hooks: only logging/format ones.
- Connectors page: PC vs VPS for MCPs, plugins, skills, hooks, claude.ai connectors (from a PC manifest
  uploaded by the collector + VPS inspection), with status and the recommended additions (GitHub MCP,
  Linear MCP, Telegram notifications, Railway read-only, Supabase read-only, YouTube Analytics).

## Key decisions & tradeoffs
- Staged build, design system first (Q1). Goals are a 3-level model with the OS as source of truth,
  drafted by AI and corrected by Lind (Q2).
- Activity monitor sends screenshots to a free cloud vision model but never stores images; blocklist,
  pause, night-off; check-ins via web push (Q2b) — accepted privacy trade-off for richer memory.
- Debate judge is a neutral free model, max 3 rounds, read-only debaters, usage guard (Q3).
- Planner auto-applies but only owns its own tagged events/tasks (Q5).
- Agents get skills freely, MCP/connectors read-only with phone approval for writes (Q6).
- Everything scheduled runs inside the runner (no new systemd units — the classifier blocks me from
  installing them; Lind installs PC Task Scheduler entries).
- Rejected: local vision on the PC (no GPU), paid TTS, a separate goals app, judge = Claude/Codex.

## Toolchain
- Claude (UI stages 1, 2, 4): `impeccable` (with PRODUCT.md / DESIGN.md), `design-taste-frontend`,
  `web-design-guidelines`, `frontend-ui-engineering`, `design-loop` (references = images 20–23).
- All stages: `code-review-and-quality`; fresh read-only Codex cross-review per stage.
- Codex side: reviewer only (read-only).

## Assumptions
1. Agents console has Ask one/Ask all/Relay; plain circle avatars — `components/agents-console.tsx`.
2. Plan my day is manual; TickTick read-only in the plan; no 07:00 job — `lib/planner.ts`, `lib/ticktick.ts`.
3. Voice is input only (Groq Whisper) — `app/voice`, `components/use-recorder.ts`.
4. Memory = BM25 + Groq answer + simple ring visual; vault fed by the brain — `lib/memory.ts`, `runner/brain.ts`.
5. No goals model; vault has values-level Personal Goals / About Me / Active Builds — vault `100 - Me`, `400 - …`.
6. VPS Claude has no MCPs and 11 skills; PC has 158 Claude + 201 Codex skills, 3 MCPs + node_repl, 6 hook types, ~20 plugins — config inspection 2026-10-26.
7. claude.ai connectors on the VPS login: unverified — test first in stage 5.
8. Kokoro stock ~0.35 RTF on ARM CPU (self-reported) — huggingface dlyog/af_heart_arm_tts; benchmark at build.
9. Cosmos Nemotron 34B is a free NVIDIA endpoint with image input — build.nvidia.com model card; verify live.
10. Web push works on iOS 16.4+ only for home-screen installs; VAPID keys must stay stable — Next.js PWA guide.
11. Debate: heterogeneous agents, ~3 rounds, judge must weigh evidence over persuasion — Du et al. 2305.14325, 2511.07784, 2605.19193.
12. Runner can host schedulers (brain nightly/weekly already does).

## Risks / open questions
- Usage: Roast with Claude/Codex consumes subscription limits; guard mitigates, can't eliminate.
- Free vision endpoint availability/rate limits may change → Groq fallback, then title-only mode.
- Screenshots of sensitive content outside the blocklist still reach a third-party model (accepted).
- Web push on iOS requires Lind to install the PWA to the home screen.
- Kokoro RAM/CPU on the shared VPS alongside Hermes/383 pipelines.
- claude.ai connectors may not load under the VPS CLI login.

## Out of scope
- Light theme; public sharing; finance/demo cards; auto-merge or deploy by agents; Gmail/Notion/Granola/
  Drive/ChatGPT sources until toggled on later; moving Hermes' news pipeline; native mobile app.

## Rev 1 rules (after Codex round 1 — override the sections above where they differ)
**Auth & trust**
- R1. New `MONITOR_TOKEN` scoped only to `/api/activity/*` (separate from HANDOFF_TOKEN); everything Lind acts on (room, planner actions, forget, toggles, notification actions) needs the cookie session. Push actions only deep-link into the app.
- R2. All imported content (screenshots → lines, window titles, vault, Telegram/Hermes logs, connector results, skills) is data: wrapped in delimited blocks in prompts, never followed as instructions. Consequential actions come only from schema-validated model output checked by deterministic code, and "Run it" always needs Lind's tap.
- R3. Scope cut: **no write actions through connectors in v2.** VPS agents get read-only connector/MCP tools; writes are denied outright (deny rules beat allow, so no per-turn override). Agents draft (email text, Notion page) and Lind sends. Approval broker deferred to v3.

**Room**
- R4. Debaters run in a disposable worktree at a pinned base commit, one per participant, with no push credentials, `--strict-mcp-config` with no servers, no connectors, no hooks; Claude in `--permission-mode plan`; Codex `-s read-only` where the sandbox works, else relying on the disposable tree. Worktrees deleted after the room. Writes are harmless by construction.
- R5. Structured turns: each debater ends with a fenced JSON {position, confidence 0–1, agrees_with[], weakest_claims[{agent, claim, why}], evidence[{kind: file|command|fact, ref}]}; invalid JSON → one repair retry → else marked "no structured answer". The judge returns schema-validated JSON {agreement 0–100, open_disagreements[], per_agent[{stance, changed, why}], unverified_claims[]}.
- R6. Outcomes: consensus | split | incomplete (agent timeout/missing) | no-verdict (judge failed). The verdict is labelled a recommendation; unverified claims are shown. We display rationales, evidence and dissent, not hidden chain-of-thought.
- R7. Limits per room: ≤ 4 agents, ≤ 3 rounds, 10 min per agent turn, judge max tokens; Claude off by default. The cost estimate shows "unknown" when there is no usage data. The real provider/model of each agent is shown, with a warning when two agents share a model.
- R8. Room lifecycle reuses the runner's job machinery (killTree, timeouts); a runner restart marks the open round incomplete and keeps prior rounds.

**Activity monitor**
- R9. Capture only the foreground window's rectangle (not the desktop or other monitors). Re-read the foreground handle right after capture and drop the frame if it changed. Fail closed when lock/idle state is unknown.
- R10. Capture lease: the monitor fetches a lease from the VPS every 5 min (paused or night → no lease). No valid lease → no capture. A local pause flag also wins. No queue: frames are sent immediately or dropped.
- R11. Wording: images are "not persisted by us"; the vision provider's handling follows NVIDIA/Groq terms (accepted by Lind). Frames are sent over HTTPS, held in memory only, and never logged.
- R12. Activity records keep sampling coverage and unknown gaps; durations are labelled estimates ("looked like ~2 h"). Activity never counts as goal progress automatically.

**Goals & planner**
- R13. Goal progress = the explicit metric (manual or a defined data source, e.g. GitHub merged PRs for a project) with units and a baseline. Activity/effort is shown separately as indicators, never summed into progress. Evidence is deduplicated by stable ids.
- R14. The runner is the sole writer of goals/plans/activity/notifications (web → inbox commands, same pattern as jobs). Files carry `schemaVersion`; NDJSON readers skip a truncated last line; vault mirrors are rebuildable from DATA_DIR (canonical).
- R15. Scheduler: persisted job keys (`planner:YYYY-MM-DD`, `checkin:…`) with run state in data; one runner process. A missed 07:00 catches up until 11:00, then skips with an Inbox note. Europe/Belgrade wall clock with DST-safe "once per date" keys.
- R16. Calendar writes are idempotent: client-chosen event ids (base32hex hash of date+block). Before each change, store the intended op in a journal; reconcile on restart. A block Lind moved or edited (its `updated` ≠ ours) is pinned and never touched again. Busy time comes from freebusy across his calendars with recurring and all-day events expanded. If any input fetch fails, auto-apply is withheld and the push says why.
- R17. TickTick: per-task ownership. Before changing a task's start/due, store its previous values; "Clear" restores only if the task wasn't edited since. Planner-created tasks are tagged `#os-plan`. Write support is gated on a live write/read-back test (time, all-day, recurring, subtasks); until it passes, the planner only reads TickTick.
- R18. Feasibility: durations come from the TickTick estimate, else 45 min; working hours come from Settings (learned suggestions from activity); 10 min buffers; work that doesn't fit is listed as "unscheduled", never squeezed in; deterministic overlap validation runs before any write.

**Memory**
- R19. A source toggle off = stop collecting + exclude from search/agents; history is kept until "Delete this source's data" (explicit, confirmed).
- R20. "Forget" deletes the generated page/index entry and writes a content-free tombstone (source id) that the brain and the collectors check, so the item is never re-ingested. Raw PC transcripts are untouched (they're Lind's files).

**Skills & tools sync**
- R21. Skill sync: relative paths only (no `..`, no symlinks), text files ≤ 256 KB, files with redactor hits skipped, a denylist (Windows/Chrome/PC-path skills), written to a new version dir and swapped atomically between turns.

**Ops**
- R22. Notifications: the in-app notification center (Inbox) is the source of truth, with dedupe, expiry and priority; push is a pointer with generic lock-screen text for anything personal; dead subscriptions are pruned on 404/410; a cap of ~6/day with priorities (07:00 plan and evening review always go).
- R23. Free-model integrations: a capability test gates each one (vision, Nemotron, Kokoro), plus a circuit breaker (open after 3 failures for 30 min) and degradation (title-only activity, Groq fallback, browser TTS). No paid fallback.
- R24. VPS admission: Kokoro single-flight with ≤ 600 chars of input; the room respects one turn per agent at a time; a disk/RAM check before starting a room (refuse below 2 GB free).
- R25. Health: scheduler heartbeat, queue ages, last runs and failures on the Brain/System strip, with a failure → Inbox item. A daily backup of DATA_DIR (minus hand-off transcripts and worktrees) to /var/backups/agent-dashboard, 7-day retention, root-only.
- R26. Acceptance tests per stage, beyond build + screenshots: planner idempotency (crash after Google insert → no duplicate), pinned manual edits, TickTick restore, tombstone prevents re-ingest, truncated NDJSON recovery, runner restart mid-room, lease expiry stops capture, malformed debater JSON.

## Rev 2 rules (after Codex round 2 — override Rev 1 where they differ)
- R27 (confinement, replaces R4's fallback). A debater uses tools only if its harness passes a write-attempt test on the pinned CLI version (try to write outside the worktree, to DATA_DIR, and to its own config → all must fail). Otherwise it participates **tool-free**: the runner gathers the evidence pack itself (git ls-files, files matching the task's keywords, README/CLAUDE.md, recent git log, capped at 150 KB) and passes it inline. Expected today: Claude in plan mode = tools (if the test passes); Codex (no bwrap on the VPS), OpenCode and Hermes = tool-free. Fail closed.
- R28 (output authorization). Deterministic allowlists independent of model output: the planner writes only to the dedicated OS calendar (R30) with fields summary/start/end/description/colorId/extendedProperties and **never attendees**; TickTick writes only to `#os-plan` tasks plus start/due on tasks the planner selected that day; connector tools are allowed only by read-verb name patterns (search/get/list/read/fetch/query), and any unknown tool is denied.
- R29 (web auth). Cookie mutations require same-origin (proxy checks Origin/Sec-Fetch-Site against the host) and a SameSite=Lax session cookie. Monitor token: exact routes/methods only, body ≤ 2 MB, ≤ 20 frames/h and ≤ 120 title batches/h, revoked by changing the env value.
- R30 (planner calendar). OS blocks live on a **dedicated "Agentic OS" Google calendar** created once. Busy time = events.list (singleEvents=true) over Lind's other calendars, plus pinned/current OS blocks. Modifies/deletes use `If-Match` with the stored ETag; a 412 → pin, never retry over it. Needs the `calendar.app.created` scope → Lind re-authorises Google once (google-auth.mjs adds the scope). If any calendar read errors, auto-apply is withheld.
- R31 (journal). Both providers' operations are journaled with stable block ids (calendar event id = hash; a TickTick task carries `#os-plan` + `[os:<blockId>]` in its content, and reconciliation searches for it before creating). A partial apply shows in the Today page with Retry/Undo.
- R32 (TickTick baseline). The original start/due is kept from the first change for the whole day (never overwritten by replans). Restore is an explicit reviewed action ("Restore 3 task times?" with the list), because TickTick has no conditional writes.
- R33 (window capture). Capture with `PrintWindow(hwnd, PW_RENDERFULLCONTENT)` of the foreground window only (renders that window's own pixels, not what overlaps it); a failed or blank render → drop. No desktop cropping.
- R34 (pause). The server rejects frames while paused, before any provider call. The UI shows "Pausing — the PC stops within 5 min" until the monitor's next lease fetch acknowledges. The bounded delay is documented.
- R35 (runner exclusivity and mutations). The runner takes an O_EXCL pid lock in DATA_DIR at start (stale if the pid is dead); a second runner exits. Goals/plans/memories/notifications mutate through one serialized async queue with acked command ids. Migrations are forward-only, and a backup is taken before migrating.
- R36 (memory records). Canonical memories, check-ins and captures are individual records (`data/memories/<id>.json` with source, ancestry[] and text); monthly vault pages are regenerated from them. "Forget" deletes the record, writes a tombstone, regenerates the page, and removes brain lines/pages whose ancestry includes it (working-style lines link their source page). Free-text syntheses (weekly Luna) may keep a trace until the next weekly rewrite — accepted and documented. Source-off filters by source_kind in search and in what agents read; tombstones are reapplied after a restore.
- R37 (room admission). One room at a time globally, ≤ 5 rooms/day, per-turn stored output ≤ 200 KB (the rest truncated in the log), logs kept 30 days.
- R38 (backup). The runner writes daily backups to `/var/lib/agent-dashboard-backups` (agent-owned, 700), 7 days. Local-only recovery is accepted; the vault itself has an off-box copy via Syncthing on the PC. A restore drill is part of stage 3's acceptance.
- R39 (ordering). Stage 1 also ships the safety base: R29 origin checks, R35 runner lock + serialized mutations, the notification center. Stage 3 ships R36 memory records, tombstones, source-off for activity/check-ins and Forget **before** the monitor is enabled. Room (stage 2) ships R27 confinement tests before any tool-using debater.
- Isolation (contested rejection, kept): Codex is right that stripped env ≠ containment. Accepted residual risk: agents run as `agent`, which can read DATA_DIR. Mitigations: debaters are tool-free unless confinement is proven (R27); secrets stay in root-only /etc/agent-dashboard.env; Lind is the only user and the agents act for him. Revisit if any agent ever processes untrusted third-party tasks.

## Rev 3 rules (after Codex round 3 — final)
- R40 (replaces R28's name patterns). Connector/MCP tools are allowed by **exact reviewed identity** (server + tool name, with argument constraints where needed), listed in a checked-in allowlist at stage 5; newly discovered tools are denied whatever their name; read-scoped credentials where the provider offers them.
- R41 (crash safety). Every canonical write is tmp + fsync + rename. The journal entry is fsynced **before** any external call. A tombstone is written **before** anything is deleted. Multi-file operations are recorded as a journal entry and replayed or rolled forward at runner start.
- R42 (transitive filtering). Retrieval (search, agent context, planner inputs) checks each item's ancestry against tombstones and disabled sources, and excludes derivatives until they're regenerated.
- R43 (budgets before execution). One shared budget per room covers debater calls, repair retries and judge calls: Claude `--max-turns` capped; per-call output-token limits where the CLI/API supports them (judge and Nemotron always); a tool-call cap where the harness supports it; wall-clock deadlines everywhere. The room aborts as "incomplete" when the budget runs out. Daily caps per free provider (Nemotron/vision/Groq calls) are shared across brain, planner, check-ins and rooms.
- R44 (evidence pack). Built only by fixed runner operations: tracked regular files inside the checkout (symlinks and paths resolving outside are rejected); secret-looking paths skipped (the shared `secretPath()`); content passed through the redactor before any provider sees it.

**Rejected (logged)**
- Per-job OS-level sandboxing / separate users for agents (finding 2): a single-user box; already rejected in the phone-continuity plan; the agent env already strips dashboard secrets.
- An allowlist-only skill sync (finding 8): Lind chose to sync almost all skills (Q6); a denylist plus validation instead.
- Encrypted backups (32): a single root-owned box; root-only permissions are enough here.
- Source-specific downstream disclosure policies (6): Lind accepted that dashboard chats (which may contain connector-read data) feed the brain; connector data isn't separately persisted.
