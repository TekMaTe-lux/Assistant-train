#!/usr/bin/env python3
"""Reserve mobile space for La Voix du Bétail in the map trip sheet.

Dry-run by default. With --apply, only carte-core-preview.html is changed.
No GTFS, routing, service, community business logic, or vote API is modified.
The installed vote module is checked before any write so the patch cannot hide
or regress the thumbs added by LB_MAP_VOTES_SYNC_V2.
"""
from __future__ import annotations

import argparse
import hashlib
import os
from pathlib import Path
import shutil
import tempfile
from datetime import datetime, timezone

MARK = "LB_MAP_MOBILE_COMMUNITY_SPACE_V1"
STYLE_ID = "lb-map-mobile-community-space-v1"

CSS = r'''<style id="lb-map-mobile-community-space-v1">
/* LB_MAP_MOBILE_COMMUNITY_SPACE_V1
   Mobile only: fixed/header/community rows keep their natural height.
   The stop timeline is the only large zone allowed to shrink and scroll. */
@media (max-width:700px), (pointer:coarse){
  html body .trip-panel:not(.station-board-mode) > .trip-panel-header,
  html body .trip-panel:not(.station-board-mode) > .trip-panel-summary,
  html body .trip-panel:not(.station-board-mode) > .trip-panel-delay,
  html body .trip-panel:not(.station-board-mode) > .trip-panel-disruption,
  html body .trip-panel:not(.station-board-mode) > .trip-progress,
  html body .trip-panel:not(.station-board-mode) > .trip-stops-title{
    flex:0 0 auto!important;
  }

  html body .trip-panel:not(.station-board-mode) #lb-map-trip-community{
    flex:0 0 auto!important;
    box-sizing:border-box!important;
    width:100%!important;
    min-height:62px!important;
    height:auto!important;
    max-height:none!important;
    overflow:visible!important;
    grid-template-areas:'title status actions' 'source source source'!important;
    grid-template-rows:minmax(25px,auto) minmax(30px,auto)!important;
    align-content:center!important;
  }

  html body .trip-panel:not(.station-board-mode) #lb-map-trip-community .lb-community-status-line,
  html body .trip-panel:not(.station-board-mode) #lb-map-trip-community .lb-map-trip-community-actions{
    min-height:25px!important;
  }

  html body .trip-panel:not(.station-board-mode) #lb-map-trip-community .lb-community-source-line{
    box-sizing:border-box!important;
    width:100%!important;
    max-width:100%!important;
    min-height:30px!important;
    overflow:visible!important;
  }

  html body .trip-panel:not(.station-board-mode) #lb-map-trip-community .lb-community-source-line.lb-community-source-line--votes{
    display:grid!important;
    grid-template-columns:minmax(0,1fr) auto!important;
    align-items:center!important;
    column-gap:5px!important;
    padding-top:1px!important;
  }

  html body .trip-panel:not(.station-board-mode) #lb-map-trip-community .lb-community-source-label{
    min-width:0!important;
    overflow:hidden!important;
    text-overflow:ellipsis!important;
    white-space:nowrap!important;
  }

  /* Touch targets explicitly preserved on phones. */
  html body .trip-panel:not(.station-board-mode) #lb-map-trip-community .lb-community-map-votes{
    display:inline-flex!important;
    visibility:visible!important;
    opacity:1!important;
    position:relative!important;
    z-index:8!important;
    flex:0 0 auto!important;
    min-width:73px!important;
    height:30px!important;
    padding:0 2px!important;
    gap:1px!important;
    overflow:visible!important;
  }
  html body .trip-panel:not(.station-board-mode) #lb-map-trip-community .lb-community-map-vote-btn{
    display:inline-flex!important;
    visibility:visible!important;
    opacity:1!important;
    align-items:center!important;
    justify-content:center!important;
    width:28px!important;
    min-width:28px!important;
    height:28px!important;
    min-height:28px!important;
    font-size:13px!important;
    line-height:28px!important;
    padding:0!important;
  }
  html body .trip-panel:not(.station-board-mode) #lb-map-trip-community .lb-community-map-vote-count{
    display:inline-flex!important;
    align-items:center!important;
    justify-content:center!important;
    min-width:11px!important;
    font-size:9px!important;
    line-height:1!important;
  }

  /* The timeline gives up space first and remains scrollable. */
  html body .trip-panel:not(.station-board-mode) #trip-stops,
  html body .trip-panel:not(.station-board-mode) .trip-stops.lb-site-train-sheet-v2{
    flex:1 1 0!important;
    min-height:0!important;
    overflow-y:auto!important;
    overflow-x:hidden!important;
  }
}

@media (max-width:380px){
  html body .trip-panel:not(.station-board-mode) #lb-map-trip-community{
    min-height:60px!important;
    grid-template-rows:minmax(24px,auto) minmax(30px,auto)!important;
  }
  html body .trip-panel:not(.station-board-mode) #lb-map-trip-community .lb-community-source-line.lb-community-source-line--votes{
    column-gap:3px!important;
  }
}
</style>'''


