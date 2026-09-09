#!/usr/bin/env bash
set -euo pipefail

ROOT="${MOORAIL_ROOT:-/opt/labetaillere-map-v2-src/map-v2}"
PUBLIC="$ROOT/public"
HTML="$PUBLIC/france-v3-preview.html"
COMPILER="$ROOT/scripts/compile-moorail-validations-v2.py"
TRIPS="$ROOT/data/generated/trips.json"
PATHS="$ROOT/data/generated/paths.json"
STATE="$ROOT/data/route-editor/moorail-route-editor-state-v1.json"
SERVER="$ROOT/server/server.mjs"
SERVICE="labetaillere-map-v2.service"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$ROOT/backups/moorail-v11_6-current-engine-$STAMP"
TMP="$(mktemp -d /tmp/moorail-v116.XXXXXX)"
SUCCESS=0
CHANGED=0

cleanup(){ rm -rf "$TMP"; }
rollback(){
  [[ "$SUCCESS" == 1 ]] && return 0
  echo "ROLLBACK MOO RAIL V11.6..." >&2
  [[ -f "$BACKUP/france-v3-preview.html" ]] && cp -a "$BACKUP/france-v3-preview.html" "$HTML" || true
  [[ -f "$BACKUP/trips.json" ]] && cp -a "$BACKUP/trips.json" "$TRIPS" || true
  [[ -f "$BACKUP/paths.json" ]] && cp -a "$BACKUP/paths.json" "$PATHS" || true
  if [[ "$CHANGED" == 1 ]]; then systemctl restart "$SERVICE" >/dev/null 2>&1 || true; fi
}
finish(){ rc=$?; trap - EXIT; rollback; cleanup; exit "$rc"; }
trap finish EXIT

[[ ${EUID:-$(id -u)} -eq 0 ]] || { echo "ERREUR: lancer avec sudo/root" >&2; exit 2; }
for f in "$HTML" "$COMPILER" "$TRIPS" "$PATHS" "$STATE" "$SERVER"; do
  [[ -f "$f" ]] || { echo "ERREUR fichier absent: $f" >&2; exit 3; }
done

SERVICE_USER="$(systemctl show -p User --value "$SERVICE" 2>/dev/null || true)"
[[ -n "$SERVICE_USER" ]] || SERVICE_USER=ubuntu

run_as_service(){
  runuser -u "$SERVICE_USER" -- env MOORAIL_ROOT="$ROOT" "$@"
}

wait_health(){
  local ok=0
  for i in $(seq 1 60); do
    if systemctl is-active --quiet "$SERVICE" && curl -fsS --max-time 3 http://127.0.0.1:3111/api/map-v2/health > "$TMP/health.json" 2>/dev/null; then ok=1; break; fi
    echo "  attente map $i/60..."
    sleep 1
  done
  [[ "$ok" == 1 ]]
}

echo "============================================================"
echo " MOO RAIL V11.6 — BRIDGE VALIDATIONS -> MOTEUR FRANCE V3 ACTUEL"
echo "============================================================"
echo "Le répertoire public/moorail-path vide est normal :"
echo "les géométries sont servies dynamiquement depuis paths[trip.pathId]."
echo "V11.6 compile les validations existantes dans data/generated"
echo "sans réintroduire l'ancien moteur V4.4 dans france-v3-preview.html."
echo

echo "=== 0/9 PRE-FLIGHT ==="
systemctl is-active --quiet "$SERVICE"
wait_health
cat "$TMP/health.json"; echo
python3 -m py_compile "$COMPILER"
python3 "$COMPILER" --help | grep -q -- '--apply'
python3 "$COMPILER" --help | grep -q -- '--json'
python3 "$COMPILER" --help | grep -q -- '--no-restart'
grep -qF 'paths[trip.pathId]' "$SERVER" || { echo "ERREUR serveur actuel ne lit pas paths[trip.pathId]" >&2; exit 4; }
grep -qF 'moorail-path' "$SERVER" || { echo "ERREUR endpoint moorail-path absent du serveur" >&2; exit 4; }
grep -qF 'String(train?.pathId ||' "$HTML" || { echo "ERREUR France V3 ne lit pas train.pathId" >&2; exit 4; }
echo "Pre-flight moteur actuel : OK"

