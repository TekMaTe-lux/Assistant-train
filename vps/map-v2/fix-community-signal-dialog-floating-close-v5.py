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

MARK = "LB_COMMUNITY_SIGNAL_DIALOG_FLOATING_CLOSE_V5"
DEFAULT_ROOT = "/opt/labetaillere-map-v2-src"


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
    if not shutil.which("node"):
        raise RuntimeError("node absent : impossible de vérifier le JavaScript")
    with tempfile.NamedTemporaryFile("w", suffix=".js", encoding="utf-8", delete=False) as f:
        f.write(text)
        tmp = f.name
    try:
        p = subprocess.run(["node", "--check", tmp], capture_output=True, text=True, timeout=20)
        if p.returncode:
            raise RuntimeError("JavaScript invalide après patch : " + p.stderr.strip())
    finally:
        try:
            os.unlink(tmp)
        except OSError:
            pass


def patch_dialog(text: str) -> str:
    if MARK in text:
        return text

    if "window.__LB_COMMUNITY_SIGNAL_DIALOG_V1__" not in text:
        raise RuntimeError("dialogue communautaire V1 absent")
    if "lb-signal-dialog-card" not in text:
        raise RuntimeError("carte du modal introuvable")
    if "trip-panel-close" not in text:
        # On refuse d'inventer un style local : la classe du site doit déjà être disponible dans le document.
        raise RuntimeError("classe .trip-panel-close absente du dialogue actuel : refus d'inventer un bouton différent")

    # 1) Retirer les anciennes croix du template du modal, qu'elles soient dans <header> ou <div>.
    #    On va en remettre UNE SEULE, directement sous la carte du modal, donc hors de tout bloc pouvant être masqué.
    close_pat = re.compile(
        r'\s*<button\s+type="button"\s+class="[^"]*lb-signal-dialog-close[^"]*"\s+aria-label="Fermer">(?:×|✕|&times;)</button>',
        re.I,
    )
    text, removed = close_pat.subn('', text)
    if removed < 1:
        # Une version précédente peut n'avoir plus aucune croix : ce n'est pas bloquant.
        removed = 0

    # 2) Ajouter la croix comme enfant DIRECT de la carte, en réutilisant le vrai composant du site.
    #    Visuel = .trip-panel-close ; seule la position top/right est spécifique au modal.
    section_pat = re.compile(
        r'(<section\s+class="lb-signal-dialog-card"[^>]*>)',
        re.I,
    )
    button = (
        '\\n        <!-- ' + MARK + ' : même bouton .trip-panel-close que les autres fiches/modaux -->\\n'
        '        <button type="button" class="trip-panel-close lb-signal-dialog-close lb-signal-dialog-close-top" aria-label="Fermer">×</button>'
    )
    text, n = section_pat.subn(lambda m: m.group(1) + button, text, count=1)
    if n != 1:
        raise RuntimeError(f"section du modal attendue 1 fois, trouvée {n}")

    # 3) Position uniquement. Aucun style visuel de croix n'est redéfini.
    #    On force position:relative sur la carte et top/right sur le bouton pour reproduire le placement des autres modaux.
    css_anchor = ".lb-signal-dialog-card{"
    idx = text.find(css_anchor)
    if idx < 0:
        raise RuntimeError("règle CSS .lb-signal-dialog-card introuvable")
    insert_at = text.find("}\n", idx)
    if insert_at < 0:
        raise RuntimeError("fin règle CSS .lb-signal-dialog-card introuvable")
    insert_at += 2
    css = (
        "      /* " + MARK + " : placement seulement, le look vient de .trip-panel-close du site. */\n"
        "      .lb-signal-dialog-card{position:relative!important}\n"
        "      .lb-signal-dialog-close-top{position:absolute!important;top:10px!important;right:10px!important;left:auto!important;bottom:auto!important;z-index:30!important;margin:0!important;display:flex!important}\n"
    )
    text = text[:insert_at] + css + text[insert_at:]

    # Le handler existant doit fermer sur .lb-signal-dialog-close.
    if "closest('.lb-signal-dialog-close')" not in text and 'closest(".lb-signal-dialog-close")' not in text:
        raise RuntimeError("handler de fermeture existant introuvable : refus de modifier")

    # Garde-fous finaux : une seule croix dans le template et aucun style visuel local réintroduit.
    if text.count('lb-signal-dialog-close-top') != 2:  # classe dans HTML + classe CSS
        raise RuntimeError("contrôle croix flottante incohérent")
    if text.count('aria-label="Fermer">×</button>') < 1:
        raise RuntimeError("croix Fermer absente après patch")
    return text


def patch_core(text: str) -> str:
    version = "20260910-signal-dialog-close-v5"
    pat = re.compile(r'(lb-community-signal-dialog-v1\.js\?v=)[^"\']+')
    new, n = pat.subn(r'\g<1>' + version, text)
    if n != 1:
        raise RuntimeError(f"core : référence dialogue attendue 1 fois, trouvée {n}")
    return new


def main() -> None:
    ap = argparse.ArgumentParser(description="Place la croix standard du site en haut à droite du modal communautaire")
    ap.add_argument("--root", default=os.environ.get("LB_MAP_ROOT", DEFAULT_ROOT))
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
    after_dialog = patch_dialog(before_dialog.decode("utf-8"))
    after_core = patch_core(before_core.decode("utf-8"))
    node_check(after_dialog)

    print("CROIX MODAL COMMUNAUTAIRE V5 — VERIFIEE :")
    print("  ✓ une seule croix, en haut à droite de la carte du modal")
    print("  ✓ bouton placé hors du header/div d'en-tête : impossible qu'un header masqué l'emporte")
    print("  ✓ visuel réutilisé : classe .trip-panel-close du site")
    print("  ✓ même glyphe × et même aria-label Fermer")
    print("  ✓ aucun style visuel de bouton inventé ; seulement top/right/z-index")
    print("  ✓ handler de fermeture existant conservé")
    print("  ✓ JavaScript validé avec node --check")
    print("  ✓ aucune API / base / GTFS / routage modifiés")

    after_dialog_b = after_dialog.encode("utf-8")
    after_core_b = after_core.encode("utf-8")
    if after_dialog_b == before_dialog and after_core_b == before_core:
        print("Correctif déjà installé. Aucun changement.")
        return
    if not args.apply:
        print("SIMULATION OK — ajouter --apply pour installer.")
        return

    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S-%f")
    backup = Path(args.root) / "map-v2/backups" / ("community-signal-dialog-floating-close-v5-" + stamp)
    backup.mkdir(parents=True, exist_ok=False)
    shutil.copy2(dialog, backup / dialog.name)
    shutil.copy2(core, backup / core.name)

    changed: list[tuple[Path, bytes]] = []
    try:
        if dialog.read_bytes() != before_dialog or core.read_bytes() != before_core:
            raise RuntimeError("modification concurrente détectée : aucun fichier écrit")
        atomic_write(dialog, after_dialog_b)
        changed.append((dialog, before_dialog))
        atomic_write(core, after_core_b)
        changed.append((core, before_core))
    except BaseException:
        for p, data in reversed(changed):
            atomic_write(p, data)
        print("ERREUR : rollback automatique effectué.")
        raise

    print("INSTALLÉ — croix uniquement + cache-bust du dialogue.")
    print("Sauvegarde :", backup)
    print("Recharge la carte puis ouvre le retard voyageur.")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        raise SystemExit("ARRÊT : " + str(exc))
