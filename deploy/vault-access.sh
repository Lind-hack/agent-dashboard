#!/usr/bin/env bash
# One-time, run by Lind as ubuntu: bash /opt/agent-dashboard/deploy/vault-access.sh
# Lets the dashboard (user `agent`) read the Obsidian vault for Memory and the Today page, and write
# into "100 - Me" (goals, plans, memories, journal) and the brain's wiki pages. Safe to re-run.
# ~/.hermes is kept private (mode 700 — Hermes resets it), so instead of opening a path through it the
# vault is bind-mounted at /var/lib/agent-dashboard/vault by a systemd mount unit (survives reboots).
# The vault itself is already world-readable; plans/ gets an ACL so agent can write there.
set -euo pipefail

VAULT=/home/ubuntu/.hermes/syncthing-sync/lind-brain
MNT=/var/lib/agent-dashboard/vault
PLANS="$VAULT/100 - Me/plans"
UNIT=$(systemd-escape -p --suffix=mount "$MNT")

command -v setfacl >/dev/null || sudo apt-get install -y acl
sudo setfacl -x u:agent /home/ubuntu/.hermes 2>/dev/null || true # the earlier pass-through attempt

sudo mkdir -p "$PLANS"
sudo chown --reference="$VAULT/100 - Me" "$PLANS"
sudo setfacl -m u:agent:rwx -m d:u:agent:rwx -m d:u::rwx "$PLANS"

sudo install -d -o agent -g agent "$MNT"
sudo tee "/etc/systemd/system/$UNIT" >/dev/null <<EOF
[Unit]
Description=Obsidian vault for the agent dashboard (bind mount)

[Mount]
What=$VAULT
Where=$MNT
Type=none
Options=bind

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now "$UNIT"

# The brain (runner/brain.ts) writes wiki pages and appends to log.md / index.md. Default ACLs keep
# that working for files Syncthing replaces later, and let the vault owner (Syncthing) edit the
# files agent creates.
OWNER=$(sudo stat -c %U "$VAULT")
sudo mkdir -p "$VAULT/wiki/sources/chats" "$VAULT/wiki/sources/commits" "$VAULT/wiki/sources/graphs"
sudo chown -R --reference="$VAULT/wiki" "$VAULT/wiki/sources"
sudo setfacl -R -m u:agent:rwX -m d:u:agent:rwX -m d:u:"$OWNER":rwX "$VAULT/wiki"
sudo setfacl -m u:agent:rw "$VAULT/log.md" "$VAULT/index.md"
sudo setfacl -m d:u:agent:rw "$VAULT"

# "100 - Me" holds Goals.md, plan notes, captured memories and journal entries the dashboard writes
# (v5.1). The dashboard keeps its own copy of everything, so this only decides whether Obsidian
# sees it too.
ME="$VAULT/100 - Me"
sudo setfacl -m u:agent:rwx -m d:u:agent:rwX -m d:u:"$OWNER":rwX "$ME"
sudo find "$ME" -maxdepth 1 -name "*.md" -exec setfacl -m u:agent:rw {} +
sudo mkdir -p "$ME/memory" "$ME/journal"
sudo chown --reference="$ME" "$ME/memory" "$ME/journal"
sudo setfacl -R -m u:agent:rwX -m d:u:agent:rwX -m d:u:"$OWNER":rwX "$ME/memory" "$ME/journal"

grep -q '^MEMORY_VAULT_DIR=' /etc/agent-dashboard.env || echo "MEMORY_VAULT_DIR=$MNT" | sudo tee -a /etc/agent-dashboard.env >/dev/null
sudo systemctl restart agent-dashboard-web

sudo -u agent test -r "$MNT/100 - Me/Daily Agenda.md" && echo "agent can read the vault"
sudo -u agent touch "$MNT/100 - Me/plans/.write-test" && sudo rm -f "$MNT/100 - Me/plans/.write-test" && echo "agent can write plans"
sudo -u agent touch "$MNT/100 - Me/.write-test" && sudo rm -f "$MNT/100 - Me/.write-test" && echo "agent can write Goals.md, memories and the journal"
sudo -u agent touch "$MNT/wiki/sources/chats/.write-test" && sudo rm -f "$MNT/wiki/sources/chats/.write-test" && sudo -u agent test -w "$MNT/log.md" && echo "agent can write the brain's wiki pages"
