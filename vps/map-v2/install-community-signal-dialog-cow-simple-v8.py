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

MARK = "LB_COMMUNITY_SIGNAL_DIALOG_COW_SIMPLE_V8"
DEFAULT_ROOT = "/opt/labetaillere-map-v2-src"
COW_URL = "https://raw.githubusercontent.com/TekMaTe-lux/Assistant-train/main/vps/map-v2/lb-community-cow-modal.webp"


def atomic_write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    st = path.stat() if path.exists() else None
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


def download_cow() -> bytes:
    req = urllib.request.Request(COW_URL + "?v=20260910-v8", headers={"User-Agent": "LaBetaillere-VPS"})
    with urllib.request.urlopen(req, timeout=30) as response:
        data = response.read()
    if len(data) < 10000:
        raise RuntimeError(f"asset vache trop petit ({len(data)} octets)")
    if not (data[:4] == b"RIFF" and data[8:12] == b"WEBP"):
        raise RuntimeError("asset vache téléchargé invalide")
    return data


def patch_dialog(text: str) -> str:
    if MARK in text:
        return text

    required = [
        "window.__LB_COMMUNITY_SIGNAL_DIALOG_V1__",
        "LB_COMMUNITY_SIGNAL_DIALOG_CLOSE_ROW_V6",
        "Ces retards sont déclarés par des voyageurs",
        "Modifier mon signalement",
        "Supprimer",
        "lb-signal-dialog-body",
    ]
    for token in required:
        if token not in text:
            raise RuntimeError(f"état VPS inattendu, marqueur absent : {token}")

    if "LB_COMMUNITY_SIGNAL_DIALOG_COW_V7" in text:
        raise RuntimeError("ancienne tentative V7 déjà présente : refus d'empiler")

    # On reconstruit UNIQUEMENT la zone supérieure : zéro titre, zéro sous-titre,
    # une seule croix standard du site à droite.
    head_pat = re.compile(
        r'<(?:div|header)\s+class="lb-signal-dialog-head">.*?<div\s+class="lb-signal-dialog-body">',
        re.S | re.I,
    )
    clean_head = (
        '<div class="lb-signal-dialog-head lb-signal-dialog-close-only">\n'
        '          <button type="button" class="trip-panel-close lb-signal-dialog-close" aria-label="Fermer">×</button>\n'
        '        </div>\n'
        '        <div class="lb-signal-dialog-body">'
    )
    text, n = head_pat.subn(clean_head, text, count=1)
    if n != 1:
        raise RuntimeError(f"zone haute du modal attendue 1 fois, trouvée {n}")

    # Le titre visuel n'existe plus : on garde un libellé ARIA invisible seulement.
    text, n = re.subn(
        r'(<section\s+class="lb-signal-dialog-card"\s+role="dialog"\s+aria-modal="true")\s+aria-labelledby="[^"]+"',
        r'\1 aria-label="Détail du signalement voyageur"',
        text,
        count=1,
        flags=re.I,
    )
    if n != 1 and 'aria-label="Détail du signalement voyageur"' not in text:
        raise RuntimeError("attribut ARIA du modal introuvable")

    section_open = '<section class="lb-signal-dialog-card" role="dialog" aria-modal="true" aria-label="Détail du signalement voyageur">'
    if text.count(section_open) != 1:
        raise RuntimeError(f"ouverture du modal attendue 1 fois, trouvée {text.count(section_open)}")

    stage_open = (
        '<div class="lb-signal-dialog-stage">\n'
        '        <!-- ' + MARK + ' : vache #BER fournie, aucun texte ajouté -->\n'
        '        <img class="lb-signal-dialog-cow" src="./assets/lb-community-cow-modal.webp?v=20260910-v8" alt="" aria-hidden="true" draggable="false">\n'
        '        ' + section_open
    )
    text = text.replace(section_open, stage_open, 1)

    start = text.find(stage_open)
    end = text.find('</section>', start)
    if end < 0:
        raise RuntimeError("fermeture </section> du modal introuvable")
    text = text[:end + len('</section>')] + '\n      </div>' + text[end + len('</section>'):]

    style_end = "    `;\n    document.head.appendChild(style);"
    if text.count(style_end) != 1:
        raise RuntimeError("fin du CSS du dialogue introuvable")

    css = r'''
      /* LB_COMMUNITY_SIGNAL_DIALOG_COW_SIMPLE_V8 */
      .lb-signal-dialog-stage{
        --lb-signal-cow-h:clamp(290px,42vh,360px);
        box-sizing:border-box;
        width:min(520px,calc(100vw - 28px));
        display:flex;
        flex-direction:column;
        align-items:center;
      }
      .lb-signal-dialog-cow{
        position:relative;
        z-index:6;
        display:block;
        height:var(--lb-signal-cow-h);
        width:auto;
        max-width:76vw;
        object-fit:contain;
        margin:0 auto -46px;
        pointer-events:none;
        user-select:none;
        -webkit-user-drag:none;
        filter:drop-shadow(0 12px 20px rgba(0,0,0,.34));
      }
      .lb-signal-dialog-stage>.lb-signal-dialog-card{
        position:relative!important;
        z-index:4;
        width:100%!important;
        max-height:calc(100vh - var(--lb-signal-cow-h) + 20px)!important;
      }
      .lb-signal-dialog-head.lb-signal-dialog-close-only{
        min-height:34px!important;
        display:flex!important;
        align-items:center!important;
        justify-content:flex-end!important;
        padding:8px 10px 0!important;
        margin:0!important;
        border:0!important;
        background:transparent!important;
      }
      .lb-signal-dialog-head.lb-signal-dialog-close-only>.trip-panel-close{
        flex:0 0 auto!important;
        margin:0!important;
      }

      @media(max-height:720px) and (min-width:701px){
        .lb-signal-dialog-stage{--lb-signal-cow-h:clamp(230px,34vh,285px)}
        .lb-signal-dialog-cow{margin-bottom:-38px}
      }
      @media(max-width:700px),(pointer:coarse){
        .lb-signal-dialog-stage{
          --lb-signal-cow-h:clamp(200px,30vh,260px);
          width:100%;
          padding:0 10px;
        }
        .lb-signal-dialog-cow{max-width:72vw;margin-bottom:-32px}
        .lb-signal-dialog-stage>.lb-signal-dialog-card{
          width:100%!important;
          max-height:calc(100vh - var(--lb-signal-cow-h) + 12px)!important;
        }
      }
'''
    text = text.replace(style_end, css + style_end, 1)

    forbidden = [
        "Signalement voyageur · NON OFFICIEL",
        ">Retard communautaire<",
        "Chaque signalement est noté séparément",
    ]
    for token in forbidden:
        if token in text:
            raise RuntimeError(f"texte du haut encore présent après patch : {token}")

    if text.count('class="lb-signal-dialog-cow"') != 1:
        raise RuntimeError("vache doit être présente exactement une fois")
    if text.count('class="trip-panel-close lb-signal-dialog-close"') != 1:
        raise RuntimeError("croix standard doit être présente exactement une fois")
    if "closest('.lb-signal-dialog-close')" not in text and 'closest(".lb-signal-dialog-close")' not in text:
        raise RuntimeError("handler de fermeture perdu")

    return text


