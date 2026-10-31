#!/usr/bin/env bash
# One-time: install the read-only DB health timer for the Website page. Run as ubuntu:
#   bash /opt/agent-dashboard/deploy/install-db-stats.sh
set -euo pipefail
sudo install -m 644 /opt/agent-dashboard/deploy/agent-dashboard-db-stats.service /etc/systemd/system/
sudo install -m 644 /opt/agent-dashboard/deploy/agent-dashboard-db-stats.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now agent-dashboard-db-stats.timer
sudo systemctl start agent-dashboard-db-stats.service
ls -la /var/lib/agent-dashboard-db/db.json && echo "DB stats installed."
