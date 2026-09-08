#!/usr/bin/env bash
set -euo pipefail
ROOT="${MOORAIL_ROOT:-/opt/labetaillere-map-v2-src/map-v2}"
PUBLIC="$ROOT/public"
TARGET="$PUBLIC/moorail-route-editor.html"
PAGE="$PUBLIC/moorail-route-editor-stops.html"
JS="$PUBLIC/moorail-route-editor-stops.js"
RFN="$PUBLIC/data/moorail-rfn-game-v2/manifest.json"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$ROOT/backups/route-editor-stops-v3_1-$STAMP"
TMP="$(mktemp -d /tmp/moorail-stops-v31.XXXXXX)"
BASE="https://raw.githubusercontent.com/TekMaTe-lux/Assistant-train/main/vps/map-v2/route-editor/v3"
SUCCESS=0

cleanup(){ rm -rf "$TMP"; }
rollback(){
  if [ "$SUCCESS" = 1 ]; then return; fi
  echo "ROLLBACK STOP-TO-STOP V3.1..." >&2
  [ ! -f "$BACKUP/moorail-route-editor.html" ] || cp -a "$BACKUP/moorail-route-editor.html" "$TARGET"
  [ ! -f "$BACKUP/moorail-route-editor-stops.html" ] || cp -a "$BACKUP/moorail-route-editor-stops.html" "$PAGE"
  [ ! -f "$BACKUP/moorail-route-editor-stops.js" ] || cp -a "$BACKUP/moorail-route-editor-stops.js" "$JS"
}
finish(){ rc=$?; trap - EXIT; rollback; cleanup; exit "$rc"; }
trap finish EXIT

[ "${EUID:-$(id -u)}" -eq 0 ] || { echo "ERREUR: lancer avec sudo/root" >&2; exit 2; }
[ -f "$RFN" ] || { echo "ERREUR: RFN détaillé canonique absent: $RFN" >&2; exit 3; }
mkdir -p "$BACKUP"
for f in "$TARGET" "$PAGE" "$JS"; do [ ! -f "$f" ] || cp -a "$f" "$BACKUP/$(basename "$f")"; done

echo "============================================================"
echo " MOO RAIL ROUTE EDITOR V3.1 — ARRÊT -> ARRÊT"
echo " Origine / arrêts / terminus GTFS fixes"
echo " Points intermédiaires uniquement si besoin"
echo "============================================================"
echo "Backup : $BACKUP"

echo "=== 1/4 Téléchargement de la V3 ==="
curl -fsSL "$BASE/moorail-route-editor-stops.html?$STAMP" -o "$TMP/page.html"
curl -fsSL "$BASE/moorail-route-editor-stops.js?$STAMP" -o "$TMP/editor.js"

echo "=== 2/4 Contrôles fonctionnels avant installation ==="
python3 - "$TMP/page.html" "$TMP/editor.js" <<'PY'
from pathlib import Path
import sys
html=Path(sys.argv[1]).read_text(encoding='utf-8')
js=Path(sys.argv[2]).read_text(encoding='utf-8')
checks={
  'badge V3': 'V3 · ARRÊT → ARRÊT' in html,
  'RFN canonique': "const RFN='/map-v2/data/moorail-rfn-game-v2'" in js,
  'API route editor': "const API='/api/map-v2/route-editor'" in js,
  'catalogue': '/catalog' in js,
  'état serveur': '/state' in js,
  'points de passage': 'state.via' in js and 'addVia' in js,
  'projection RFN': 'projectToSeg' in js and 'anchorAt' in js,
  'routage': 'shortestPath' in js,
  'validation': 'validateLeg' in js,
  'source validation': 'MOORAIL_STOP_TO_STOP_V3' in js,
}
for k,v in checks.items(): print(f"  {'OK' if v else 'ERREUR'} {k}")
missing=[k for k,v in checks.items() if not v]
if missing: raise SystemExit('Contrôles manquants: '+', '.join(missing))
PY
node --check "$TMP/editor.js"

install -o root -g root -m 0644 "$TMP/page.html" "$PAGE"
install -o root -g root -m 0644 "$TMP/page.html" "$TARGET"
install -o root -g root -m 0644 "$TMP/editor.js" "$JS"

echo "=== 3/4 Contrôle via Map V2 ==="
curl -fsS --max-time 5 "http://127.0.0.1:3111/moorail-route-editor.html?v=$STAMP" -o "$TMP/served.html"
curl -fsS --max-time 5 "http://127.0.0.1:3111/moorail-route-editor-stops.js?v=$STAMP" -o "$TMP/served.js"
curl -fsS --max-time 5 "http://127.0.0.1:3111/data/moorail-rfn-game-v2/manifest.json?v=$STAMP" -o "$TMP/manifest.json"
curl -fsS --max-time 5 "http://127.0.0.1:3111/api/map-v2/route-editor/catalog" -o "$TMP/catalog.json"
curl -fsS --max-time 3 "http://127.0.0.1:3111/api/map-v2/health" -o "$TMP/health.json"

python3 - "$TMP/served.html" "$TMP/served.js" "$TMP/manifest.json" "$TMP/catalog.json" "$TMP/health.json" <<'PY'
from pathlib import Path
import json,sys
html=Path(sys.argv[1]).read_text(encoding='utf-8')
js=Path(sys.argv[2]).read_text(encoding='utf-8')
m=json.load(open(sys.argv[3],encoding='utf-8'))
c=json.load(open(sys.argv[4],encoding='utf-8'))
h=json.load(open(sys.argv[5],encoding='utf-8'))
assert 'V3 · ARRÊT → ARRÊT' in html
assert 'MOORAIL_STOP_TO_STOP_V3' in js
assert int(m.get('features') or 0)>=8500,m
assert c.get('ok') is True and len(c.get('routes') or [])>0,c
assert h.get('ok') is True,h
print('Page V3 servie : OK')
print('RFN détaillé   :',m.get('features'),'objets')
print('Catalogue TGV  :',len(c.get('routes') or []),'variantes')
print('Map V2 health  : OK')
PY

SUCCESS=1
cat > "$BACKUP/ROLLBACK.sh" <<EOF
#!/usr/bin/env bash
set -euo pipefail
[ ! -f '$BACKUP/moorail-route-editor.html' ] || cp -a '$BACKUP/moorail-route-editor.html' '$TARGET'
[ ! -f '$BACKUP/moorail-route-editor-stops.html' ] || cp -a '$BACKUP/moorail-route-editor-stops.html' '$PAGE'
[ ! -f '$BACKUP/moorail-route-editor-stops.js' ] || cp -a '$BACKUP/moorail-route-editor-stops.js' '$JS'
EOF
chmod 0755 "$BACKUP/ROLLBACK.sh"

echo "=== 4/4 TERMINE ==="
echo
echo "============================================================"
echo " V3.1 ARRÊT -> ARRÊT INSTALLEE"
echo "============================================================"
echo "Page   : https://vps.labetaillere.fr/map-v2/moorail-route-editor.html"
echo "Backup : $BACKUP"
echo
echo "Principe :"
echo " - origine / arrêts / terminus GTFS automatiquement fixes"
echo " - chaque paire d'arrêts = une étape"
echo " - aucun clic nécessaire si le chemin automatique est bon"
echo " - clic carte = passage obligatoire uniquement si besoin"
echo " - point jaune déplaçable"
echo " - validation étape par étape"
