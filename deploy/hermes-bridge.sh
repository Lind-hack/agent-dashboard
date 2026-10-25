#!/usr/bin/env bash
# One-time, run by Lind as ubuntu: bash deploy/hermes-bridge.sh
# Lets the dashboard talk to Hermes. Installs ONE fixed helper, /usr/local/bin/ask-hermes, and a sudoers
# rule allowing the `agent` user to run exactly that helper — nothing else. The helper always runs
# Hermes as the hermes user (uid 10000), never root (a root call once broke the shared Codex auth.json).
set -euo pipefail

sudo tee /usr/local/bin/ask-hermes >/dev/null <<'EOF'
#!/bin/bash
# agent-dashboard -> Hermes bridge. Question on stdin; optional $1 = Hermes session id to resume.
set -euo pipefail
PROMPT=$(head -c 20000)
[ -n "$PROMPT" ] || { echo "empty prompt" >&2; exit 2; }
ARGS=(chat -Q --source tool -q "$PROMPT")
if [ -n "${1:-}" ]; then
  [[ "$1" =~ ^[0-9]{8}_[0-9]{6}_[a-f0-9]{6}$ ]] || { echo "bad session id" >&2; exit 2; }
  ARGS+=(--resume "$1")
fi
exec timeout 1800 docker exec --user hermes --env HOME=/opt/data/home --env HERMES_HOME=/opt/data \
  hermes /opt/hermes/.venv/bin/hermes "${ARGS[@]}"
EOF
sudo chown root:root /usr/local/bin/ask-hermes
sudo chmod 755 /usr/local/bin/ask-hermes

echo 'agent ALL=(root) NOPASSWD: /usr/local/bin/ask-hermes, /usr/local/bin/ask-hermes *' | sudo tee /etc/sudoers.d/agent-dashboard-hermes >/dev/null
sudo chmod 440 /etc/sudoers.d/agent-dashboard-hermes
sudo visudo -cf /etc/sudoers.d/agent-dashboard-hermes

echo "Testing…"
echo "Reply with exactly: bridge ok" | sudo -u agent sudo -n /usr/local/bin/ask-hermes | tail -3
