#!/usr/bin/env bash
set -euo pipefail

ROOT="${MOORAIL_ROOT:-/opt/labetaillere-map-v2-src/map-v2}"
FILE="$ROOT/public/moorail-route-editor.html"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$ROOT/backups/route-editor-v1h-$STAMP"
TMP="$(mktemp -d /tmp/moorail-v1h.XXXXXX)"
PATCH_URL="https://raw.githubusercontent.com/TekMaTe-lux/Assistant-train/main/vps/map-v2/route-editor/patch-moorail-route-editor-v1h.py"
SUCCESS=0

finish(){
  rc=$?
  trap - EXIT
  if [ "$SUCCESS" != "1" ] && [ -f "$BACKUP/moorail-route-editor.html" ]; then
    cp -a "$BACKUP/moorail-route-editor.html" "$FILE" || true
    echo "Rollback HTML effectué."
  fi
  rm -rf "$TMP"
  exit "$rc"
}
trap finish EXIT

[ -f "$FILE" ] || { echo "ERREUR: $FILE introuvable" >&2; exit 1; }
mkdir -p "$BACKUP"
cp -a "$FILE" "$BACKUP/moorail-route-editor.html"
cp -a "$FILE" "$TMP/editor.html"

printf 'Version détectée : '
if grep -q 'MOORAIL_FORCED_SWITCH_TRANSITION_V1H' "$FILE"; then
  echo 'V1H déjà installée'
elif grep -q 'MOORAIL_SWITCH_EDITOR_V1G' "$FILE"; then
  echo 'V1G · AIGUILLAGES'
else
  echo 'ERREUR: V1G requise' >&2
  exit 2
fi

curl -fsSL "$PATCH_URL?$(date +%s)" -o "$TMP/patch.py"
python3 -m py_compile "$TMP/patch.py"
python3 "$TMP/patch.py" "$TMP/editor.html"

python3 - "$TMP/editor.html" "$TMP/editor.js" <<'PY'
from pathlib import Path
import re,sys
s=Path(sys.argv[1]).read_text(encoding='utf-8')
required=[
  'V1H · TRANSITIONS',
  'MOORAIL_FORCED_SWITCH_TRANSITION_V1H',
  'buildRouteWithForcedSwitches',
  'exactOuterNodeAnchor',
  'forcedSwitchPiece',
  'isJunctionTriple',
]
missing=[x for x in required if x not in s]
if missing:
    raise SystemExit('ERREUR V1H incomplète: '+', '.join(missing))
scripts=re.findall(r'<script(?: [^>]*)?>(.*?)</script>',s,re.S)
if not scripts:
    raise SystemExit('ERREUR: script inline introuvable')
Path(sys.argv[2]).write_text(scripts[-1],encoding='utf-8')
print('Précontrôle fonctions V1H : OK')
PY
node --check "$TMP/editor.js"
echo "Précontrôle JavaScript : OK"

install -o root -g root -m 0644 "$TMP/editor.html" "$FILE"

curl -fsS --max-time 5 \
  "http://127.0.0.1:3111/moorail-route-editor.html?t=$(date +%s)" \
  -o "$TMP/served.html"
grep -q 'MOORAIL_FORCED_SWITCH_TRANSITION_V1H' "$TMP/served.html"
grep -q 'V1H · TRANSITIONS' "$TMP/served.html"

curl -fsS --max-time 3 http://127.0.0.1:3111/api/map-v2/health -o "$TMP/health.json"
python3 - "$TMP/health.json" <<'PY'
import json,sys
d=json.load(open(sys.argv[1],encoding='utf-8'))
assert d.get('ok') is True,d
print('Map V2 health : OK',d)
PY

SUCCESS=1

echo
echo "============================================================"
echo " MOO RAIL ROUTE EDITOR V1H — TRANSITIONS FORCEES OK"
echo "============================================================"
echo "Page   : https://vps.labetaillere.fr/map-v2/moorail-route-editor.html"
echo "Backup : $BACKUP/moorail-route-editor.html"
echo
echo "Correction ciblée Vandières :"
echo " - le choix Entrée / Nœud / Sortie n'est plus recalculé par A*"
echo " - l'éditeur force physiquement le segment d'entrée jusqu'au nœud"
echo " - puis force physiquement le segment du nœud vers la sortie choisie"
echo " - A* ne travaille qu'avant l'entrée et après la sortie"
echo " - la transition imposée est surlignée jaune/orange dans le tracé"
echo " - aucune modification du moteur de production n'est appliquée"
