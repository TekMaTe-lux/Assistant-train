#!/usr/bin/env bash
set -euo pipefail

ROOT="${MOORAIL_ROOT:-/opt/labetaillere-map-v2-src/map-v2}"
FILE="$ROOT/public/moorail-route-editor.html"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$ROOT/backups/route-editor-v1f-$STAMP"
TMP="$(mktemp -d /tmp/moorail-v1f.XXXXXX)"
PATCH_URL="https://raw.githubusercontent.com/TekMaTe-lux/Assistant-train/main/vps/map-v2/route-editor/patch-moorail-route-editor-v1f.py"
SUCCESS=0

cleanup(){ rm -rf "$TMP"; }
rollback(){
  if [ "$SUCCESS" = "1" ]; then return; fi
  if [ -f "$BACKUP/moorail-route-editor.html" ]; then
    cp -a "$BACKUP/moorail-route-editor.html" "$FILE" || true
    echo "Rollback HTML effectué."
  fi
}
trap 'rollback; cleanup' EXIT

[ -f "$FILE" ] || { echo "ERREUR: $FILE introuvable" >&2; exit 1; }
mkdir -p "$BACKUP"
cp -a "$FILE" "$BACKUP/moorail-route-editor.html"
cp -a "$FILE" "$TMP/editor.html"

curl -fsSL "$PATCH_URL?$(date +%s)" -o "$TMP/patch.py"
python3 -m py_compile "$TMP/patch.py"
python3 "$TMP/patch.py" "$TMP/editor.html"

python3 - "$TMP/editor.html" "$TMP/editor.js" <<'PY'
from pathlib import Path
import re,sys
s=Path(sys.argv[1]).read_text(encoding='utf-8')
required=[
  'V1F · AIGUILLAGES',
  'MOORAIL_BRANCH_LOCK_V1F',
  'showJunctionBranches',
  'planConstrainedRoute',
  'forceSegment',
  'junctionKey'
]
missing=[x for x in required if x not in s]
if missing:
  raise SystemExit('ERREUR V1F incomplète: '+', '.join(missing))
scripts=re.findall(r'<script(?: [^>]*)?>(.*?)</script>',s,re.S)
if not scripts:
  raise SystemExit('ERREUR: script inline introuvable')
Path(sys.argv[2]).write_text(scripts[-1],encoding='utf-8')
PY

node --check "$TMP/editor.js"
install -m 0644 "$TMP/editor.html" "$FILE"

curl -fsS --max-time 5 \
  http://127.0.0.1:3111/moorail-route-editor.html \
  -o "$TMP/served.html"
grep -q 'MOORAIL_BRANCH_LOCK_V1F' "$TMP/served.html"
grep -q 'V1F · AIGUILLAGES' "$TMP/served.html"

SUCCESS=1

echo
echo "============================================================"
echo " MOO RAIL ROUTE EDITOR V1F — AIGUILLAGES OK"
echo "============================================================"
echo "Page   : https://vps.labetaillere.fr/map-v2/moorail-route-editor.html"
echo "Backup : $BACKUP/moorail-route-editor.html"
echo
echo "Correction du bug visible sur ta capture :"
echo " - les choix 5/6 ne doivent plus s'empiler au même noeud"
echo " - un aiguillage n'est plus seulement un point géographique"
echo " - la BRANCHE RFN choisie est verrouillée dans le calcul"
echo " - cliquer un noeud violet affiche ses branches en jaune"
echo " - cliquer une branche remplace le choix précédent au même aiguillage"
echo " - tirer le cyan sur un rail impose également ce segment"
