#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import urllib.request
from datetime import datetime, timezone

ROOT_DEFAULT = "/opt/labetaillere-map-v2-src"
ASSET_URL = "https://raw.githubusercontent.com/TekMaTe-lux/Assistant-train/main/vps/map-v2/lb-community-train-scope-guard-v1.js"
SCRIPT_TAG = '<script id="lb-community-train-scope-guard-v1" src="./assets/lb-community-train-scope-guard-v1.js?v=20260910-1"></script>'


def atomic_write(path: Path, data: bytes) -> None:
    st = path.stat() if path.exists() else None
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=path.name + ".tmp-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        if st:
            os.chmod(tmp, st.st_mode & 0o7777)
            if os.geteuid() == 0:
                os.chown(tmp, st.st_uid, st.st_gid)
        else:
            os.chmod(tmp, 0o644)
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def fetch_asset() -> bytes:
    req = urllib.request.Request(ASSET_URL + "?cb=20260910-1", headers={"User-Agent":"LaBetaillere-VPS"})
    with urllib.request.urlopen(req, timeout=30) as r:
        data = r.read()
    text = data.decode("utf-8")
    required = [
        "__LB_COMMUNITY_TRAIN_SCOPE_GUARD_V1__",
        "station-board-mode",
        "train-mismatch",
        "lb-map-trip-community",
        "MutationObserver",
    ]
    for token in required:
        if token not in text:
            raise RuntimeError(f"asset téléchargé incomplet : {token}")
    if shutil.which("node"):
        with tempfile.NamedTemporaryFile("wb", suffix=".js", delete=False) as f:
            f.write(data)
            tmp = f.name
        try:
            p = subprocess.run(["node", "--check", tmp], capture_output=True, text=True, timeout=20)
            if p.returncode:
                raise RuntimeError("JavaScript invalide : " + p.stderr.strip())
        finally:
            try: os.unlink(tmp)
            except OSError: pass
    return data


def patch_core(text: str) -> str:
    # Mettre à jour si déjà installé.
    existing = re.compile(r'<script\s+id="lb-community-train-scope-guard-v1"\s+src="\./assets/lb-community-train-scope-guard-v1\.js\?v=[^"]+"></script>')
    if existing.search(text):
        return existing.sub(SCRIPT_TAG, text, count=1)

    # Le garde-fou doit se charger après la pile communautaire existante.
    anchors = [
        re.compile(r'(<script[^>]+lb-community-signal-dialog-v1\.js\?v=[^>]+></script>)'),
        re.compile(r'(<script[^>]+lb-community-traveler-compact-v2\.js\?v=[^>]+></script>)'),
        re.compile(r'(<script[^>]+lb-community-traveler-v1\.js\?v=[^>]+></script>)'),
    ]
    for pat in anchors:
        m = pat.search(text)
        if m:
            return text[:m.end()] + "\n" + SCRIPT_TAG + text[m.end():]

    # Refus d'injecter au hasard si la pile communautaire n'est pas identifiée.
    raise RuntimeError("pile communautaire introuvable dans ce core : fichier laissé intact")


def main() -> None:
    ap = argparse.ArgumentParser(description="Empêche la Voix du Bétail train de rester dans les fiches gare")
    ap.add_argument("--root", default=os.environ.get("LB_MAP_ROOT", ROOT_DEFAULT))
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    public = Path(args.root) / "map-v2/public"
    asset = public / "assets/lb-community-train-scope-guard-v1.js"
    candidates = [public / "carte-core-preview.html", public / "carte-core.html"]
    cores = []
    for p in candidates:
        if p.is_file():
            txt = p.read_text(encoding="utf-8")
            if "lb-community-traveler-v1.js" in txt or "lb-community-traveler-compact-v2.js" in txt:
                cores.append((p, txt))

    if not cores:
        raise RuntimeError("aucun core actif contenant la pile communautaire trouvé")

    asset_data = fetch_asset()
    patched = []
    for p, txt in cores:
        new = patch_core(txt)
        if "lb-community-train-scope-guard-v1.js?v=20260910-1" not in new:
            raise RuntimeError(f"contrôle cache-bust échoué : {p}")
        patched.append((p, txt.encode("utf-8"), new.encode("utf-8")))

    print("GARDE-FOU VOIX DU BETAIL — TRAIN UNIQUEMENT V1 :")
    print("  ✓ fiche gare : bandeau Voix du Bétail train interdit")
    print("  ✓ fiche gare : retards voyageurs d'arrêts train supprimés/masqués")
    print("  ✓ fiche train : vérification numéro du bloc = numéro du train affiché")
    print("  ✓ si numéros différents : bloc masqué au lieu d'afficher une mauvaise info")
    print("  ✓ aucun appel API / vote / suppression / signalement modifié")
    print("  ✓ aucun GTFS / routage / moteur train modifié")
    print("  ✓ correctif isolé chargé APRES les modules communautaires existants")
    print("Cores ciblés :")
    for p, _, _ in patched:
        print("  -", p)

    if not args.apply:
        print("SIMULATION OK — ajouter --apply pour installer.")
        return

    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S-%f")
    backup = Path(args.root) / "map-v2/backups" / ("community-train-scope-guard-v1-" + stamp)
    backup.mkdir(parents=True, exist_ok=False)

    before_asset = asset.read_bytes() if asset.exists() else None
    if asset.exists():
        shutil.copy2(asset, backup / asset.name)
    for p, _, _ in patched:
        shutil.copy2(p, backup / p.name)

    changed = []
    try:
        # Concurrence : rien n'est écrit si un core a bougé depuis sa lecture.
        for p, before, _ in patched:
            if p.read_bytes() != before:
                raise RuntimeError(f"modification concurrente détectée : {p}")

        atomic_write(asset, asset_data)
        changed.append((asset, before_asset))
        for p, before, after in patched:
            atomic_write(p, after)
            changed.append((p, before))
    except BaseException:
        for p, old in reversed(changed):
            if old is None:
                try: p.unlink()
                except FileNotFoundError: pass
            else:
                atomic_write(p, old)
        print("ERREUR : rollback automatique effectué.")
        raise

    print("INSTALLÉ — garde-fou d'affichage uniquement.")
    print("Sauvegarde :", backup)
    print("Recharge la carte, ouvre d'abord un train puis une gare pour vérifier qu'aucun bandeau train ne reste dans la fiche gare.")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        raise SystemExit("ARRÊT : " + str(exc))
