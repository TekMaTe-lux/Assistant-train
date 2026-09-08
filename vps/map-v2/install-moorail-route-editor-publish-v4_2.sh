#!/usr/bin/env bash
set -euo pipefail

ROOT="${MOORAIL_ROOT:-/opt/labetaillere-map-v2-src/map-v2}"
SERVER_API="$ROOT/server/route-editor-api.mjs"
COMPILER="$ROOT/scripts/compile-moorail-validations-v2.py"
SERVICE="labetaillere-map-v2.service"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$ROOT/backups/route-editor-publish-v4_2-$STAMP"
TMP="$(mktemp -d /tmp/moorail-v42.XXXXXX)"
SUCCESS=0
RESTARTED=0

cleanup(){ rm -rf "$TMP"; }
rollback(){
  [[ "$SUCCESS" == 1 ]] && return 0
  echo "ROLLBACK MOO RAIL V4.2..." >&2
  [[ -f "$BACKUP/route-editor-api.mjs" ]] && cp -a "$BACKUP/route-editor-api.mjs" "$SERVER_API"
  [[ -f "$BACKUP/compile-moorail-validations-v2.py" ]] && cp -a "$BACKUP/compile-moorail-validations-v2.py" "$COMPILER"
  if [[ "$RESTARTED" == 1 ]]; then systemctl restart "$SERVICE" >/dev/null 2>&1 || true; fi
}
finish(){ rc=$?; trap - EXIT; rollback; cleanup; exit "$rc"; }
trap finish EXIT

[[ ${EUID:-$(id -u)} -eq 0 ]] || { echo "ERREUR: lancer avec sudo/root" >&2; exit 2; }
[[ -f "$SERVER_API" ]] || { echo "ERREUR API absente: $SERVER_API" >&2; exit 3; }
[[ -f "$COMPILER" ]] || { echo "ERREUR compilateur absent: $COMPILER" >&2; exit 3; }

mkdir -p "$BACKUP"
cp -a "$SERVER_API" "$BACKUP/route-editor-api.mjs"
cp -a "$COMPILER" "$BACKUP/compile-moorail-validations-v2.py"
cp -a "$SERVER_API" "$TMP/api.mjs"
cp -a "$COMPILER" "$TMP/compiler.py"

echo "============================================================"
echo " MOO RAIL V4.2 — INCLURE TOUTES LES CIRCULATIONS D'UNE FAMILLE TGV"
echo "============================================================"
echo "Backup : $BACKUP"

echo "=== 1/5 Patch API catalogue ==="
python3 - "$TMP/api.mjs" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1]); s=p.read_text(encoding='utf-8')

old="""  for (const trip of Object.values(trips || {})) {\n    if (!trip || !highSpeedTrip(trip)) continue;\n"""
new="""  for (const trip of Object.values(trips || {})) {\n    if (!trip) continue;\n"""
if old in s:
    s=s.replace(old,new,1)
elif new not in s:
    raise SystemExit('ancre boucle catalogue absente')

old="""        routeNames:new Map(), trainNumbers:new Set(), pathIds:new Map(), tripCount:0 };\n"""
new="""        routeNames:new Map(), trainNumbers:new Set(), pathIds:new Map(), tripCount:0, highSpeedSeen:false };\n"""
if old in s:
    s=s.replace(old,new,1)
elif new not in s:
    raise SystemExit('ancre groupe catalogue absente')

old="""    group.tripCount += 1;\n    if (trip.number) group.trainNumbers.add(String(trip.number));\n"""
new="""    group.tripCount += 1;\n    if (highSpeedTrip(trip)) group.highSpeedSeen = true;\n    if (trip.number) group.trainNumbers.add(String(trip.number));\n"""
if old in s:
    s=s.replace(old,new,1)
elif new not in s:
    raise SystemExit('ancre highSpeedSeen catalogue absente')

old="const routes = [...groups.values()].map(group => {"
new="const routes = [...groups.values()].filter(group => group.highSpeedSeen || state?.routes?.[group.id]).map(group => {"
if old in s:
    s=s.replace(old,new,1)
elif new not in s:
    raise SystemExit('ancre filtre groupes catalogue absente')

# Passe en version 4.2 pour contrôle.
s=s.replace("return { ok:true, version:4, generatedAt:new Date().toISOString(), sharedPairCount:shared.size, routes };",
            "return { ok:true, version:42, generatedAt:new Date().toISOString(), sharedPairCount:shared.size, routes };",1)
p.write_text(s,encoding='utf-8')
PY
node --check "$TMP/api.mjs"

echo "=== 2/5 Patch compilateur ==="
python3 - "$TMP/compiler.py" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1]); s=p.read_text(encoding='utf-8')

old="""    for tid, t in trips.items():\n        if not high_speed_trip(t): continue\n        stops = t.get('stops') or []\n"""
new="""    for tid, t in trips.items():\n        stops = t.get('stops') or []\n"""
if old in s:
    s=s.replace(old,new,1)
elif new not in s:
    raise SystemExit('ancre boucle compilateur absente')

