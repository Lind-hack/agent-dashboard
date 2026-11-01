#!/usr/bin/env bash
# Promote an already built/verified checkout on main, without stopping active runner jobs.
set -euo pipefail
RELEASE=${1:?Usage: bash deploy/update-web.sh /path/to/verified-checkout}
APP=/opt/agent-dashboard
RELEASE=$(realpath "$RELEASE")
SHA=$(git -C "$RELEASE" rev-parse HEAD)
git -C "$RELEASE" diff --exit-code >/dev/null
git -C "$RELEASE" diff --cached --exit-code >/dev/null
git -C "$RELEASE" merge-base --is-ancestor "$SHA" origin/main
[ -f "$RELEASE/.next/BUILD_ID" ]
cmp "$RELEASE/package-lock.json" "$APP/package-lock.json"
[ -z "$(git -C "$APP" status --porcelain)" ] || { echo 'Production checkout has local changes; refusing.' >&2; exit 1; }
[ -z "${DATA_DIR:-}" ] || { echo 'Run deployment without a DATA_DIR override.' >&2; exit 1; }
WEB_PID=$(systemctl show agent-dashboard-web -p MainPID --value)
[ "$WEB_PID" -gt 1 ]
[ "$(stat -c %u "/proc/$WEB_PID")" = "$(id -u)" ]
STAGE=/var/lib/agent-dashboard/deployments/web-${SHA:0:12}-$(date -u +%Y%m%dT%H%M%SZ)
mkdir -m 700 "$STAGE"
git -C "$APP" rev-parse HEAD > "$STAGE/previous-sha"
printf '%s\n' "$SHA" > "$STAGE/release-sha"
cp -a "$RELEASE/.next" "$STAGE/.next"
# Keep old static URLs available for phones with an already-open tab.
cp -an "$APP/.next/static/." "$STAGE/.next/static/"
git -C "$APP" fetch --no-tags "$RELEASE" "$SHA"
git -C "$APP" merge --ff-only "$SHA"
# The source of the running runner remains on disk; its process and active jobs are untouched.
mv "$APP/.next" "$STAGE/previous-next"
ln -s "$STAGE/.next" "$APP/.next"
python3 - "$WEB_PID" <<'PY'
import os, signal, sys
root = int(sys.argv[1])
def descendants(pid):
    children = open(f'/proc/{pid}/task/{pid}/children').read().split()
    out = []
    for child in children:
        child = int(child)
        out.extend(descendants(child))
        out.append(child)
    return out
# Signal only the web server child. npm exits and systemd's Restart=always starts the new build.
for pid in descendants(root) + [root]:
    try:
        cmd = open(f'/proc/{pid}/cmdline', 'rb').read()
        if b'next-server' in cmd:
            os.kill(pid, signal.SIGTERM)
            print(f'Restarting owned web process {pid}; runner left running.')
            break
    except FileNotFoundError:
        continue
else:
    raise SystemExit('Could not identify web server process; no process was signalled.')
PY
for _ in $(seq 1 45); do
  CURRENT=$(systemctl show agent-dashboard-web -p MainPID --value)
  if [ "$CURRENT" -gt 1 ] && [ "$CURRENT" != "$WEB_PID" ] && curl -fsS --max-time 2 http://127.0.0.1:3100/login >/dev/null; then
    printf 'Live web release %s; backup %s\n' "$SHA" "$STAGE"
    exit 0
  fi
  sleep 1
done
printf 'Web health check failed. Backup: %s; previous source SHA is in previous-sha.\n' "$STAGE" >&2
exit 1
