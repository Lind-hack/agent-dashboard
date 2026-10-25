#!/usr/bin/env bash
# One-time, run by Lind as ubuntu: bash deploy/hermes-bridge.sh
# Lets the dashboard talk to Hermes. Installs ONE fixed helper, /usr/local/bin/ask-hermes, and a sudoers
# rule allowing the `agent` user to run exactly that helper — nothing else. The helper always runs
# Hermes as the hermes user (uid 10000), never root (a root call once broke the shared Codex auth.json).
# Dashboard chats use the free provider/model in /etc/agent-dashboard-hermes.conf; Hermes' own default
# (ChatGPT, used by the news pipeline) is untouched. Re-running this keeps an existing conf.
set -euo pipefail

if [ ! -f /etc/agent-dashboard-hermes.conf ]; then
  sudo tee /etc/agent-dashboard-hermes.conf >/dev/null <<'CONF'
# Provider + model Hermes uses for dashboard chats. Free options:
#   openrouter  nvidia/nemotron-3-ultra-550b-a55b:free   (OPENROUTER_API_KEY in ~/.hermes/.env; 50 free requests/day)
#   nvidia      nvidia/nemotron-3-ultra-550b-a55b        (NVIDIA_API_KEY from build.nvidia.com in ~/.hermes/.env; no daily cap)
# Leave both empty to use Hermes' default model.
HERMES_PROVIDER=openrouter
HERMES_MODEL=nvidia/nemotron-3-ultra-550b-a55b:free
CONF
fi

sudo tee /usr/local/bin/ask-hermes >/dev/null <<'EOF'
#!/bin/bash
# agent-dashboard -> Hermes bridge. Question on stdin; optional $1 = Hermes session id to resume.
set -euo pipefail
PROMPT=$(head -c 20000)
[ -n "$PROMPT" ] || { echo "empty prompt" >&2; exit 2; }
ARGS=(chat -Q --source tool -q "$PROMPT")
HERMES_PROVIDER=$(sed -n 's/^HERMES_PROVIDER=//p' /etc/agent-dashboard-hermes.conf 2>/dev/null | tail -1)
HERMES_MODEL=$(sed -n 's/^HERMES_MODEL=//p' /etc/agent-dashboard-hermes.conf 2>/dev/null | tail -1)
if [[ "$HERMES_PROVIDER" =~ ^[a-z0-9-]+$ ]]; then ARGS+=(--provider "$HERMES_PROVIDER"); fi
if [[ "$HERMES_MODEL" =~ ^[A-Za-z0-9._:/-]+$ ]]; then ARGS+=(-m "$HERMES_MODEL"); fi
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
