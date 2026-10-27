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
# Do not silently truncate selected skills or attachments.
PROMPT=$(cat)
# Hermes runs inside Docker, so host upload paths need a copy into its own filesystem.
# Read as the unprivileged dashboard user; never give this root helper arbitrary host-file access.
UPLOAD_DIR=$(sed -n 's/^DATA_DIR=//p' /etc/agent-dashboard.env | tail -1)
UPLOAD_DIR="${UPLOAD_DIR:-/var/lib/agent-dashboard}/attachments"
while IFS= read -r HOST_FILE; do
  FILE_ID=${HOST_FILE##*/}
  [[ "$FILE_ID" =~ ^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$ ]] || continue
  [ "$HOST_FILE" = "$UPLOAD_DIR/$FILE_ID" ] || continue
  CONTAINER_FILE="/tmp/agent-dashboard-attachments/$FILE_ID"
  # The only shell interpolation below is a validated UUID in a fixed container directory.
  runuser -u agent -- cat -- "$HOST_FILE" | docker exec -i --user hermes hermes sh -c "mkdir -p /tmp/agent-dashboard-attachments && cat > '$CONTAINER_FILE'"
  PROMPT=${PROMPT//"$HOST_FILE"/"$CONTAINER_FILE"}
done < <(printf '%s\n' "$PROMPT" | sed -nE 's|^VPS file: (/.*/attachments/[a-f0-9-]{36})$|\1|p')
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
