#!/usr/bin/env bash
# One-time, run by Lind as ubuntu: bash /opt/agent-dashboard/deploy/vault-access.sh
# Lets the dashboard (user `agent`) read the Obsidian vault for Memory and the Today page, write
# day plans into "100 - Me/plans", memories into "100 - Me/memory/inbox", and captured sources
# into "raw/inbox".
# ~/.hermes is kept private (mode 700 — Hermes resets it), so instead of opening a path through it the
# vault is bind-mounted at /var/lib/agent-dashboard/vault by a systemd mount unit (survives reboots).
# The vault itself is already world-readable; the writable folders get ACLs so agent can write there.
set -euo pipefail

VAULT=/home/ubuntu/.hermes/syncthing-sync/lind-brain
MNT=/var/lib/agent-dashboard/vault
PLANS="$VAULT/100 - Me/plans"
MEM_INBOX="$VAULT/100 - Me/memory/inbox"
RAW_INBOX="$VAULT/raw/inbox"
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

sudo mkdir -p "$MEM_INBOX" "$RAW_INBOX"
sudo chown --reference="$VAULT/100 - Me" "$MEM_INBOX"
sudo chown --reference="$VAULT/raw" "$RAW_INBOX"
sudo setfacl -m u:agent:rwx -m d:u:agent:rwx -m d:u:"$OWNER":rwx "$MEM_INBOX"
sudo setfacl -m u:agent:rwx -m d:u:agent:rwx -m d:u:"$OWNER":rwx "$RAW_INBOX"

grep -q '^MEMORY_VAULT_DIR=' /etc/agent-dashboard.env || echo "MEMORY_VAULT_DIR=$MNT" | sudo tee -a /etc/agent-dashboard.env >/dev/null
sudo systemctl restart agent-dashboard-web

sudo -u agent test -r "$MNT/100 - Me/Daily Agenda.md" && echo "agent can read the vault"
sudo -u agent touch "$MNT/100 - Me/plans/.write-test" && sudo rm -f "$MNT/100 - Me/plans/.write-test" && echo "agent can write plans"
sudo -u agent touch "$MNT/100 - Me/memory/inbox/.write-test" && sudo rm -f "$MNT/100 - Me/memory/inbox/.write-test" && echo "agent can write memories"
sudo -u agent touch "$MNT/raw/inbox/.write-test" && sudo rm -f "$MNT/raw/inbox/.write-test" && echo "agent can write captured sources"
sudo -u agent touch "$MNT/wiki/sources/chats/.write-test" && sudo rm -f "$MNT/wiki/sources/chats/.write-test" && sudo -u agent test -w "$MNT/log.md" && echo "agent can write the brain's wiki pages"
