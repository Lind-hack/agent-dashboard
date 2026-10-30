#!/usr/bin/env bash
# One-time VPS setup. Run as ubuntu: bash deploy/setup.sh
# Creates the unprivileged `agent` user (no sudo — Claude runs with bypassPermissions as this user),
# the env file, and the two systemd services. Safe to re-run.
set -euo pipefail

APP=/opt/agent-dashboard
DATA=/var/lib/agent-dashboard
ENV_FILE=/etc/agent-dashboard.env

id agent >/dev/null 2>&1 || sudo useradd --create-home --shell /bin/bash agent
sudo mkdir -p "$APP" "$DATA"
sudo chown -R agent:agent "$APP" "$DATA"

sudo -u agent git config --global user.name "agent-dashboard"
sudo -u agent git config --global user.email "agent-dashboard@users.noreply.github.com"

if [ ! -f "$ENV_FILE" ]; then
  sudo install -m 600 -o root -g root /dev/null "$ENV_FILE"
  sudo tee "$ENV_FILE" >/dev/null <<EOF
NODE_ENV=production
DATA_DIR=$DATA
WORK_DIR=$DATA/work
LINEAR_API_KEY=
LINEAR_TEAM_KEY=
GROQ_API_KEY=
FIRECRAWL_API_KEY=
SUPADATA_API_KEY=
GITHUB_TOKEN=
AGENT_REPOS=Lind-hack/383lajme,Lind-hack/agent-dashboard,Lind-hack/learning-lab
DASHBOARD_PASSWORD=$(openssl rand -base64 18)
SESSION_SECRET=$(openssl rand -hex 32)
EOF
  echo "Wrote $ENV_FILE — fill in the empty keys (sudo nano $ENV_FILE)."
fi

sudo tee /etc/systemd/system/agent-dashboard-web.service >/dev/null <<EOF
[Unit]
Description=Agent dashboard (Next.js)
After=network-online.target

[Service]
User=agent
WorkingDirectory=$APP
EnvironmentFile=$ENV_FILE
ExecStart=/usr/bin/npm run start
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo tee /etc/systemd/system/agent-dashboard-runner.service >/dev/null <<EOF
[Unit]
Description=Agent dashboard runner (Linear -> Claude Code)
After=network-online.target

[Service]
User=agent
WorkingDirectory=$APP
EnvironmentFile=$ENV_FILE
ExecStart=/usr/bin/npm run runner
Restart=always
RestartSec=10
# Let a running Claude turn finish its current tool call before the kill.
KillMode=mixed
TimeoutStopSec=30

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
echo "Next: deploy/update.sh, then log Claude in once: sudo -iu agent claude  (type /login)"