echo "=== 1/9 BACKUP ==="
mkdir -p "$BACKUP"
cp -a "$HTML" "$BACKUP/france-v3-preview.html"
cp -a "$TRIPS" "$BACKUP/trips.json"
cp -a "$PATHS" "$BACKUP/paths.json"
cp -a "$STATE" "$BACKUP/moorail-route-editor-state-v1.json"
echo "Backup : $BACKUP"

echo "=== 2/9 DRY-RUN COMPILATEUR ACTUEL ==="
run_as_service /usr/bin/python3 "$COMPILER" --json > "$TMP/plan.json"
python3 - "$TMP/plan.json" <<'PY'
import json,sys
p=json.load(open(sys.argv[1],encoding='utf-8'))
t=p.get('totals') or {}
print('Sections réutilisables :',p.get('sharedPairs'))
print('Routes prêtes          :',t.get('routes',0))
print('Circulations prêtes    :',t.get('trips',0))
print('Routes incomplètes     :',t.get('skippedRoutes',0))
for c in (p.get('candidates') or [])[:8]:
    print('  PRET |',c.get('signature'),'|',c.get('trips'),'train(s)','|',c.get('pathId'))
PY

READY="$(python3 - "$TMP/plan.json" <<'PY'
import json,sys
p=json.load(open(sys.argv[1],encoding='utf-8'))
print(int((p.get('totals') or {}).get('trips') or 0))
PY
)"
[[ "$READY" -gt 0 ]] || { echo "ERREUR: aucune circulation complète prête à publier. Rien modifié." >&2; exit 5; }

echo "=== 3/9 COMPATIBILITE REPONSE /moorail-path ==="
cp -a "$HTML" "$TMP/france.html"
python3 - "$TMP/france.html" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1]);s=p.read_text(encoding='utf-8')
marker='/* LB_MOORAIL_CURRENT_ENGINE_BRIDGE_V116 */'
if marker not in s:
    old='''        const latLngs =\n          (payload?.coordinates || [])\n          .map(point => {'''
    new='''        /* LB_MOORAIL_CURRENT_ENGINE_BRIDGE_V116 */\n        // Le serveur courant peut répondre soit {coordinates:[...]}, soit GeoJSON Feature.\n        const lbPathCoordinates = Array.isArray(payload?.coordinates)\n          ? payload.coordinates\n          : (Array.isArray(payload?.geometry?.coordinates) ? payload.geometry.coordinates : []);\n\n        const latLngs =\n          lbPathCoordinates\n          .map(point => {'''
    if old not in s: raise SystemExit('ERREUR ancre payload.coordinates absente')
    s=s.replace(old,new,1)
p.write_text(s,encoding='utf-8')
print('Compatibilité payload path : OK')
PY
grep -qF 'LB_MOORAIL_CURRENT_ENGINE_BRIDGE_V116' "$TMP/france.html"

echo "=== 4/9 PUBLICATION DES ROUTES PRETES ==="
BEFORE_T="$(sha256sum "$TRIPS" | awk '{print $1}')"
BEFORE_P="$(sha256sum "$PATHS" | awk '{print $1}')"
run_as_service /usr/bin/python3 "$COMPILER" --apply --no-restart --json > "$TMP/apply.json"
python3 - "$TMP/apply.json" <<'PY'
import json,sys
p=json.load(open(sys.argv[1],encoding='utf-8'))
assert p.get('ok') is True,p
assert p.get('verifiedOnDisk') is True,p
assert int((p.get('totals') or {}).get('trips') or 0)>0,p
print('Compiler APPLY : OK')
print('Routes publiées      :',(p.get('totals') or {}).get('routes'))
print('Circulations publiées:',(p.get('totals') or {}).get('trips'))
print('Backup compilateur   :',p.get('backup'))
PY
AFTER_T="$(sha256sum "$TRIPS" | awk '{print $1}')"
AFTER_P="$(sha256sum "$PATHS" | awk '{print $1}')"
[[ "$BEFORE_T" != "$AFTER_T" || "$BEFORE_P" != "$AFTER_P" ]] || { echo "ERREUR compiler APPLY n'a modifié ni trips ni paths" >&2; exit 6; }
CHANGED=1
install -o "$(stat -c %U "$HTML")" -g "$(stat -c %G "$HTML")" -m 0644 "$TMP/france.html" "$HTML"

