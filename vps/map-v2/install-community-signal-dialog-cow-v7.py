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

MARK = "LB_COMMUNITY_SIGNAL_DIALOG_COW_V7"
DEFAULT_ROOT = "/opt/labetaillere-map-v2-src"
COW_URL = "https://raw.githubusercontent.com/TekMaTe-lux/Assistant-train/main/vps/map-v2/lb-community-cow-modal.webp"


def atomic_write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        st = path.stat()
    else:
        st = None
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
    req = urllib.request.Request(COW_URL + "?v=20260910-cow-v1", headers={"User-Agent":"LaBetaillere-VPS"})
    with urllib.request.urlopen(req, timeout=30) as r:
        data = r.read()
    if len(data) < 10000:
        raise RuntimeError(f"asset vache trop petit ({len(data)} octets)")
    if not (data[:4] == b"RIFF" and data[8:12] == b"WEBP"):
        raise RuntimeError("asset vache téléchargé mais ce n'est pas un WEBP valide")
    return data


def patch_dialog(text: str) -> str:
    if MARK in text:
        return text

    required = [
        "window.__LB_COMMUNITY_SIGNAL_DIALOG_V1__",
        "LB_COMMUNITY_SIGNAL_DIALOG_CLOSE_ROW_V6",
        "class=\"trip-panel-close lb-signal-dialog-close\"",
        "Ces retards sont déclarés par des voyageurs",
        "Modifier mon signalement",
        "Supprimer",
    ]
    for token in required:
        if token not in text:
            raise RuntimeError(f"état VPS inattendu, marqueur absent : {token}")

    # 1) Retirer UNIQUEMENT le texte ajouté au-dessus du contenu.
    #    On garde la ligne d'en-tête pour la croix, mais elle ne contient plus aucun titre/sous-titre.
    head_main_pat = re.compile(
        r'\s*<div class="lb-signal-dialog-head-main">\s*'
        r'<div class="lb-signal-dialog-kicker">.*?</div>\s*'
        r'<h2 class="lb-signal-dialog-title"[^>]*>.*?</h2>\s*'
        r'<div class="lb-signal-dialog-sub">.*?</div>\s*'
        r'</div>\s*',
        re.S,
    )
    text, n = head_main_pat.subn("\n", text, count=1)
    if n != 1:
        raise RuntimeError(f"bloc titre/sous-titre attendu 1 fois, trouvé {n}")

    # 2) Envelopper le modal dans une scène et placer LA vache fournie au-dessus.
    section_open = '<section class="lb-signal-dialog-card" role="dialog" aria-modal="true" aria-labelledby="lb-signal-dialog-title">'
    if text.count(section_open) != 1:
        raise RuntimeError(f"ouverture section modal attendue 1 fois, trouvée {text.count(section_open)}")
    stage_open = (
        '<div class="lb-signal-dialog-stage">\n'
        '        <!-- ' + MARK + ' : mascotte fournie par le projet, aucun texte ajouté -->\n'
        '        <img class="lb-signal-dialog-mascot" src="./assets/lb-community-cow-modal.webp?v=20260910-cow-v1" alt="" aria-hidden="true" draggable="false">\n'
        '        ' + section_open
    )
    text = text.replace(section_open, stage_open, 1)

    # Le premier </section> après l'ouverture est celui du dialogue.
    start = text.find(stage_open)
    end = text.find('</section>', start)
    if end < 0:
        raise RuntimeError("fermeture </section> du modal introuvable")
    text = text[:end + len('</section>')] + '\n      </div>' + text[end + len('</section>'):]

    # 3) Ajouter seulement la mise en page nécessaire à la mascotte et à la croix.
    #    Le bouton garde intégralement le style .trip-panel-close du site.
    style_end = "    `;\n    document.head.appendChild(style);"
    if text.count(style_end) != 1:
        raise RuntimeError("fin du bloc CSS du dialogue introuvable")
    css = r'''
      /* LB_COMMUNITY_SIGNAL_DIALOG_COW_V7 */
      .lb-signal-dialog-stage{
        --lb-signal-cow-size:clamp(250px,34vw,350px);
        position:relative;
        box-sizing:border-box;
        width:min(520px,calc(100vw - 28px));
        padding-top:var(--lb-signal-cow-size);
      }
      .lb-signal-dialog-mascot{
        position:absolute;
        left:50%;
        top:0;
        z-index:5;
        display:block;
        width:var(--lb-signal-cow-size);
        max-width:none;
        height:auto;
        transform:translateX(-50%);
        pointer-events:none;
        user-select:none;
        -webkit-user-drag:none;
        filter:drop-shadow(0 10px 18px rgba(0,0,0,.34));
      }
      .lb-signal-dialog-stage>.lb-signal-dialog-card{
        position:relative!important;
        z-index:3;
        width:100%!important;
        max-height:calc(100vh - var(--lb-signal-cow-size) - 40px)!important;
      }
      .lb-signal-dialog-head{
        position:absolute!important;
        top:10px!important;
        right:10px!important;
        z-index:20!important;
        display:block!important;
        padding:0!important;
        margin:0!important;
        border:0!important;
        background:transparent!important;
      }
      .lb-signal-dialog-head>.trip-panel-close{margin:0!important}
      .lb-signal-dialog-info{margin-right:42px!important}

      @media(max-height:700px) and (min-width:701px){
        .lb-signal-dialog-stage{--lb-signal-cow-size:clamp(220px,28vw,275px)}
      }
      @media(max-width:700px),(pointer:coarse){
        .lb-signal-dialog-stage{
          --lb-signal-cow-size:clamp(205px,62vw,270px);
          width:100%;
          padding-left:10px;
          padding-right:10px;
        }
        .lb-signal-dialog-stage>.lb-signal-dialog-card{
          width:100%!important;
          max-height:calc(100vh - var(--lb-signal-cow-size) - 8px)!important;
        }
        .lb-signal-dialog-head{top:9px!important;right:19px!important}
        .lb-signal-dialog-info{margin-right:40px!important}
      }
'''
    text = text.replace(style_end, css + style_end, 1)

    # L'ancien CSS de head-main peut rester sans effet, mais aucun texte ne doit subsister dans le template.
    forbidden = [
        '>Signalement voyageur · NON OFFICIEL<',
        '>Retard communautaire<',
        '>Chaque signalement est noté séparément.',
    ]
    for token in forbidden:
        if token in text:
            raise RuntimeError(f"texte supérieur encore présent après patch : {token}")

    if text.count('class="lb-signal-dialog-mascot"') != 1:
        raise RuntimeError("mascotte doit être présente exactement une fois")
    if text.count('class="trip-panel-close lb-signal-dialog-close"') != 1:
        raise RuntimeError("croix standard doit rester présente exactement une fois")
    if "closest('.lb-signal-dialog-close')" not in text and 'closest(".lb-signal-dialog-close")' not in text:
        raise RuntimeError("handler de fermeture perdu")

    return text


