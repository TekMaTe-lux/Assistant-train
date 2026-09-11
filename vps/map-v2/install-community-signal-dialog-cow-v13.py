#!/usr/bin/env python3
from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

SOURCE_URL = "https://raw.githubusercontent.com/TekMaTe-lux/Assistant-train/main/vps/map-v2/install-community-signal-dialog-cow-v12.py"

OLD = r'''def remove_visible_header_text(text: str) -> str:
    pat = re.compile(
        r'\s*<div\s+class="lb-signal-dialog-head-main">.*?</div>\s*',
        re.S | re.I,
    )
    text, _ = pat.subn("\n", text, count=1)
    return text
'''

NEW = r'''def remove_visible_header_text(text: str) -> str:
    # Retirer séparément les trois éléments visibles. C'est volontairement
    # plus robuste qu'un .*?</div> sur le conteneur, car celui-ci contient
    # lui-même plusieurs balises imbriquées.
    patterns = [
        r'\s*<div\s+class="lb-signal-dialog-kicker"[^>]*>.*?</div>\s*',
        r'\s*<h2\s+class="lb-signal-dialog-title"[^>]*>.*?</h2>\s*',
        r'\s*<div\s+class="lb-signal-dialog-sub"[^>]*>.*?</div>\s*',
    ]
    removed = 0
    for pat in patterns:
        text, n = re.subn(pat, "\n", text, count=1, flags=re.S | re.I)
        removed += n

    # Une fois les trois textes retirés, supprimer le conteneur devenu vide.
    text = re.sub(
        r'\s*<div\s+class="lb-signal-dialog-head-main"[^>]*>\s*</div>\s*',
        "\n",
        text,
        count=1,
        flags=re.S | re.I,
    )

    # Sur les états déjà partiellement nettoyés, certains éléments peuvent
    # manquer. En revanche aucun des trois textes ne doit encore être visible.
    if removed == 0 and any(
        token in text
        for token in (
            "Signalement voyageur · NON OFFICIEL",
            "Retard communautaire",
            "Chaque signalement est noté séparément",
        )
    ):
        raise RuntimeError("en-tête visible détecté mais structure inconnue")
    return text
'''


def main() -> int:
    apply = "--apply" in sys.argv[1:]

    req = urllib.request.Request(
        SOURCE_URL + "?v=20260911-v13",
        headers={"User-Agent": "LaBetaillere-VPS"},
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        source = r.read().decode("utf-8")

    if source.count(OLD) != 1:
        raise SystemExit("ARRÊT : fonction V12 attendue introuvable ou ambiguë")

    source = source.replace(OLD, NEW, 1)
    source = source.replace(
        'MARK = "LB_COMMUNITY_SIGNAL_DIALOG_COW_V12"',
        'MARK = "LB_COMMUNITY_SIGNAL_DIALOG_COW_V13"',
        1,
    )
    source = source.replace(
        'VERSION = "20260911-cow-v12"',
        'VERSION = "20260911-cow-v13"',
        1,
    )
    source = source.replace(
        'community-signal-dialog-cow-v12-',
        'community-signal-dialog-cow-v13-',
        1,
    )

    fd, tmp = tempfile.mkstemp(prefix="lb-cow-v13-", suffix=".py")
    os.close(fd)
    path = Path(tmp)
    try:
        path.write_text(source, encoding="utf-8")
        check = subprocess.run(
            [sys.executable, "-m", "py_compile", str(path)],
            capture_output=True,
            text=True,
        )
        if check.returncode:
            raise SystemExit("ARRÊT : V13 générée invalide : " + check.stderr.strip())

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