old="""        g = groups.setdefault(rid, {'routeId': rid, 'signature': sig, 'stops': stops, 'trips': []})\n        g['trips'].append((tid, t))\n"""
new="""        g = groups.setdefault(rid, {'routeId': rid, 'signature': sig, 'stops': stops, 'trips': [], 'highSpeedSeen': False})\n        g['trips'].append((tid, t))\n        if high_speed_trip(t): g['highSpeedSeen'] = True\n"""
if old in s:
    s=s.replace(old,new,1)
elif new not in s:
    raise SystemExit('ancre groupe compilateur absente')

old="""    for rid, g in sorted(groups.items()):\n        built, missing = assemble_stops(g['stops'], lib)\n"""
new="""    for rid, g in sorted(groups.items()):\n        if not (g.get('highSpeedSeen') or rid in (state.get('routes') or {})):\n            continue\n        built, missing = assemble_stops(g['stops'], lib)\n"""
if old in s:
    s=s.replace(old,new,1)
elif new not in s:
    raise SystemExit('ancre filtre compilateur absente')

p.write_text(s,encoding='utf-8')
PY
python3 -m py_compile "$TMP/compiler.py"

echo "=== 3/5 Installation ==="
install -o root -g root -m 0644 "$TMP/api.mjs" "$SERVER_API"
install -o root -g root -m 0755 "$TMP/compiler.py" "$COMPILER"

echo "=== 4/5 Redémarrage Map V2 ==="
RESTARTED=1
systemctl restart "$SERVICE"
for _ in $(seq 1 30); do
  if systemctl is-active --quiet "$SERVICE" && curl -fsS --max-time 2 http://127.0.0.1:3111/api/map-v2/health >/dev/null 2>&1; then break; fi
  sleep 1
done
systemctl is-active --quiet "$SERVICE"

echo "=== 5/5 Vérification 2509 + publication ==="
curl -fsS --max-time 8 "http://127.0.0.1:3111/api/map-v2/route-editor/catalog?t=$STAMP" -o "$TMP/catalog.json"
python3 - "$ROOT/data/generated/trips.json" "$TMP/catalog.json" <<'PY'
import json,sys
trips=json.load(open(sys.argv[1],encoding='utf-8'))
cat=json.load(open(sys.argv[2],encoding='utf-8'))
print('Catalogue version :',cat.get('version'))
rows=[(tid,t) for tid,t in trips.items() if str(t.get('number') or '')=='2509']
print('2509 dans trips.json :',len(rows))
for tid,t in rows[:5]:
    print('  tripId    :',tid)
    print('  trajet    :',' → '.join(str(s.get('name') or '') for s in t.get('stops') or []))
    print('  category  :',t.get('category'))
    print('  routeName :',t.get('routeName'))
    print('  pathId    :',t.get('pathId'))
    print('  source    :',t.get('pathSource'))
routes=[r for r in cat.get('routes',[]) if '2509' in [str(x) for x in r.get('trainNumbers') or []]]
print('2509 dans catalogue V4.2 :',len(routes))
for r in routes:
    print('  routeId   :',r.get('id'))
    print('  trajet    :',r.get('signature'))
    print('  progress  :',r.get('progress'))
if rows and not routes:
    raise SystemExit('ERREUR: 2509 existe dans trips.json mais reste absent du catalogue après V4.2')
PY

# Si le 2509 est dans le catalogue, contrôle de sa capacité de publication.
python3 - "$TMP/catalog.json" <<'PY' > "$TMP/route2509.txt"
import json,sys
c=json.load(open(sys.argv[1],encoding='utf-8'))
for r in c.get('routes',[]):
    if '2509' in [str(x) for x in r.get('trainNumbers') or []]:
        print(r.get('id')); break
PY
RID="$(cat "$TMP/route2509.txt")"
if [[ -n "$RID" ]]; then
  curl -fsS --max-time 20 "http://127.0.0.1:3111/api/map-v2/route-editor/publish-preview?routeId=$RID&t=$STAMP" -o "$TMP/publish2509.json"
  python3 - "$TMP/publish2509.json" <<'PY'
import json,sys
p=json.load(open(sys.argv[1],encoding='utf-8'))
c=p.get('candidates') or []
if c:
    x=c[0]
    print('TGV 2509 : PRET A PUBLIER')
    print('  pathId   :',x.get('pathId'))
    print('  distance :',round(float(x.get('km') or 0),1),'km')
    print('  trains   :',', '.join(x.get('numbers') or []))
else:
    print('TGV 2509 : encore incomplet')
    for s in p.get('skipped') or []:
        print('  manque :',' | '.join(s.get('missing') or []))
PY
fi

SUCCESS=1
trap - EXIT
cleanup
cat > "$BACKUP/ROLLBACK.sh" <<EOF
#!/usr/bin/env bash
set -euo pipefail
cp -a '$BACKUP/route-editor-api.mjs' '$SERVER_API'
cp -a '$BACKUP/compile-moorail-validations-v2.py' '$COMPILER'
systemctl restart '$SERVICE'
EOF
chmod 0755 "$BACKUP/ROLLBACK.sh"

echo
echo "============================================================"
echo " MOO RAIL V4.2 INSTALLE"
echo "============================================================"
echo "Une famille TGV inclut maintenant toutes les circulations"
echo "ayant exactement la même suite d'arrêts qu'un TGV reconnu."
echo "Backup : $BACKUP"
echo "============================================================"
