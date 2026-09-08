#!/usr/bin/env bash
set -euo pipefail
ROOT="${MOORAIL_ROOT:-/opt/labetaillere-map-v2-src/map-v2}"
PUBLIC="$ROOT/public"
TARGET="$PUBLIC/moorail-route-editor.html"
V2PAGE="$PUBLIC/moorail-tgv-game-v2.html"
JS="$PUBLIC/moorail-tgv-game-v2.js"
MANIFEST="$PUBLIC/data/rfn-detail-official-v1/manifest.json"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$ROOT/backups/tgv-game-v2-$STAMP"
TMP="$(mktemp -d /tmp/moorail-tgv-game-v2.XXXXXX)"
BASE="https://raw.githubusercontent.com/TekMaTe-lux/Assistant-train/main/vps/map-v2/route-editor/v2"
SUCCESS=0
cleanup(){ rm -rf "$TMP"; }
rollback(){ if [ "$SUCCESS" = 1 ]; then return; fi; echo "ROLLBACK TGV GAME V2..." >&2; [ ! -f "$BACKUP/moorail-route-editor.html" ] || cp -a "$BACKUP/moorail-route-editor.html" "$TARGET"; [ ! -f "$BACKUP/moorail-tgv-game-v2.html" ] || cp -a "$BACKUP/moorail-tgv-game-v2.html" "$V2PAGE"; [ ! -f "$BACKUP/moorail-tgv-game-v2.js" ] || cp -a "$BACKUP/moorail-tgv-game-v2.js" "$JS"; }
finish(){ rc=$?; trap - EXIT; rollback; cleanup; exit "$rc"; }; trap finish EXIT
[ "${EUID:-$(id -u)}" -eq 0 ] || { echo "ERREUR: lancer avec sudo/root" >&2; exit 2; }
[ -f "$MANIFEST" ] || { echo "ERREUR: RFN détaillé absent: $MANIFEST" >&2; echo "Installe d'abord le dataset détaillé que tu viens d'ajouter." >&2; exit 3; }
mkdir -p "$BACKUP"
for f in "$TARGET" "$V2PAGE" "$JS"; do [ ! -f "$f" ] || cp -a "$f" "$BACKUP/$(basename "$f")"; done
if [ -f "$TARGET" ] && [ ! -f "$PUBLIC/moorail-route-editor-v1-legacy.html" ]; then cp -a "$TARGET" "$PUBLIC/moorail-route-editor-v1-legacy.html"; fi
curl -fsSL "$BASE/moorail-tgv-game-v2.html?$STAMP" -o "$TMP/page.html"
curl -fsSL "$BASE/moorail-tgv-game-v2.js?$STAMP" -o "$TMP/game.js"
grep -q 'V2 · RFN DÉTAILLÉ' "$TMP/page.html"
grep -q 'tgv-lgv-est-paris-strasbourg' "$TMP/game.js"
grep -q 'pagny-lgv-nancy' "$TMP/game.js"
grep -q 'pagny-lgv-metz' "$TMP/game.js"
grep -q "mode==='transition'" "$TMP/game.js"
grep -q 'forbiddenSegments' "$TMP/game.js"
node --check "$TMP/game.js"
install -o root -g root -m 0644 "$TMP/page.html" "$V2PAGE"
install -o root -g root -m 0644 "$TMP/page.html" "$TARGET"
install -o root -g root -m 0644 "$TMP/game.js" "$JS"
curl -fsS --max-time 5 "http://127.0.0.1:3111/moorail-route-editor.html?v=$STAMP" -o "$TMP/served.html"
grep -q 'V2 · RFN DÉTAILLÉ' "$TMP/served.html"
curl -fsS --max-time 5 "http://127.0.0.1:3111/moorail-tgv-game-v2.js?v=$STAMP" -o "$TMP/served.js"
grep -q 'pagny-lgv-nancy' "$TMP/served.js"
curl -fsS --max-time 3 http://127.0.0.1:3111/api/map-v2/health > "$TMP/health.json"
python3 - "$TMP/health.json" "$MANIFEST" <<'PY'
import json,sys
h=json.load(open(sys.argv[1])); m=json.load(open(sys.argv[2])); assert h.get('ok') is True,h; assert m.get('features',0)>=9000,m; print('health OK:',h); print('RFN détaillé:',m.get('features'),'objets /',m.get('cells'),'cellules')
PY
SUCCESS=1
cat > "$BACKUP/ROLLBACK.sh" <<EOF2
#!/usr/bin/env bash
set -euo pipefail
[ ! -f '$BACKUP/moorail-route-editor.html' ] || cp -a '$BACKUP/moorail-route-editor.html' '$TARGET'
[ ! -f '$BACKUP/moorail-tgv-game-v2.html' ] || cp -a '$BACKUP/moorail-tgv-game-v2.html' '$V2PAGE'
[ ! -f '$BACKUP/moorail-tgv-game-v2.js' ] || cp -a '$BACKUP/moorail-tgv-game-v2.js' '$JS'
EOF2
chmod 0755 "$BACKUP/ROLLBACK.sh"
echo
echo "============================================================"
echo " MOO RAIL TGV GAME V2 — INSTALLE"
echo "============================================================"
echo "Page: https://vps.labetaillere.fr/map-v2/moorail-route-editor.html"
echo "Legacy: https://vps.labetaillere.fr/map-v2/moorail-route-editor-v1-legacy.html"
echo "Backup: $BACKUP"
echo
echo "Fonctions V2:"
echo " - peinture directe sur les voies RFN détaillées"
echo " - transition entrée -> sortie d'aiguillage"
echo " - voies interdites par famille TGV"
echo " - sections/corridors réutilisables"
echo " - missions Paris-Strasbourg, Paris-Nancy, Paris-Metz/Lux"
echo " - création de nouvelles missions et sections"
echo " - sauvegarde via l'API Route Editor existante"
