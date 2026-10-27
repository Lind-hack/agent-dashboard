#!/usr/bin/env bash
# Pull main, build, restart. Run as ubuntu: bash /opt/agent-dashboard/deploy/update.sh
set -euo pipefail

APP=/opt/agent-dashboard
REPO=https://github.com/Lind-hack/agent-dashboard.git
TOKEN=$(sudo grep -E '^GITHUB_TOKEN=' /etc/agent-dashboard.env | cut -d= -f2-)
AUTH=(-c "http.https://github.com/.extraheader=Authorization: Basic $(printf 'x-access-token:%s' "$TOKEN" | base64 -w0)")

if [ ! -d "$APP/.git" ]; then
  sudo -u agent git "${AUTH[@]}" clone "$REPO" "$APP"
else
  sudo -u agent git -C "$APP" "${AUTH[@]}" fetch origin main
  sudo -u agent git -C "$APP" reset --hard origin/main
fi

cd "$APP"
sudo -u agent npm ci --no-audit --no-fund
sudo -u agent npm run build
sudo node deploy/add-learning-repo.mjs /etc/agent-dashboard.env
sudo systemctl enable agent-dashboard-web agent-dashboard-runner >/dev/null
sudo systemctl restart agent-dashboard-web agent-dashboard-runner
echo "Live at $(sudo -u agent git -C "$APP" rev-parse --short HEAD)"
