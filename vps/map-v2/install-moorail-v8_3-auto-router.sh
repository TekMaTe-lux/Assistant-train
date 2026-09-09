#!/usr/bin/env bash
set -euo pipefail

ROOT="${MOORAIL_ROOT:-/opt/labetaillere-map-v2-src/map-v2}"
PUBLIC="$ROOT/public"
STATE="$ROOT/data/route-editor/moorail-route-editor-state-v1.json"
LIVE="$PUBLIC/data/moorail-live-v1/sections.json"
NETWORK="$PUBLIC/data/moorail-network-v8/network.json"
BUILDER="$ROOT/scripts/build-moorail-network-v8.py"
JS="$PUBLIC/moorail-route-editor-stops.js"
SERVICE="labetaillere-map-v2.service"
TIMER="moorail-network-v8-refresh.timer"
GTFS="${MOORAIL_LIVE_GTFS_DIR:-/var/www/html/gtfs/static}"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$ROOT/backups/moorail-v8_3-auto-router-$STAMP"
TMP="$(mktemp -d /tmp/moorail-v83.XXXXXX)"
BASE="https://raw.githubusercontent.com/TekMaTe-lux/Assistant-train/main/vps/map-v2"
AUTO="$ROOT/scripts/auto-route-moorail-v8-v6.py"
AUDIT="$TMP/audit-v82.py"
AUDIT_OUT="$ROOT/data/route-editor/moorail-v8-train-coverage-today.json"
REPORT="$ROOT/data/route-editor/moorail-v8-v6-auto-route-report.json"
SUCCESS=0
RESTARTED=0

cleanup(){ rm -rf "$TMP"; }
rollback(){
  [[ "$SUCCESS" == 1 ]] && return 0
  echo "ROLLBACK MOO RAIL V8.3..." >&2
  [[ -f "$BACKUP/state.json" ]] && cp -a "$BACKUP/state.json" "$STATE" || true
  [[ -f "$BACKUP/live.json" ]] && cp -a "$BACKUP/live.json" "$LIVE" || true
  [[ -f "$BACKUP/network.json" ]] && cp -a "$BACKUP/network.json" "$NETWORK" || true
  [[ -f "$BACKUP/editor.js" ]] && cp -a "$BACKUP/editor.js" "$JS" || true
  if [[ -f "$BACKUP/auto-router.py" ]]; then cp -a "$BACKUP/auto-router.py" "$AUTO"; elif [[ -f "$BACKUP/auto-router.absent" ]]; then rm -f "$AUTO"; fi
  if [[ -f "$BACKUP/report.json" ]]; then cp -a "$BACKUP/report.json" "$REPORT"; elif [[ -f "$BACKUP/report.absent" ]]; then rm -f "$REPORT"; fi
  [[ -f "$BACKUP/audit.json" ]] && cp -a "$BACKUP/audit.json" "$AUDIT_OUT" || true
  if [[ "$RESTARTED" == 1 ]]; then systemctl restart "$SERVICE" >/dev/null 2>&1 || true; fi
}
finish(){ rc=$?; trap - EXIT; rollback; cleanup; exit "$rc"; }
trap finish EXIT

[[ ${EUID:-$(id -u)} -eq 0 ]] || { echo "ERREUR: lancer avec sudo/root" >&2; exit 2; }
for f in "$STATE" "$LIVE" "$NETWORK" "$BUILDER" "$JS" "$GTFS/trips.txt" "$GTFS/stop_times.txt" "$GTFS/stops.txt"; do
  [[ -f "$f" ]] || { echo "ERREUR fichier absent: $f" >&2; exit 3; }
done
[[ -d "$PUBLIC/data/moorail-rfn-game-v2/cells" ]] || { echo "ERREUR RFN V2 absent" >&2; exit 3; }

SERVICE_USER="$(systemctl show -p User --value "$SERVICE" 2>/dev/null || true)"
SERVICE_GROUP="$(systemctl show -p Group --value "$SERVICE" 2>/dev/null || true)"
[[ -n "$SERVICE_USER" ]] || SERVICE_USER=root
[[ -n "$SERVICE_GROUP" ]] || SERVICE_GROUP="$(id -gn "$SERVICE_USER" 2>/dev/null || echo root)"

