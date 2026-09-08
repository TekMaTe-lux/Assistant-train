#!/usr/bin/env bash
set -euo pipefail

ROOT="${MOORAIL_ROOT:-/opt/labetaillere-map-v2-src/map-v2}"
FILE="$ROOT/public/moorail-route-editor.html"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$ROOT/backups/route-editor-v1g-$STAMP"
TMP="$(mktemp -d /tmp/moorail-v1g.XXXXXX)"
PATCH_URL="https://raw.githubusercontent.com/TekMaTe-lux/Assistant-train/main/vps/map-v2/route-editor/patch-moorail-route-editor-v1g.py"
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
if grep -q 'V1E · DIRECT DRAG' "$FILE"; then
  echo 'V1E · DIRECT DRAG'
elif grep -q 'MOORAIL_SWITCH_EDITOR_V1G' "$FILE"; then
  echo 'V1G déjà installée'
else
  echo 'variante V1D/V1E compatible à vérifier'
fi

curl -fsSL "$PATCH_URL?$(date +%s)" -o "$TMP/patch.py"
python3 -m py_compile "$TMP/patch.py"
python3 "$TMP/patch.py" "$TMP/editor.html"

python3 - "$TMP/editor.html" "$TMP/editor.js" <<'PY'
from pathlib import Path
import re,sys
s=Path(sys.argv[1]).read_text(encoding='utf-8')
required=[
  'V1G · AIGUILLAGES',
  'MOORAIL_SWITCH_EDITOR_V1G',
  'showJunctionBranches',
  'chooseJunctionBranch',
  'makeExactNodeAnchor',
  'nearestJunctionForSnap',
  "junctionRole:'entry'",
  "junctionRole:'exit'",
]
missing=[x for x in required if x not in s]
if missing:
    raise SystemExit('ERREUR V1G incomplète: '+', '.join(missing))
scripts=re.findall(r'<script(?: [^>]*)?>(.*?)</script>',s,re.S)
if not scripts:
    raise SystemExit('ERREUR: script inline introuvable')
Path(sys.argv[2]).write_text(scripts[-1],encoding='utf-8')
print('Précontrôle fonctions V1G : OK')
PY
node --check "$TMP/editor.js"

echo "Précontrôle JavaScript : OK"
install -o root -g root -m 0644 "$TMP/editor.html" "$FILE"

curl -fsS --max-time 5 \
  "http://127.0.0.1:3111/moorail-route-editor.html?t=$(date +%s)" \
  -o "$TMP/served.html"

grep -q 'MOORAIL_SWITCH_EDITOR_V1G' "$TMP/served.html"
grep -q 'V1G · AIGUILLAGES' "$TMP/served.html"

curl -fsS --max-time 3 \
  http://127.0.0.1:3111/api/map-v2/health \
  -o "$TMP/health.json"
python3 - "$TMP/health.json" <<'PY'
import json,sys
d=json.load(open(sys.argv[1],encoding='utf-8'))
assert d.get('ok') is True,d
print('Map V2 health : OK',d)
PY

SUCCESS=1

echo
echo "============================================================"
echo " MOO RAIL ROUTE EDITOR V1G — AIGUILLAGES OK"
echo "============================================================"
echo "Page   : https://vps.labetaillere.fr/map-v2/moorail-route-editor.html"
echo "Backup : $BACKUP/moorail-route-editor.html"
echo
echo "Nouveau fonctionnement :"
echo "  1. clique un nœud violet"
echo "  2. les branches du nœud deviennent jaunes"
echo "  3. clique d'abord la branche D'OÙ VIENT le train"
echo "  4. clique ensuite la branche OÙ IL REPART"
echo "  5. l'éditeur crée Entrée -> Nœud -> Sortie comme contrainte topologique"
echo "  6. déposer le cyan près d'un aiguillage ouvre aussi ce sélecteur"
echo
echo "Aucune modification du moteur de production n'est appliquée par ce patch."
