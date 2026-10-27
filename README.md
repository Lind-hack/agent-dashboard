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
