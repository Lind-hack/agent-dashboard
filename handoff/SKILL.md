---
name: handoff
description: Hand the current Claude Code or Codex chat off to the agent dashboard on the VPS so Lind can continue it from his phone — the full conversation, his uncommitted code, memory notes, rules and a project-wide dossier go with it. Use when Lind says "hand off", "handoff", "continue this on the VPS/phone", "send this to the dashboard", or invokes /handoff. Not for deploying or merging.
---

# Hand off to the VPS (v2)

The VPS continues **this exact chat** (native hand-off) or, when that isn't possible, a new session
briefed from it (summary hand-off). Along with it go Lind's uncommitted code (as a snapshot — his
checkout is not touched), all memory notes, CLAUDE.md files and rules, the skills this chat used,
and related chats about the same project. The VPS writes a project dossier from all of it.

## Steps

1. **Find this chat's id.** Run:
   ```bash
   node ~/.agent-dashboard/handoff.mjs --detect
   ```
   It lists recent chats in this repo with their last messages. This chat is the one whose last
   messages match what Lind just said (it's usually first, and `invokedHandoff` is true when the
   latest message is the /handoff request). If it's ambiguous, show Lind the candidates and ask.

2. **Dry run**, and show Lind the summary lines (chat, code snapshot, context, mode):
   ```bash
   node ~/.agent-dashboard/handoff.mjs --session <id> --dry-run
   ```
   - If it stops on **possible secrets in the code**, show Lind the list. Only re-run with
     `--allow-secrets` if he confirms they're false alarms; otherwise help him remove them first.
   - `--no-code` hands off the conversation only (no snapshot).

3. **Send it:**
   ```bash
   node ~/.agent-dashboard/handoff.mjs --session <id>
   ```
   Add `--title "<short title>"` if the auto title (first message) is unhelpful.

4. **Tell Lind:** the chat URL it prints, that the VPS continues on its own `pc/...` branch while his
   checkout stays as it was, that the Context tab on the phone shows what was sent (the dossier takes
   a few minutes), and that he shouldn't keep using this chat on the PC — `/takeback` brings it home.
   Then stop working in this chat.

## Notes
- Native hand-off needs the chat's Claude version to match the VPS (2.1.310); otherwise it falls back
  to a summary hand-off and says so. Codex chats are summary hand-offs until the Codex test passes.
- Repos must be on the dashboard's write token (AGENT_REPOS). Other repos go conversation-only.
- One hand-off per chat at a time: archive the VPS chat (or take it back) before handing off again.