echo "=== 5/9 VERIFICATION DISQUE ==="
python3 - "$TMP/apply.json" "$TRIPS" "$PATHS" <<'PY'
import json,sys
r=json.load(open(sys.argv[1],encoding='utf-8'))
t=json.load(open(sys.argv[2],encoding='utf-8'))
p=json.load(open(sys.argv[3],encoding='utf-8'))
cs=r.get('candidates') or []
assert cs
c=cs[0]; pid=str(c.get('pathId'))
assert pid in p,pid
ids=c.get('tripIds') or []
assert ids
for tid in ids[:20]:
    assert str((t.get(tid) or {}).get('pathId'))==pid,(tid,(t.get(tid) or {}).get('pathId'),pid)
coords=(p.get(pid) or {}).get('coordinates') or []
assert len(coords)>=2
print('Path témoin :',pid)
print('Points      :',len(coords))
print('Trip témoin :',ids[0])
print('Source      :',(p.get(pid) or {}).get('pathSource'))
PY

PID_PATH="$(python3 - "$TMP/apply.json" <<'PY'
import json,sys
p=json.load(open(sys.argv[1],encoding='utf-8'))
print((p.get('candidates') or [{}])[0].get('pathId') or '')
PY
)"

echo "=== 6/9 RESTART MOTEUR MAP ==="
systemctl restart "$SERVICE"
wait_health
cat "$TMP/health.json"; echo

echo "=== 7/9 TEST ENDPOINT DYNAMIQUE moorail-path ==="
HTTP=0
for URL in \
  "http://127.0.0.1:3111/map-v2/moorail-path/$PID_PATH" \
  "http://127.0.0.1:3111/moorail-path/$PID_PATH"; do
  CODE="$(curl -sS --max-time 8 -o "$TMP/path.json" -w '%{http_code}' "$URL" || true)"
  if [[ "$CODE" == 200 ]]; then HTTP=200; echo "Endpoint : $URL"; break; fi
done
[[ "$HTTP" == 200 ]] || { echo "ERREUR endpoint pathId témoin non servi" >&2; exit 7; }
python3 - "$TMP/path.json" "$PID_PATH" <<'PY'
import json,sys
p=json.load(open(sys.argv[1],encoding='utf-8')); pid=sys.argv[2]
coords=p.get('coordinates') if isinstance(p,dict) else None
if not isinstance(coords,list): coords=((p.get('geometry') or {}).get('coordinates') if isinstance(p,dict) else None)
assert isinstance(coords,list) and len(coords)>=2,p
print('pathId servi :',pid)
print('points servis:',len(coords))
print('forme réponse:','coordinates direct' if isinstance(p.get('coordinates'),list) else 'GeoJSON geometry.coordinates')
PY

echo "=== 8/9 FRANCE V3 SERVIE ==="
curl -fsS --max-time 8 "http://127.0.0.1:3111/france-v3-preview.html?$(date +%s)" -o "$TMP/served.html"
grep -qF 'LB_MOORAIL_CURRENT_ENGINE_BRIDGE_V116' "$TMP/served.html"
grep -qF 'lbPathCoordinates' "$TMP/served.html"
echo "France V3 compat pathId : OK"

echo "=== 9/9 VERDICT ==="
SUCCESS=1
trap - EXIT
cleanup

echo
echo "============================================================"
echo " MOO RAIL V11.6 INSTALLE — VALIDATIONS BRANCHEES AU MOTEUR ACTUEL"
echo "============================================================"
echo " - validations compilées dans data/generated/paths.json"
echo " - trips prêts repointés vers les nouveaux pathId MooRail"
echo " - serveur redémarré et pathId témoin servi"
echo " - France V3 accepte les deux formes de payload path"
echo " - le mouvement serveur utilise paths[trip.pathId]"
echo "Backup : $BACKUP"
echo "============================================================"