echo "============================================================"
echo " MOO RAIL V8.3 — AUTO-ROUTER RFN V6 DES BRIQUES CANONIQUES"
echo "============================================================"
echo "Root   : $ROOT"
echo "Backup : $BACKUP"
echo

echo "=== 0/9 PRE-FLIGHT : V8/V6/France V3 doivent être sains ==="
systemctl is-active --quiet "$SERVICE"
systemctl is-active --quiet "$TIMER"
curl -fsS --max-time 5 http://127.0.0.1:3111/api/map-v2/health > "$TMP/health-before.json"
python3 - "$TMP/health-before.json" <<'PY'
import json,sys
h=json.load(open(sys.argv[1]));assert h.get('ok') is True,h;print('Health avant :',h)
PY
grep -qF 'LB_MOORAIL_VALIDATED_SECTIONS_V8' "$JS"
grep -qF 'LB_MOORAIL_LGV_ROUTER_V6' "$JS"
for name in carte-core-canonical-v4-preview.html carte-core-preview.html; do
  f="$PUBLIC/$name"; [[ -f "$f" ]] || continue
  grep -qF 'LB_MOORAIL_SAFE_COMPOSITION_V8' "$f"
done
python3 - "$NETWORK" <<'PY'
import json,sys
p=json.load(open(sys.argv[1]));assert p.get('version')==8,p
assert p.get('strictTripsToday',0)>400,p.get('strictTripsToday')
assert all((p.get('controls') or {}).get('mustBePresent',{}).values()),p.get('controls')
assert all((p.get('controls') or {}).get('mustBeAbsent',{}).values()),p.get('controls')
print('Network V8 avant :',p.get('strictTripsToday'),'GV /',p.get('stats',{}).get('tasks'),'briques')
PY

echo "=== 1/9 Téléchargement + syntaxe auto-routeur/audit ==="
curl -fsSL "$BASE/auto-route-moorail-v8-v6.py?$STAMP" -o "$TMP/auto-router.py"
curl -fsSL "$BASE/audit-moorail-v8-train-coverage-v8_2.py?$STAMP" -o "$AUDIT"
python3 -m py_compile "$TMP/auto-router.py" "$AUDIT"

echo "=== 2/9 Mesure couverture AVANT + smoke-test routeur ==="
python3 "$AUDIT" > "$TMP/audit-before.txt"
cat "$TMP/audit-before.txt" | head -n 12
cp -a "$AUDIT_OUT" "$TMP/before.json"
python3 "$TMP/auto-router.py" --root "$ROOT" --network "$NETWORK" --report "$TMP/smoke.json" --max-tasks 5
python3 - "$TMP/smoke.json" <<'PY'
import json,sys
p=json.load(open(sys.argv[1]));assert p.get('tasksConsidered')==5,p
assert p.get('accepted',0)+p.get('rejected',0)==5,p
print('Smoke routeur :',p.get('accepted'),'accepté(s) /',p.get('rejected'),'revue(s)')
PY

echo "=== 3/9 Backup complet AVANT application ==="
mkdir -p "$BACKUP"
cp -a "$STATE" "$BACKUP/state.json"
cp -a "$LIVE" "$BACKUP/live.json"
cp -a "$NETWORK" "$BACKUP/network.json"
cp -a "$JS" "$BACKUP/editor.js"
[[ -f "$AUTO" ]] && cp -a "$AUTO" "$BACKUP/auto-router.py" || touch "$BACKUP/auto-router.absent"
[[ -f "$REPORT" ]] && cp -a "$REPORT" "$BACKUP/report.json" || touch "$BACKUP/report.absent"
[[ -f "$AUDIT_OUT" ]] && cp -a "$AUDIT_OUT" "$BACKUP/audit.json" || true

