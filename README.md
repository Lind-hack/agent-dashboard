# agent-dashboard

Personal control panel for coding agents: dictate a task on the phone → Linear issue →
Claude Code (on the VPS) or Codex (in the cloud) does it → PR. Also shows what's scheduled on
the VPS.

```
phone /voice ──Groq Whisper──▶ gpt-oss drafts the ticket ──▶ Linear issue
                                                           │  labels agent:claude|codex, repo:<key>
              agent:codex ─ delegated to "Codex for Linear" (runs in Codex cloud, nothing here)
              agent:claude ─ runner polls Linear every 30s ─▶ worktree ─▶ claude -p ─▶ push ─▶ PR
                                                                    ▲
              reply from the dashboard or a Linear comment "@claude …" ─┘ (claude -p --resume)
```

## Pieces

| Path | What |
|---|---|
| `app/` | Next.js 16 UI: overview (`/`), voice capture (`/voice`, installable PWA), job log + reply (`/jobs/[id]`) |
| `runner/` | Long-running worker. The only writer of `data/jobs/*.json`; the web app talks to it through `data/inbox/` |
| `lib/linear.ts` | Linear GraphQL (personal API key) |
| `lib/groq.ts` | Whisper transcription + ticket drafting (free tier) |
| `lib/ops.ts` | `systemctl list-timers` / failed units, read-only |
| `deploy/` | `setup.sh` (once), `update.sh` (every deploy) |

## Linear conventions

- `agent:claude` / `agent:codex` — who does it. Created automatically on first use.
- `repo:383` / `repo:agent-dashboard` — where. Add a repo in `lib/config.ts` (`REPOS`).
- Any issue gets picked up when it carries `agent:claude` — dictated or made by hand in Linear.
- The runner moves the issue to the team's first "started" state; you close it yourself after
  merging. Closing or cancelling the issue removes its worktree.
- The runner's own comments start with 🤖 and are ignored. A comment starting `@claude` continues
  the session.

## VPS

- Runs as the unprivileged `agent` user (no sudo). Claude uses `--permission-mode bypassPermissions`
  inside its worktree, so this user deliberately has no access to anything else on the box.
- Secrets live in `/etc/agent-dashboard.env` (root, 600) and reach the services via systemd.
  Claude's child process gets them stripped from its env, but it runs as the same user, so keep
  `GITHUB_TOKEN` a **fine-grained token limited to the agent repos** (Contents + Pull requests: write).
- Claude Code authenticates with Lind's own subscription: `sudo -iu agent claude`, then `/login`.
- Web listens on `127.0.0.1:3100`; it's public only through the Cloudflare tunnel hostname.

```bash
bash deploy/setup.sh     # once
bash deploy/update.sh    # pull main, build, restart both services
journalctl -u agent-dashboard-runner -f
```

## Not here on purpose

- No Claude/Codex login inside the dashboard. Anthropic's terms don't allow third-party apps to use
  subscription OAuth. The dashboard drives the official `claude` CLI on our own server and links out
  to claude.ai/code and chatgpt.com/codex for everything else.
- Chats started on the PC stay on the PC: continue those with Claude Code Remote Control.
