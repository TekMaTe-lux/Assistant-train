#!/usr/bin/env python3
from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

SOURCE_URL = "https://raw.githubusercontent.com/TekMaTe-lux/Assistant-train/main/vps/map-v2/install-community-signal-dialog-cow-v10.py"
OLD = "data = base64.b64decode(payload, validate=True)"
NEW = "payload = b''.join(payload.split())\n        data = base64.b64decode(payload, validate=True)"


def main() -> int:
    apply = "--apply" in sys.argv[1:]

    req = urllib.request.Request(SOURCE_URL + "?v=20260911-v11", headers={"User-Agent":"LaBetaillere-VPS"})
    with urllib.request.urlopen(req, timeout=30) as r:
        source = r.read().decode("utf-8")

    if source.count(OLD) != 1:
        raise SystemExit("ARRÊT : décodeur V10 attendu introuvable ou ambigu")

    source = source.replace(OLD, NEW, 1)
    source = source.replace('VERSION = "20260911-cow-exact-v10"', 'VERSION = "20260911-cow-exact-v11"', 1)
    source = source.replace('MARK = "LB_COMMUNITY_SIGNAL_DIALOG_COW_EXACT_V10"', 'MARK = "LB_COMMUNITY_SIGNAL_DIALOG_COW_EXACT_V11"', 1)
    source = source.replace('community-signal-dialog-cow-exact-v10-', 'community-signal-dialog-cow-exact-v11-', 1)

    fd, tmp = tempfile.mkstemp(prefix="lb-cow-v11-", suffix=".py")
    os.close(fd)
    path = Path(tmp)
    try:
        path.write_text(source, encoding="utf-8")
        cmd = [sys.executable, str(path)]
        if apply:
            cmd.append("--apply")
        return subprocess.call(cmd)
    finally:
        try:
            path.unlink()
        except FileNotFoundError:
            pass


if __name__ == "__main__":
    raise SystemExit(main())