echo "=== 4/9 Complément V6 : SEA + branche Méditerranée ==="
python3 - "$JS" <<'PY'
from pathlib import Path
import re,sys
p=Path(sys.argv[1]);s=p.read_text(encoding='utf-8')
assert 'LB_MOORAIL_LGV_ROUTER_V6' in s
m=re.search(r'(const LB_LGV_CORE_CODES\s*=\s*\[)(.*?)(\];)',s,re.S)
if not m:raise SystemExit('ERREUR tableau LB_LGV_CORE_CODES absent')
body=m.group(2)
adds=[]
if "'566000'" not in body:adds.append("  '566000', // LGV Sud Europe Atlantique")
if "'834100'" not in body:adds.append("  '834100', // branche grand-sud LGV Méditerranée")
if adds:
    new=m.group(1)+body.rstrip()+"\n"+'\n'.join(adds)+"\n"+m.group(3)
    s=s[:m.start()]+new+s[m.end():]
m2=re.search(r'(const LB_LGV_CONNECTOR_PREFIXES\s*=\s*\[)(.*?)(\];)',s,re.S)
if not m2:raise SystemExit('ERREUR tableau LB_LGV_CONNECTOR_PREFIXES absent')
body2=m2.group(2)
if "'5663'" not in body2:
    new2=m2.group(1)+body2.rstrip()+"\n  '5663'\n"+m2.group(3)
    s=s[:m2.start()]+new2+s[m2.end():]
if '/* LB_MOORAIL_LGV_CODES_V83 */' not in s:
    s=s.replace('/* LB_MOORAIL_LGV_ROUTER_V6 */','/* LB_MOORAIL_LGV_ROUTER_V6 */\n/* LB_MOORAIL_LGV_CODES_V83 */',1)
p.write_text(s,encoding='utf-8')
PY
node --check "$JS"
grep -qF "'566000'" "$JS"
grep -qF "'834100'" "$JS"

echo "=== 5/9 Installation routeur + calcul de TOUTES les briques utiles ==="
install -o "$SERVICE_USER" -g "$SERVICE_GROUP" -m 0755 "$TMP/auto-router.py" "$AUTO"
python3 "$AUTO" --root "$ROOT" --network "$NETWORK" --report "$REPORT" --apply
python3 - "$REPORT" <<'PY'
import json,sys
p=json.load(open(sys.argv[1]));print('Auto-route V8.3 :',p.get('applied'),'appliquées /',p.get('rejected'),'à revoir')
print('Raisons revue   :',p.get('reasonCounts'))
assert p.get('tasksConsidered',0)>100,p
assert p.get('applied',0)>0,p
assert p.get('livePairs',0)>100,p
PY
chown "$SERVICE_USER:$SERVICE_GROUP" "$STATE" "$LIVE" "$REPORT"
chmod 0664 "$STATE"
chmod 0644 "$LIVE" "$REPORT"

echo "=== 6/9 Reconstruction réseau V8 après validations auto ==="
python3 "$BUILDER" --root "$ROOT" --gtfs "$GTFS" --output "$NETWORK"
chown "$SERVICE_USER:$SERVICE_GROUP" "$NETWORK"
chmod 0644 "$NETWORK"
python3 - "$NETWORK" <<'PY'
import json,sys
p=json.load(open(sys.argv[1]));s=p.get('stats') or {};c=p.get('controls') or {}
assert p.get('version')==8,p
assert all((c.get('mustBePresent') or {}).values()),c
assert all((c.get('mustBeAbsent') or {}).values()),c
print('Réseau reconstruit :',s)
PY

echo "=== 7/9 Redémarrage + contrôle HTTP du produit servi ==="
RESTARTED=1
systemctl restart "$SERVICE"
for _ in $(seq 1 30); do
  if systemctl is-active --quiet "$SERVICE" && curl -fsS --max-time 2 http://127.0.0.1:3111/api/map-v2/health >/dev/null 2>&1; then break; fi
  sleep 1
