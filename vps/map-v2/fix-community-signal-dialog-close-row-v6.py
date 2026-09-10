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

MARK = "LB_COMMUNITY_SIGNAL_DIALOG_CLOSE_ROW_V6"
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
    if "lb-signal-dialog-head" not in text:
        raise RuntimeError("ligne d'en-tête du dialogue absente")
    if "trip-panel-close" not in text:
        raise RuntimeError("classe standard .trip-panel-close absente")

    # Le vrai problème vu sur la capture : la croix V5 est absolue au-dessus du premier bloc.
    # On la retire, puis on la remet dans la ligne d'en-tête existante, comme les autres modaux.
    floating_pat = re.compile(
        r'\s*<!--\s*LB_COMMUNITY_SIGNAL_DIALOG_FLOATING_CLOSE_V5[^>]*-->\s*'
        r'<button\s+type="button"\s+class="[^"]*lb-signal-dialog-close-top[^"]*"\s+aria-label="Fermer">(?:×|✕|&times;)</button>',
        re.I,
    )
    text, removed_comment = floating_pat.subn('', text, count=1)

    if removed_comment == 0:
        floating_button = re.compile(
            r'\s*<button\s+type="button"\s+class="[^"]*lb-signal-dialog-close-top[^"]*"\s+aria-label="Fermer">(?:×|✕|&times;)</button>',
            re.I,
        )
        text, removed_button = floating_button.subn('', text, count=1)
        if removed_button == 0:
            raise RuntimeError("croix flottante V5 introuvable : refus de deviner l'état du fichier")

    # La carte embarquée masque globalement <header>. On utilise donc le MÊME bloc d'en-tête,
    # mais avec un <div> neutre pour qu'il reste visible.
    text, n_open = re.subn(
        r'<header\s+class="lb-signal-dialog-head">',
        '<div class="lb-signal-dialog-head">',
        text,
        count=1,
        flags=re.I,
    )
    if n_open:
        # Fermer uniquement le header du dialogue (le premier </header> après son ouverture).
        pos = text.find('<div class="lb-signal-dialog-head">')
        end = text.find('</header>', pos)
        if end < 0:
            raise RuntimeError("fermeture </header> du dialogue introuvable")
        text = text[:end] + '</div>' + text[end + len('</header>'):]
    elif '<div class="lb-signal-dialog-head">' not in text:
        raise RuntimeError("en-tête dialogue ni en <header> ni en <div>")

    # Nettoyage d'une ancienne croix éventuellement restée DANS la ligne d'en-tête.
    head_start = text.find('<div class="lb-signal-dialog-head">')
    head_end = text.find('</div>', head_start)
    # Le premier </div> ferme head-main, donc on cherche encore le suivant pour la fin du head.
    head_end = text.find('</div>', head_end + 6)
    if head_start < 0 or head_end < 0:
        raise RuntimeError("structure de l'en-tête dialogue inattendue")
    head_html = text[head_start:head_end + 6]
    head_html = re.sub(
        r'\s*<button\s+type="button"\s+class="[^"]*lb-signal-dialog-close[^"]*"\s+aria-label="Fermer">(?:×|✕|&times;)</button>',
        '',
        head_html,
        flags=re.I,
    )

    standard_button = (
        '\n          <!-- ' + MARK + ' : même bouton .trip-panel-close que les autres modaux -->\n'
        '          <button type="button" class="trip-panel-close lb-signal-dialog-close" aria-label="Fermer">×</button>\n'
    )
    # Insérer après head-main, juste avant la fermeture de la ligne d'en-tête.
    last_close = head_html.rfind('</div>')
    head_html = head_html[:last_close] + standard_button + head_html[last_close:]
    text = text[:head_start] + head_html + text[head_end + 6:]

    # Supprimer le positionnement absolu V5 qui créait la superposition.
    text, css_removed = re.subn(
        r'\s*/\*\s*LB_COMMUNITY_SIGNAL_DIALOG_FLOATING_CLOSE_V5[^*]*\*/\s*\n?'
        r'\s*\.lb-signal-dialog-card\{position:relative!important\}\s*\n?'
        r'\s*\.lb-signal-dialog-close-top\{[^}]*\}\s*\n?',
        '\n',
        text,
        count=1,
        flags=re.I,
    )
    if css_removed == 0:
        # Tolérance : enlever au minimum toute règle close-top résiduelle.
        text = re.sub(r'\s*\.lb-signal-dialog-close-top\{[^}]*\}\s*', '\n', text, count=1, flags=re.I)

    # Aucun look de bouton ajouté : seulement empêcher le bouton de se compresser dans la ligne flex.
    css_anchor = "      .lb-signal-dialog-head-main{min-width:0;flex:1}\n"
    if css_anchor in text:
        text = text.replace(
            css_anchor,
            css_anchor + "      .lb-signal-dialog-head>.trip-panel-close{flex:0 0 auto}\n",
            1,
        )
    else:
        raise RuntimeError("ancre CSS head-main introuvable")

    if "closest('.lb-signal-dialog-close')" not in text and 'closest(".lb-signal-dialog-close")' not in text:
        raise RuntimeError("handler de fermeture existant introuvable")
    if "lb-signal-dialog-close-top" in text:
        raise RuntimeError("ancienne classe flottante encore présente après patch")
    if text.count('class="trip-panel-close lb-signal-dialog-close"') != 1:
        raise RuntimeError("la croix standard doit exister exactement une fois")
    if '<header class="lb-signal-dialog-head">' in text:
        raise RuntimeError("header masquable encore présent")

    return text


