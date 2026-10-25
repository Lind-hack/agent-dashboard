---
name: takeback
description: Bring a chat that was handed off to the agent dashboard on the VPS back to this PC — the VPS's code changes, the conversation as it is now, and any memory notes it changed — so it continues with `claude --resume`. Use when Lind says "take back", "takeback", "bring it back", "continue on the PC", or invokes /takeback. Run it from a NEW chat, never from the chat being taken back.
---

# Take a hand-off back from the VPS

## Steps

1. **List what's on the VPS:**
   ```bash
   node ~/.agent-dashboard/takeback.mjs --list
   ```
   If there's more than one and Lind didn't say which, show him the list and ask.

2. **Confirm the PC chat is closed — every time.** Ask Lind: "Is the PC copy of that chat closed
   (no terminal or desktop-app window has it open)?" Its file gets replaced, so an open copy would
   overwrite it again. If this very chat *is* that session id, stop: he has to run /takeback from a
   different chat.

3. **Run it** once he confirms:
   ```bash
   node ~/.agent-dashboard/takeback.mjs --session <id> --pc-chat-closed
   ```
   It asks the VPS to stop the chat (waiting for a running turn), pushes the VPS branch, downloads and
   verifies everything, then: switches the original checkout to the `pc/...` branch if it's exactly as
   handed off (otherwise it makes a separate `<repo>-takeback-<id>` worktree and leaves his checkout alone),
   installs the chat (backing up the old PC copy if it changed), and merges memory notes (conflicts are
   written as `<name>.vps.md`).
   - "changed in the last 2 minutes" → the chat is probably still open; ask, then `--force` only if he says so.
   - Any other stop: show Lind the message. Nothing is half-installed — re-running is safe.

4. **Tell Lind** the `cd … && claude --resume <id>` line it printed, where the code is (branch / worktree),
   any memory conflicts, and that the VPS copy is now closed.

## Notes
- Summary hand-offs bring back code + memory only; the VPS chat stays readable on the dashboard.
- From the phone, "Bring back to PC" on the chat does step 3's VPS half early; /takeback finishes it.