def patch_core(text: str) -> str:
    version = "20260910-signal-dialog-cow-simple-v8"
    pat = re.compile(r'(lb-community-signal-dialog-v1\.js\?v=)[^"\']+')
    new, n = pat.subn(r'\g<1>' + version, text)
    if n != 1:
        raise RuntimeError(f"core : référence dialogue attendue 1 fois, trouvée {n}")
    return new


def main() -> None:
    ap = argparse.ArgumentParser(description="Retire le texte supérieur et pose la vache #BER fournie sur le modal")
    ap.add_argument("--root", default=os.environ.get("LB_MAP_ROOT", DEFAULT_ROOT))
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    public = Path(args.root) / "map-v2/public"
    dialog = public / "assets/lb-community-signal-dialog-v1.js"
    core = public / "carte-core-preview.html"
    cow = public / "assets/lb-community-cow-modal.webp"

    for p in (dialog, core):
        if not p.is_file():
            raise RuntimeError(f"fichier absent : {p}")

    before_dialog = dialog.read_bytes()
    before_core = core.read_bytes()
    before_cow = cow.read_bytes() if cow.exists() else None

    cow_data = download_cow()
    after_dialog = patch_dialog(before_dialog.decode("utf-8"))
    after_core = patch_core(before_core.decode("utf-8"))
    node_check(after_dialog)

    print("MODAL VOIX DU BETAIL V8 — MODIFICATION CIBLEE VERIFIEE :")
    print("  ✓ retiré : Signalement voyageur · NON OFFICIEL")
    print("  ✓ retiré : Retard communautaire")
    print("  ✓ retiré : le sous-texte ajouté au-dessus")
    print("  ✓ vache #BER fournie placée au-dessus du modal")
    print("  ✓ pattes légèrement superposées au bord supérieur du modal")
    print("  ✓ croix standard du site conservée seule à droite")
    print("  ✓ phrase d'avertissement SNCF/CFL conservée")
    print("  ✓ cartes / Modifier / Supprimer / votes inchangés")
    print("  ✓ JavaScript validé avec node --check")
    print("  ✓ aucun backend / GTFS / routage / service modifié")

    after_dialog_b = after_dialog.encode("utf-8")
    after_core_b = after_core.encode("utf-8")

    if after_dialog_b == before_dialog and after_core_b == before_core and before_cow == cow_data:
        print("Correctif déjà installé. Aucun changement.")
        return
    if not args.apply:
        print("SIMULATION OK — ajouter --apply pour installer.")
        return

    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S-%f")
    backup = Path(args.root) / "map-v2/backups" / ("community-signal-dialog-cow-simple-v8-" + stamp)
    backup.mkdir(parents=True, exist_ok=False)
    shutil.copy2(dialog, backup / dialog.name)
    shutil.copy2(core, backup / core.name)
    if cow.exists():
        shutil.copy2(cow, backup / cow.name)

    changed = []
    try:
        if dialog.read_bytes() != before_dialog or core.read_bytes() != before_core:
            raise RuntimeError("modification concurrente détectée : aucun fichier écrit")
        atomic_write(cow, cow_data)
        changed.append((cow, before_cow))
        atomic_write(dialog, after_dialog_b)
        changed.append((dialog, before_dialog))
        atomic_write(core, after_core_b)
        changed.append((core, before_core))
    except BaseException:
        for path, data in reversed(changed):
            if data is None:
                try:
                    path.unlink()
                except FileNotFoundError:
                    pass
            else:
                atomic_write(path, data)
        print("ERREUR : rollback automatique effectué.")
        raise

    print("INSTALLÉ — uniquement le haut du modal + image vache + cache-bust.")
    print("Sauvegarde :", backup)
    print("Recharge la carte puis rouvre un retard voyageur.")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        raise SystemExit("ARRÊT : " + str(exc))