def patch_core(text: str) -> str:
    version = "20260910-signal-dialog-close-row-v6"
    pat = re.compile(r'(lb-community-signal-dialog-v1\.js\?v=)[^"\']+')
    new, n = pat.subn(r'\g<1>' + version, text)
    if n != 1:
        raise RuntimeError(f"core : référence dialogue attendue 1 fois, trouvée {n}")
    return new


def main() -> None:
    ap = argparse.ArgumentParser(description="Replace la croix du dialogue communautaire dans une vraie ligne d'en-tête")
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

    print("CROIX MODAL COMMUNAUTAIRE V6 — SUPERPOSITION CORRIGÉE :")
    print("  ✓ croix flottante V5 supprimée")
    print("  ✓ croix replacée dans la ligne d'en-tête du modal")
    print("  ✓ plus aucune position:absolute sur la croix")
    print("  ✓ le bloc d'information commence sous l'en-tête : aucun chevauchement")
    print("  ✓ même bouton .trip-panel-close et même glyphe × que le site")
    print("  ✓ <header> remplacé par <div> pour éviter la règle globale header{display:none}")
    print("  ✓ modification / suppression / votes inchangés")
    print("  ✓ JavaScript validé avec node --check")
    print("  ✓ aucun backend / GTFS / routage / service modifié")

    after_dialog_b = after_dialog.encode("utf-8")
    after_core_b = after_core.encode("utf-8")
    if after_dialog_b == before_dialog and after_core_b == before_core:
        print("Correctif déjà installé. Aucun changement.")
        return
    if not args.apply:
        print("SIMULATION OK — ajouter --apply pour installer.")
        return

    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S-%f")
    backup = Path(args.root) / "map-v2/backups" / ("community-signal-dialog-close-row-v6-" + stamp)
    backup.mkdir(parents=True, exist_ok=False)
    shutil.copy2(dialog, backup / dialog.name)
    shutil.copy2(core, backup / core.name)

    changed = []
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

    print("INSTALLÉ — placement de la croix uniquement + cache-bust du dialogue.")
    print("Sauvegarde :", backup)
    print("Recharge la carte puis rouvre le retard voyageur.")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        raise SystemExit("ARRÊT : " + str(exc))
