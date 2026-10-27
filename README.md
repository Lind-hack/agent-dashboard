# agent-dashboard

Personal control panel for coding agents. From the phone: pick an AI (Claude, Codex, or Codex
cloud) and a repo, talk or type, and keep chatting with it while it works → PR. Also shows what's
scheduled on the VPS.

```
/voice (New chat) ── Whisper ──┬─ plain chat ─────────────────────────┐
                               └─ "Track in Linear" ─▶ Linear issue ──┤ labels agent:<a>, repo:<name>
                                                                      ▼
  Claude / Codex: runner on the VPS ─▶ worktree ─▶ claude -p | codex exec ─▶ push ─▶ PR
                  replies: dashboard, or a Linear comment "@claude …" / "@codex …" (--resume)
  Codex cloud:    Linear issue + @Codex mention ─▶ Codex for Linear (OpenAI's cloud)
                  replies: /codex/[id] posts the mention for you, reads Codex's agent activities
  PC hand-off:    /handoff skill ─▶ pushes a branch ─▶ POST /api/handoff ─▶ VPS chat on that branch
```

## Pieces

| Path | What |
|---|---|
| `app/` | Next.js 16 UI: overview (`/`), new chat (`/voice`, installable PWA), VPS chat (`/jobs/[id]`), Codex cloud chat (`/codex/[id]`) |
| `runner/` | Long-running worker, one turn per agent at a time. The only writer of `data/jobs/*.json`; the web app talks to it through `data/inbox/` |
| `lib/linear.ts` | Linear GraphQL (personal API key), incl. the Codex mention/activity bridge |
| `lib/github.ts` | Repo picker = whatever the GitHub token can access |
| `lib/groq.ts` | Whisper transcription + ticket drafting (free tier, model fallback ladder) |
| `lib/ops.ts` | `systemctl list-timers` / failed units, read-only |
| `handoff/` | `/handoff` skill + `handoff.mjs`, installed on the PC (see below) |
| `deploy/` | `setup.sh` (once), `update.sh` (every deploy) |

## Repos

The picker lists the repos in `AGENT_REPOS` (env file, comma-separated `owner/name`). To let agents
work on another repo, add it there **and** grant it on the fine-grained `GITHUB_TOKEN` (Contents +
Pull requests: write) — the token can read every public repo, so visibility alone proves nothing. Repo-specific rules for
the brief live in `lib/config.ts` (`REPO_NOTES`).