def patch_core(text: str) -> str:
    version = "20260910-signal-dialog-cow-v7"
    pat = re.compile(r'(lb-community-signal-dialog-v1\.js\?v=)[^"\']+')
    new, n = pat.subn(r'\g<1>' + version, text)
    if n != 1:
        raise RuntimeError(f"core : référence dialogue attendue 1 fois, trouvée {n}")
    return new


def main() -> None:
    ap = argparse.ArgumentParser(description="Intègre la vache #BER au modal communautaire sans ajouter de texte")
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

    print("MODAL VOIX DU BETAIL — VACHE #BER V7 VERIFIEE :")
    print("  ✓ la vache fournie est intégrée au-dessus du modal")
    print("  ✓ elle chevauche visuellement le bord supérieur, sans déplacer les boutons")
    print("  ✓ SUPPRIMÉ : 'Signalement voyageur · NON OFFICIEL'")
    print("  ✓ SUPPRIMÉ : 'Retard communautaire'")
    print("  ✓ SUPPRIMÉ : le sous-titre ajouté au-dessus")
    print("  ✓ la phrase d'avertissement SNCF/CFL dans le contenu reste présente")
    print("  ✓ la croix standard du site reste seule en haut à droite")
    print("  ✓ Modifier / Supprimer / votes / API inchangés")
    print("  ✓ comportement mobile prévu avec mascotte réduite")
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
    backup = Path(args.root) / "map-v2/backups" / ("community-signal-dialog-cow-v7-" + stamp)
    backup.mkdir(parents=True, exist_ok=False)
    shutil.copy2(dialog, backup / dialog.name)
    shutil.copy2(core, backup / core.name)
    if cow.exists():
        shutil.copy2(cow, backup / cow.name)

    changed: list[tuple[Path, bytes | None]] = []
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
                try: path.unlink()
                except FileNotFoundError: pass
            else:
                atomic_write(path, data)
        print("ERREUR : rollback automatique effectué.")
        raise

    print("INSTALLÉ — mascotte + présentation du modal uniquement.")
    print("Sauvegarde :", backup)
    print("Recharge la carte puis clique sur un retard voyageur.")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        raise SystemExit("ARRÊT : " + str(exc))
