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
the brief live in `lib/config.ts` (`REPO_NOTES`). Agents never push the default branch; every change
lands as a PR.

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
