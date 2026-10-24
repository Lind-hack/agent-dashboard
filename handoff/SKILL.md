---
name: handoff
description: Hand the current coding session off to the agent dashboard on the VPS, so Claude or Codex keeps working on the same branch while the PC is off. Use when Lind says "hand off", "handoff", "continue this on the VPS", "send this to the dashboard", or invokes /handoff. Not for deploying or merging.
---

# Hand off to the VPS

Pushes the work to a branch and starts a dashboard chat that continues it. The VPS agent gets your
summary plus the code — not this conversation — so the summary has to carry everything it needs.

## Steps

1. **Repo.** `git remote get-url origin` → `owner/name` (e.g. `Lind-hack/383lajme`). If there's no
   GitHub remote, stop and say so.

2. **Branch — never push the default branch.** `git branch --show-current`.
   - If it's `main`/`master`/the default branch, or HEAD is detached: create a new branch from HEAD,
     `git switch -c handoff/<YYYYMMDD-HHMM>-<short-slug>` (uncommitted changes come along).
   - Otherwise keep the current branch.
   383's `main` deploys to production on push — pushing it here would ship unreviewed work.

3. **Commit what's uncommitted.** Run `git status --short` and show Lind the list. Commit it all on
   the hand-off branch: `git add -A && git commit -m "WIP: hand-off to VPS"`. Skip this if clean.
   If `git status` shows files that clearly aren't part of this work (another session's edits,
   secrets, large binaries), ask Lind before committing them.

4. **Push.** `git push -u origin <branch>`.

5. **Write the brief** to a temp file (e.g. `$TMPDIR/handoff-summary.md` or the scratchpad), in this shape:

   ```markdown
   ## Goal
   What Lind wants, in one or two sentences, in his words where possible.

   ## Done so far
   Concrete: files changed, what works, what was verified (commands + results).

   ## Next steps
   Numbered, specific enough to start immediately.

   ## Decisions and constraints
   Choices Lind made in this conversation, things he rejected, project rules that matter here.

   ## How to verify
   The checks to run before calling it done.
   ```

6. **Send it.**
   ```bash
   node ~/.agent-dashboard/handoff.mjs --repo <owner/name> --branch <branch> \
     --title "<short title>" --summary-file <file> --agent <claude|codex>
   ```
   `--agent`: the same AI as this session (Claude Code → `claude`, Codex → `codex`) unless Lind asked
   for the other one. The script prints the chat URL.

7. **Tell Lind:** the URL, the branch name, and that the PC checkout is now on that branch — he
   shouldn't keep editing it locally while the VPS works, or the branches will diverge.

If the script says the token can't access the repo, the repo isn't on the dashboard's GitHub token:
Lind adds it at github.com/settings/personal-access-tokens.
