#!/usr/bin/env bash
set -euo pipefail
ROOT="${MOORAIL_ROOT:-/opt/labetaillere-map-v2-src/map-v2}"
PUBLIC="$ROOT/public"
TARGET="$PUBLIC/moorail-route-editor.html"
PAGE="$PUBLIC/moorail-route-editor-stops.html"
JS="$PUBLIC/moorail-route-editor-stops.js"
RFN="$PUBLIC/data/moorail-rfn-game-v2/manifest.json"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$ROOT/backups/route-editor-stops-v3-$STAMP"
TMP="$(mktemp -d /tmp/moorail-stops-v3.XXXXXX)"
BASE="https://raw.githubusercontent.com/TekMaTe-lux/Assistant-train/main/vps/map-v2/route-editor/v3"
SUCCESS=0
cleanup(){ rm -rf "$TMP"; }
rollback(){
  if [ "$SUCCESS" = 1 ]; then return; fi
  echo "ROLLBACK STOP-TO-STOP V3..." >&2
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
echo " MOO RAIL ROUTE EDITOR V3 — ARRÊT -> ARRÊT"
echo " Origine / arrêts / terminus GTFS fixes"
echo " Points intermédiaires uniquement si besoin"
echo "============================================================"
echo "Backup : $BACKUP"

curl -fsSL "$BASE/moorail-route-editor-stops.html?$STAMP" -o "$TMP/page.html"
curl -fsSL "$BASE/moorail-route-editor-stops.js?$STAMP" -o "$TMP/editor.js"

grep -q 'V3 · ARRÊT → ARRÊT' "$TMP/page.html"
grep -q "const RFN='/map-v2/data/moorail-rfn-game-v2'" "$TMP/editor.js"
grep -q '/route-editor/catalog' "$TMP/editor.js"
grep -q 'waypoints' "$TMP/editor.js"
grep -q 'MOORAIL_STOP_TO_STOP_V3' "$TMP/editor.js"
node --check "$TMP/editor.js"

install -o root -g root -m 0644 "$TMP/page.html" "$PAGE"
install -o root -g root -m 0644 "$TMP/page.html" "$TARGET"
install -o root -g root -m 0644 "$TMP/editor.js" "$JS"

curl -fsS --max-time 5 "http://127.0.0.1:3111/moorail-route-editor.html?v=$STAMP" -o "$TMP/served.html"
curl -fsS --max-time 5 "http://127.0.0.1:3111/moorail-route-editor-stops.js?v=$STAMP" -o "$TMP/served.js"
curl -fsS --max-time 5 "http://127.0.0.1:3111/data/moorail-rfn-game-v2/manifest.json?v=$STAMP" -o "$TMP/manifest.json"
curl -fsS --max-time 5 "http://127.0.0.1:3111/api/map-v2/route-editor/catalog" -o "$TMP/catalog.json"
grep -q 'V3 · ARRÊT → ARRÊT' "$TMP/served.html"
grep -q 'MOORAIL_STOP_TO_STOP_V3' "$TMP/served.js"
python3 - "$TMP/manifest.json" "$TMP/catalog.json" <<'PY'
import json,sys
m=json.load(open(sys.argv[1],encoding='utf-8')); c=json.load(open(sys.argv[2],encoding='utf-8'))
assert int(m.get('features') or 0)>=8500,m
assert c.get('ok') is True,c
assert len(c.get('routes') or [])>0,c
print('RFN:',m.get('features'),'objets / catalogue:',len(c.get('routes') or []),'variantes')
PY
curl -fsS --max-time 3 http://127.0.0.1:3111/api/map-v2/health > "$TMP/health.json"
python3 - "$TMP/health.json" <<'PY'
import json,sys
h=json.load(open(sys.argv[1],encoding='utf-8'));assert h.get('ok') is True,h;print('Map V2 health OK:',h)
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

echo
echo "============================================================"
echo " V3 ARRÊT -> ARRÊT INSTALLEE"
echo "============================================================"
echo "Page   : https://vps.labetaillere.fr/map-v2/moorail-route-editor.html"
echo "Backup : $BACKUP"
echo
echo "Principe :"
echo " - origine / arrêts / terminus lus automatiquement du GTFS"
echo " - chaque paire d'arrêts forme une étape"
echo " - départ et arrivée sont fixes"
echo " - clic carte = point de passage obligatoire optionnel"
echo " - le RFN détaillé calcule automatiquement entre les points"
echo " - validation sauvegardée via l'API Route Editor"