def atomic_write(path: Path, data: bytes) -> None:
    stat = path.stat()
    fd, temporary = tempfile.mkstemp(prefix=path.name + ".tmp-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as out:
            out.write(data)
            out.flush()
            os.fsync(out.fileno())
        os.chmod(temporary, stat.st_mode & 0o7777)
        if os.geteuid() == 0:
            os.chown(temporary, stat.st_uid, stat.st_gid)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def verify_votes(votes: str, core: str) -> None:
    required = [
        "lb-community-map-vote-btn",
        "lb-community-map-votes",
        "data-lb-map-delay-vote",
        "method:'POST'",
        "'👍'",
        "'👎'",
    ]
    missing = [x for x in required if x not in votes]
    if missing:
        raise RuntimeError("module de votes incomplet : " + ", ".join(missing))

    # V2 is the installed mobile fix used on production. It raises both mobile
    # thumb targets to 28 px and keeps the vote row present while the signal id
    # is being resolved. Refuse to layer this layout fix on an older copy.
    if "LB_MAP_VOTES_SYNC_V2" not in core:
        raise RuntimeError("LB_MAP_VOTES_SYNC_V2 absent du core : ne pas empiler sur une ancienne carte")
    if votes.count("width:28px!important") < 2:
        raise RuntimeError("pouces mobiles 28 px absents : votes-sync-v2 n'est pas réellement installé")
    if "height:30px!important" not in votes:
        raise RuntimeError("ligne de votes mobile 30 px absente")
    if "visibility:visible!important" not in votes or "opacity:1!important" not in votes:
        raise RuntimeError("visibilité explicite des pouces absente")


def prepare(core: str) -> str:
    if MARK in core or f'id="{STYLE_ID}"' in core:
        return core
    if "</head>" not in core:
        raise RuntimeError("balise </head> introuvable")
    return core.replace("</head>", CSS + "\n</head>", 1)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", default=os.environ.get("LB_MAP_ROOT", "/opt/labetaillere-map-v2-src"))
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    root = Path(args.root)
    public = root / "map-v2/public"
    core_path = public / "carte-core-preview.html"
    votes_path = public / "assets/lb-community-traveler-vote-v3.js"

    for path in (core_path, votes_path):
        if not path.is_file():
            raise RuntimeError(f"fichier absent : {path}")

    before = core_path.read_bytes()
    core = before.decode("utf-8")
    votes = votes_path.read_text(encoding="utf-8")

    verify_votes(votes, core)
    after_text = prepare(core)
    after = after_text.encode("utf-8")

    print("Vérification mobile :")
    print("  ✓ Voix du Bétail : zone protégée contre flex-shrink")
    print("  ✓ Timeline : reste la zone scrollable qui absorbe le manque de hauteur")
    print("  ✓ Pouce haut : présent, cible tactile 28 px")
    print("  ✓ Pouce bas  : présent, cible tactile 28 px")
    print("  ✓ Ligne votes : 30 px, visible et non masquée")
    print("  ✓ Aucun routage/GTFS/API vote modifié")

    if after == before:
        print("Correctif déjà installé. Aucun changement.")
        return

    if not args.apply:
        print("SIMULATION OK : aucun fichier modifié. Ajouter --apply pour installer.")
        return

    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S-%f")
    backup_dir = root / "map-v2/backups" / ("mobile-community-space-v1-" + stamp)
    backup_dir.mkdir(parents=True, exist_ok=False)
    backup = backup_dir / core_path.name
    shutil.copy2(core_path, backup)

    if core_path.read_bytes() != before:
        raise RuntimeError("carte modifiée pendant la vérification : aucune écriture")

    try:
        atomic_write(core_path, after)
        installed = core_path.read_text(encoding="utf-8")
        if MARK not in installed or f'id="{STYLE_ID}"' not in installed:
            raise RuntimeError("contrôle après écriture échoué")
    except BaseException:
        atomic_write(core_path, backup.read_bytes())
        print("ERREUR : carte restaurée automatiquement.")
        raise

    print("INSTALLÉ — core HTML uniquement, aucun service redémarré.")
    print("Sauvegarde :", backup_dir)
    print("SHA256 :", hashlib.sha256(core_path.read_bytes()).hexdigest())
    print("Recharge ensuite la carte sur téléphone (fermer/réouvrir la fiche si elle était déjà ouverte).")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        raise SystemExit("ARRÊT : " + str(error))
