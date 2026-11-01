#!/usr/bin/env python3
"""Root-only, idempotent widget secret provisioning. Never prints the token."""
import os
from pathlib import Path
import re
import secrets
import stat
import tempfile


def configure(env_file: Path) -> bool:
    text = env_file.read_text()
    existing = re.findall(r"^WIDGET_READ_TOKEN=(.*)$", text, re.M)
    if len(existing) == 1 and re.fullmatch(r"[0-9a-f]{64}", existing[0]):
        return False
    if existing and any(value.strip() for value in existing):
        raise ValueError("Existing widget token needs administrator review; no secret changed")
    text = re.sub(r"^WIDGET_READ_TOKEN=.*\n?", "", text, flags=re.M)
    text = text.rstrip("\n") + "\nWIDGET_READ_TOKEN=" + secrets.token_hex(32) + "\n"
    info = env_file.stat()
    fd, name = tempfile.mkstemp(prefix=".agent-dashboard-env-", dir=env_file.parent)
    try:
        os.fchmod(fd, stat.S_IRUSR | stat.S_IWUSR)
        os.fchown(fd, info.st_uid, info.st_gid)
        with os.fdopen(fd, "w") as output:
            output.write(text)
            output.flush()
            os.fsync(output.fileno())
        os.replace(name, env_file)
    finally:
        if os.path.exists(name):
            os.unlink(name)
    return True


if __name__ == "__main__":
    if os.geteuid() != 0:
        raise SystemExit("Run as root: sudo python3 deploy/configure-widget-token.py")
    changed = configure(Path("/etc/agent-dashboard.env"))
    print("Widget token configured; restart agent-dashboard-web." if changed else "Widget token already configured.")
