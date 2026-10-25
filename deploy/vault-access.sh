#!/usr/bin/env bash
# One-time, run by Lind as ubuntu: bash /opt/agent-dashboard/deploy/vault-access.sh
# Lets the dashboard (user `agent`) read the Obsidian vault for Memory and the Today page, and write
# day plans into "100 - Me/plans" only. Uses ACLs, so owners and modes stay as Syncthing set them:
# - ~/.hermes: pass-through only (x) — agent can't list or read anything else in there.
# - the vault: read (it is already world-readable); plans/: read + write, inherited by new files.
set -euo pipefail

HERMES=/home/ubuntu/.hermes
VAULT=$HERMES/syncthing-sync/lind-brain
PLANS="$VAULT/100 - Me/plans"

command -v setfacl >/dev/null || sudo apt-get install -y acl
sudo setfacl -m u:agent:x "$HERMES"
sudo mkdir -p "$PLANS"
sudo chown --reference="$VAULT/100 - Me" "$PLANS"
sudo setfacl -m u:agent:rwx -m d:u:agent:rwx -m d:u::rwx "$PLANS"

sudo -u agent test -r "$VAULT/100 - Me/Daily Agenda.md" && echo "agent can read the vault"
sudo -u agent touch "$PLANS/.write-test" && sudo rm -f "$PLANS/.write-test" && echo "agent can write plans"