The Learning dashboard is [`Lind-hack/learning-lab`](https://github.com/Lind-hack/learning-lab).
It is explicitly included by the picker alongside the existing env allowlist, still filtered by
GitHub token access. Setup includes it alongside `383lajme` and `agent-dashboard`. The next `deploy/update.sh` run
adds it to an existing `AGENT_REPOS` list, preserving other entries (an unset or empty list
starts with those three repos). Before deploying, grant `learning-lab` on the dashboard's
fine-grained GitHub token with **Contents: write** and **Pull requests: write**. This grant
must be made in GitHub's token settings; the deployment cannot grant itself access.

## Delivery preference

Lind's standing instruction (2026-10-27): feature requests include checking the change, committing,
pushing, merging the verified change when needed, deploying through the repository's documented
production workflow, and verifying the live result. Agents should finish this without asking for
a second push/deploy request. The runner injects this preference into every new coding task.
Task-specific instructions take precedence. Preserve unrelated changes and running jobs; report
concrete delivery blockers such as missing permissions or failing checks instead of claiming success.

## Linear conventions

- `agent:claude` / `agent:codex` → runs on the VPS. `agent:codex-cloud` → Codex for Linear.
- `repo:<name>` (e.g. `repo:383lajme`) → where. Old `repo:383` / `repo:agent-dashboard` still work.
- The runner moves the issue to the first "started" state; closing the issue removes its worktree.
  Plain chats are closed with **Archive** on the chat page.
- The runner's own comments start with 🤖 and are ignored.

## VPS

- Both services run as the unprivileged `agent` user (no sudo); Claude (`bypassPermissions`) and
  Codex (`--dangerously-bypass-approvals-and-sandbox`) get full access only inside that account.
- Secrets live in `/etc/agent-dashboard.env` (root, 600). Agents get them stripped from their env,
  but run as the same user, so keep `GITHUB_TOKEN` limited to the agent repos.
- Logins (Lind's own subscriptions, official CLIs): `sudo -iu agent claude` → `/login`;
  `sudo -iu agent ~/.local/bin/codex login --device-auth`.
- Codex on the VPS and Codex cloud draw from the same ChatGPT plan limits as anything else on that
  account (incl. the 383 news pipeline's Codex auth).
- Web listens on `127.0.0.1:3100`, public only via the Cloudflare tunnel (`agents.383ks.com`).

```bash
bash deploy/setup.sh     # once
bash deploy/update.sh    # pull main, build, restart both services
journalctl -u agent-dashboard-runner -f
```

## PC hand-off

`handoff/SKILL.md` is installed to `~/.claude/skills/handoff/` and `~/.codex/skills/handoff/`,
`handoff.mjs` to `~/.agent-dashboard/`, next to `handoff.env` (`HANDOFF_TOKEN` from the VPS env file,
`AGENT_DASHBOARD_URL`). In a session: `/handoff` (Claude Code) or `$handoff` (Codex).

## Not here on purpose

- No Claude/Codex login inside the web app — the dashboard drives the official CLIs on our own
  server, and Codex cloud through Linear.
- Chats that live only on the PC can't be joined; hand them off, or use Claude Code Remote Control.

## Automatic chat memory

In **Settings → Memory**, turn on **Automatically capture chat memory**. It defaults to off and
includes existing accessible history when enabled. Turning it off stops new chat uploads and pauses
queued chat summaries and the weekly synthesis; existing vault pages are kept. A summary request
already sent to the model cannot be recalled. Graph reports and the nightly GitHub feed keep their
existing behavior.

The runner checks every five minutes for chats quiet for at least 20 minutes. The existing PC brain
collector runs every two hours while the PC is on, updates itself from the dashboard, and reads the
same setting before reading chat content. It skips chats if the policy cannot be fetched. Both use
per-chat checkpoints and retry failed work. Summaries live in `wiki/sources/chats/` in the Syncthing
vault and become searchable on `/memory` (the search index refreshes within ten minutes). Each page
keeps its origin and covers discussions, decisions, fixes, annoyances, and **unvalidated proposals**
for businesses or upgrades, including beneficiaries, a possible business model, and a validation
step. Weekly synthesis connects recurring problems and ideas with source links.

Requirements:

- VPS: writable `MEMORY_VAULT_DIR`, `NVIDIA_API_KEY`, running runner, and `BRAIN_ENABLED` other than `0`.
  Redacted chat text is sent to NVIDIA Nemotron for summaries; the existing weekly pass uses Codex.
  Collection errors appear in Memory's brain status.
- PC: existing `handoff/brain-collect.mjs` installation in `~/.agent-dashboard/`, Node 24+, and
  `handoff.env` with `HANDOFF_TOKEN` and `AGENT_DASHBOARD_URL`. On Windows, run
  `node ~/.agent-dashboard/brain-collect.mjs --install` once to register its scheduled task.
  On Linux/macOS, schedule the same script yourself (for example, every two hours with cron).
- Claude and Codex: local JSONL histories in their normal homes. `CLAUDE_CONFIG_DIR` and `CODEX_HOME`
  overrides are respected. The VPS also captures dashboard turns for all four agents, including
  failed turns and handoffs.
- OpenCode: installed CLI on `PATH` (or `OPENCODE_BIN`); uses
  [`session list --format json` and `export`](https://opencode.ai/docs/cli/), across projects.
- Hermes: readable default profile's [`state.db`](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/developer-guide/session-storage.md)
  and Python 3 with sqlite3 (`MEMORY_PYTHON_BIN` overrides the executable). `HERMES_HOME` or
  `MEMORY_HERMES_DB` selects a different profile/store. Run a collector in each account/container
  with its own history, or explicitly expose a readable store; the runner does not gain privileges
  to read another account's files.
- Cloud: connected Codex for Linear issues are collected through the existing conversation bridge,
  with all issue-list pages visited. That bridge currently reads up to 50 comments, 10 agent sessions,
  and 40 activities per session. Chats available only in Claude.ai, ChatGPT, or another cloud account
  are not readable through the dashboard's credentials; they need a local transcript/export or an
  additional service integration. There is no browser scraping or implicit access to those accounts.

Collector text is condensed and secret patterns are redacted before upload and again on ingestion.
Redaction is best-effort, not a guarantee that every sensitive phrase is detected. To inspect the
PC run, use `node ~/.agent-dashboard/brain-collect.mjs --dry-run` or `--status`.

Feature checks: `node --import tsx --test tests/*.test.ts` and
`node --import tsx handoff/test-redact.mjs`, plus `npm run typecheck` and `npm run build`.

## Files and daily memory

- **Add files, images or videos** in New chat, Solo/Team/Roast, or any chat reply. Uploads are
  private, streamed to `DATA_DIR/attachments`, and survive reloads and queued turns. Images have
  previews; audio/video have playback controls with seeking; other formats download. VPS agents
  receive the actual local file path and can inspect it with their available tools. Hermes uses
  the Docker bridge: re-run `deploy/hermes-bridge.sh` once after upgrading to copy uploads into
  its container and remove the old silent 20,000-character prompt cutoff. PDFs, archives
  and other binary formats are preserved, not automatically converted or indexed.
- The default upload limit is **100 MiB per file**, configurable with `ATTACHMENT_MAX_BYTES` (rebuild after changing it so the Next.js proxy cap matches).
  This is a storage/request safeguard, not a skill limit. Cloudflare or another proxy may enforce
  its own request limit. Files are retained; include `DATA_DIR/attachments` in VPS backups.
- Cloud Codex gets private dashboard references, but cannot authenticate to open them. Use a VPS
  chat for file analysis. Roast debaters run without file tools: describe media in the task;
  attachments carry through to the VPS agent when you choose **Run it**.
- **Memory → What did you learn today?** automatically saves after a 1.5-second pause. Dictation
  transcribes into the same note and saves automatically. Wait for **Saved**, then **New memory**
  to start another note. A local draft survives refreshes and failed saves have a retry button.
  `/remember …` and the notebook button in New chat also save to the vault.
- Captures write directly into `MEMORY_VAULT_DIR/100 - Me/memory/inbox`; attached originals are
  copied into its `attachments/` folder and linked/embedded in Markdown, so the existing Syncthing
  setup brings notes and media into Obsidian together. Plain-text/code attachments up to 1 MiB
  contribute up to 20,000 characters to search. Describe images/videos to make them searchable;
  automatic OCR or video transcription is not performed. Voice capture uses the existing Groq
  transcription service. No additional external integration is needed.
- Each VPS turn retrieves relevant fresh local notes as context. Memory questions search the same
  vault immediately after capture. Existing Obsidian/Syncthing configuration and write permissions
  are required; re-run `deploy/vault-access.sh` if the memory inbox is not writable. The UI reports
  save failures instead of claiming success.
- VPS skill selection has **no dashboard count cap**. Only installed skills are accepted and
  duplicates are removed. Provider context windows, CLI request sizes and account quotas still apply.

Verification: `npm test`, `npm run typecheck`, `npm run build`. No lint script is configured.