done
systemctl is-active --quiet "$SERVICE"
systemctl is-active --quiet "$TIMER"
curl -fsS --max-time 5 http://127.0.0.1:3111/api/map-v2/health > "$TMP/health-after.json"
curl -fsS --max-time 10 "http://127.0.0.1:3111/data/moorail-network-v8/network.json?v=$STAMP" > "$TMP/network-served.json"
curl -fsS --max-time 10 "http://127.0.0.1:3111/data/moorail-live-v1/sections.json?v=$STAMP" > "$TMP/live-served.json"
python3 - "$TMP/health-after.json" "$TMP/network-served.json" "$TMP/live-served.json" <<'PY'
import json,sys
h=json.load(open(sys.argv[1]));n=json.load(open(sys.argv[2]));l=json.load(open(sys.argv[3]))
assert h.get('ok') is True,h
assert n.get('version')==8,n.get('version')
assert len(l.get('pairs') or [])>100,len(l.get('pairs') or [])
print('Health après :',h)
print('Network servi:',n.get('stats'))
print('Live pairs   :',len(l.get('pairs') or []))
PY

echo "=== 8/9 Audit couverture APRES + non-régression ==="
python3 "$AUDIT" > "$TMP/audit-after.txt"
cat "$TMP/audit-after.txt" | head -n 12
cp -a "$AUDIT_OUT" "$TMP/after.json"
python3 - "$TMP/before.json" "$TMP/after.json" <<'PY'
import json,sys
b=json.load(open(sys.argv[1]));a=json.load(open(sys.argv[2]))
print('AVANT :',b.get('fullResolvable'),'résolus /',b.get('certifiedV8'),'certifiés /',b.get('incomplete'),'incomplets')
print('APRES :',a.get('fullResolvable'),'résolus /',a.get('certifiedV8'),'certifiés /',a.get('incomplete'),'incomplets')
assert a.get('strictTripsToday')==b.get('strictTripsToday'),(b.get('strictTripsToday'),a.get('strictTripsToday'))
assert a.get('fullResolvable',0)>=b.get('fullResolvable',0),(b,a)
assert a.get('certifiedV8',0)>=b.get('certifiedV8',0),(b,a)
assert a.get('incomplete',10**9)<=b.get('incomplete',10**9),(b,a)
assert (a.get('fullResolvable',0)>b.get('fullResolvable',0) or a.get('certifiedV8',0)>b.get('certifiedV8',0)), 'Aucun progrès mesurable : rollback'
PY

echo "=== 9/9 Contrôles indépendants des briques publiées ==="
python3 - "$STATE" "$LIVE" "$REPORT" <<'PY'
import json,sys
st=json.load(open(sys.argv[1]));lv=json.load(open(sys.argv[2]));rp=json.load(open(sys.argv[3]))
auto=[]
for sid,s in (st.get('sections') or {}).items():
    if s.get('status')=='validated' and s.get('source')=='MOORAIL_VALIDATED_SECTIONS_V8' and s.get('autoValidated'):
        auto.append((sid,s))
assert len(auto)>=rp.get('applied',0)>0,(len(auto),rp.get('applied'))
ids={sid for sid,_ in auto};live_ids={str(x.get('sectionId')) for x in (lv.get('pairs') or [])}
assert ids & live_ids,'Aucune brique auto V8 dans le live'
print('Briques auto V8 présentes état :',len(auto))
print('Briques auto V8 visibles live :',len(ids & live_ids))
for sid,s in sorted(auto,key=lambda z:-int((z[1].get('validationMeta') or {}).get('impactToday') or 0))[:12]:
    m=(s.get('validationMeta') or {}).get('metrics') or {}
    print(' ',sid,'|',(s.get('stopFrom') or {}).get('name'),'→',(s.get('stopTo') or {}).get('name'),'|',m.get('routeKm'),'km | LGV',round(100*float(m.get('lgvShare') or 0)),'%')
PY

SUCCESS=1
trap - EXIT
cleanup

echo
echo "============================================================"
echo " MOO RAIL V8.3 INSTALLE ET VALIDE"
echo "============================================================"
echo " - toutes les briques TODO/LEGACY du jour ont été calculées"
echo " - seules les géométries passant les garde-fous ont été validées"
echo " - les cas ambigus restent dans l'éditeur pour revue manuelle"
echo " - état + live + network régénérés"
echo " - couverture trains mesurée avant/après sans régression"
echo " - SEA 566000 et branche Méditerranée 834100 ajoutées au routeur V6"
echo "Backup : $BACKUP"
echo "Rapport: $REPORT"
echo "============================================================"
