#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
from datetime import datetime, timezone

ROOT_DEFAULT = "/opt/labetaillere-map-v2-src"
MARK = "LB_COMMUNITY_SIGNAL_DIALOG_CLOSE_V3"


def atomic_write(path: Path, data: bytes) -> None:
    st = path.stat()
    fd, tmp = tempfile.mkstemp(prefix=path.name + ".tmp-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        os.chmod(tmp, st.st_mode & 0o7777)
        if os.geteuid() == 0:
            os.chown(tmp, st.st_uid, st.st_gid)
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def node_check(text: str) -> None:
    node = shutil.which("node")
    if not node:
        raise RuntimeError("node absent : impossible de vérifier le JavaScript")
    with tempfile.NamedTemporaryFile("w", suffix=".js", encoding="utf-8", delete=False) as f:
        f.write(text)
        tmp = f.name
    try:
        p = subprocess.run([node, "--check", tmp], capture_output=True, text=True, timeout=20)
        if p.returncode:
            raise RuntimeError("JavaScript invalide : " + p.stderr.strip())
    finally:
        try:
            os.unlink(tmp)
        except OSError:
            pass


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=os.environ.get("LB_MAP_ROOT", ROOT_DEFAULT))
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    public = Path(args.root) / "map-v2/public"
    dialog = public / "assets/lb-community-signal-dialog-v1.js"
    core = public / "carte-core-preview.html"

    for p in (dialog, core):
        if not p.is_file():
            raise RuntimeError(f"fichier absent : {p}")

    before_dialog = dialog.read_bytes()
    before_core = core.read_bytes()
    text = before_dialog.decode("utf-8")
    core_text = before_core.decode("utf-8")

    # Garde-fous : on vérifie le dialogue actuel et le vrai composant de fermeture déjà utilisé par la carte.
    if "window.__LB_COMMUNITY_SIGNAL_DIALOG_V1__" not in text:
        raise RuntimeError("dialogue signal V1 absent")
    if "trip-panel-close" not in core_text:
        raise RuntimeError("classe trip-panel-close absente du core : refus d'inventer un style")
    if 'id="trip-panel-close" class="trip-panel-close"' not in core_text and "class=\"trip-panel-close\"" not in core_text:
        raise RuntimeError("bouton trip-panel-close réel introuvable dans le core")

    if MARK not in text:
        # On supprime UNIQUEMENT le style maison de la croix du dialogue.
        # Le bouton héritera alors exactement du composant .trip-panel-close déjà présent dans la carte.
        pat = re.compile(
            r"\n\s*\.lb-signal-dialog-close\{[^\n]*\}\n",
            re.M,
        )
        text2, n = pat.subn("\n", text, count=1)
        if n != 1:
            raise RuntimeError(f"règle CSS maison lb-signal-dialog-close attendue 1 fois, trouvée {n}")
        text = text2

        old = '<button type="button" class="lb-signal-dialog-close" aria-label="Fermer">×</button>'
        new = '<button type="button" class="trip-panel-close lb-signal-dialog-close" aria-label="Fermer">×</button><!-- ' + MARK + ' -->'
        count = text.count(old)
        if count != 1:
            raise RuntimeError(f"bouton dialogue attendu 1 fois, trouvé {count}")
        text = text.replace(old, new, 1)

    # Contrôles finaux : même classe et même glyphe que la fermeture de fiche train.
    for token in (
        MARK,
        'class="trip-panel-close lb-signal-dialog-close"',
        'aria-label="Fermer">×</button>',
        "event.target.closest('.lb-signal-dialog-close')",
    ):
        if token not in text:
            raise RuntimeError(f"contrôle final absent : {token}")
    if re.search(r"\.lb-signal-dialog-close\{", text):
        raise RuntimeError("un style local de fermeture subsiste : il masquerait le style du site")

    version = "20260910-signal-dialog-close-v3"
    core_after, n = re.subn(
        r'(lb-community-signal-dialog-v1\.js\?v=)[^"\']+',
        r'\g<1>' + version,
        core_text,
    )
    if n != 1:
        raise RuntimeError(f"cache-bust dialogue attendu 1 fois, trouvé {n}")

    node_check(text)

    print("FERMETURE MODAL COMMUNAUTAIRE V3 VERIFIEE :")
    print("  ✓ aucune nouvelle croix inventée")
    print("  ✓ réutilise exactement la classe .trip-panel-close déjà présente sur la fiche train")
    print("  ✓ même glyphe × et même aria-label 'Fermer'")
    print("  ✓ ancien style local de la croix supprimé pour laisser le style du site s'appliquer")
    print("  ✓ clic de fermeture existant conservé")
    print("  ✓ Échap + clic hors modal conservés")
    print("  ✓ aucun GTFS / routage / API / backend modifié")
    print("  ✓ JavaScript valide avec node --check")

    after_dialog = text.encode("utf-8")
    after_core = core_after.encode("utf-8")
    if after_dialog == before_dialog and after_core == before_core:
        print("Correctif déjà installé. Aucun changement.")
        return
    if not args.apply:
        print("SIMULATION OK — ajouter --apply pour installer.")
        return

    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S-%f")
    backup = Path(args.root) / "map-v2/backups" / f"community-signal-dialog-close-v3-{stamp}"
    backup.mkdir(parents=True, exist_ok=False)
    shutil.copy2(dialog, backup / dialog.name)
    shutil.copy2(core, backup / core.name)

    changed = []
    try:
        if dialog.read_bytes() != before_dialog or core.read_bytes() != before_core:
            raise RuntimeError("modification concurrente détectée : aucun fichier écrit")
        atomic_write(dialog, after_dialog)
        changed.append((dialog, before_dialog))
        atomic_write(core, after_core)
        changed.append((core, before_core))
    except BaseException:
        for p, data in reversed(changed):
            atomic_write(p, data)
        print("ERREUR : rollback automatique effectué.")
        raise

    print("INSTALLÉ — fermeture du modal alignée sur le composant existant du site.")
    print("Sauvegarde :", backup)
    print("Recharge la carte et rouvre le retard voyageur.")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        raise SystemExit("ARRÊT : " + str(e))
