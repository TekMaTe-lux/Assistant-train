#!/usr/bin/env bash
set -euo pipefail

ROOT="${MOORAIL_ROOT:-/opt/labetaillere-map-v2-src/map-v2}"
PUBLIC="$ROOT/public"
BUILDER="$ROOT/scripts/build-moorail-network-v8.py"
NETWORK="$PUBLIC/data/moorail-network-v8/network.json"
GTFS="${MOORAIL_LIVE_GTFS_DIR:-/var/www/html/gtfs/static}"
SERVICE="labetaillere-map-v2.service"
STATE="$ROOT/data/route-editor/moorail-route-editor-state-v1.json"
LIVE="$PUBLIC/data/moorail-live-v1/sections.json"
DERIVED_SECTIONS="$ROOT/data/route-editor/moorail-validated-sections-v1.json"
DERIVED_TEMPLATES="$ROOT/data/route-editor/moorail-route-templates-v1.json"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$ROOT/backups/moorail-v8_5-selected-route-$STAMP"
TMP="$(mktemp -d /tmp/moorail-v85.XXXXXX)"
SUCCESS=0
RESTARTED=0

cleanup(){ rm -rf "$TMP"; }
rollback(){
  [[ "$SUCCESS" == 1 ]] && return 0
  echo "ROLLBACK MOO RAIL V8.5..." >&2
  [[ -f "$BACKUP/build-moorail-network-v8.py" ]] && cp -a "$BACKUP/build-moorail-network-v8.py" "$BUILDER" || true
  [[ -f "$BACKUP/network.json" ]] && cp -a "$BACKUP/network.json" "$NETWORK" || true
  for n in carte-core-canonical-v4-preview.html carte-core-preview.html moorail-route-editor.html moorail-route-editor-stops.html; do
    [[ -f "$BACKUP/$n" ]] && cp -a "$BACKUP/$n" "$PUBLIC/$n" || true
  done
  [[ -f "$BACKUP/state.json" ]] && cp -a "$BACKUP/state.json" "$STATE" || true
  [[ -f "$BACKUP/live.json" ]] && cp -a "$BACKUP/live.json" "$LIVE" || true
  [[ -f "$BACKUP/derived-sections.json" ]] && cp -a "$BACKUP/derived-sections.json" "$DERIVED_SECTIONS" || true
  [[ -f "$BACKUP/derived-templates.json" ]] && cp -a "$BACKUP/derived-templates.json" "$DERIVED_TEMPLATES" || true
  if [[ "$RESTARTED" == 1 ]]; then systemctl restart "$SERVICE" >/dev/null 2>&1 || true; fi
}
finish(){ rc=$?; trap - EXIT; rollback; cleanup; exit "$rc"; }
trap finish EXIT

[[ ${EUID:-$(id -u)} -eq 0 ]] || { echo "ERREUR: lancer avec sudo/root" >&2; exit 2; }
for f in "$BUILDER" "$NETWORK" "$STATE" "$LIVE" "$GTFS/trips.txt" "$GTFS/stop_times.txt" "$GTFS/stops.txt"; do
  [[ -f "$f" ]] || { echo "ERREUR fichier absent: $f" >&2; exit 3; }
done

CORES=()
for n in carte-core-canonical-v4-preview.html carte-core-preview.html; do
  f="$PUBLIC/$n"
  [[ -f "$f" ]] || continue
  grep -qF 'LB_MOORAIL_VALIDATED_NETWORK_V8' "$f" || continue
  grep -qF 'LB_MOORAIL_SELECTED_ROUTE_V52' "$f" || continue
  CORES+=("$f")
done
[[ ${#CORES[@]} -gt 0 ]] || { echo "ERREUR: aucun core France V3 V8 + V5.2" >&2; exit 4; }

SERVICE_USER="$(systemctl show -p User --value "$SERVICE" 2>/dev/null || true)"
SERVICE_GROUP="$(systemctl show -p Group --value "$SERVICE" 2>/dev/null || true)"
[[ -n "$SERVICE_USER" ]] || SERVICE_USER=root
[[ -n "$SERVICE_GROUP" ]] || SERVICE_GROUP="$(id -gn "$SERVICE_USER" 2>/dev/null || echo root)"

echo "============================================================"
echo " MOO RAIL V8.5 — TRACE SELECTIONNE PAR NUMERO + SELF-TEST EDITEUR"
echo "============================================================"

echo "=== 0/8 PRE-FLIGHT ==="
systemctl is-active --quiet "$SERVICE"
curl -fsS --max-time 5 http://127.0.0.1:3111/api/map-v2/health > "$TMP/health.json"
python3 - "$TMP/health.json" "$NETWORK" <<'PY'
import json,sys
h=json.load(open(sys.argv[1]));n=json.load(open(sys.argv[2]))
assert h.get('ok') is True,h
assert n.get('version')==8,n.get('version')
print('Health :',h)
print('Network:',n.get('strictTripsToday'),'GV /',(n.get('stats') or {}).get('tasks'),'briques')
PY
for f in "${CORES[@]}"; do
  grep -qF 'function lbMoorailResolvedPathBetweenStops(stopA,stopB)' "$f"
  grep -qF 'function lbMoorailSelectedFullRoute(seq)' "$f"
  grep -qF 'async function drawSelectedTripRoute(trainId)' "$f"
  echo "  OK core : $(basename "$f")"
done

echo "=== 1/8 BACKUP ==="
mkdir -p "$BACKUP"
cp -a "$BUILDER" "$BACKUP/build-moorail-network-v8.py"
cp -a "$NETWORK" "$BACKUP/network.json"
cp -a "$STATE" "$BACKUP/state.json"
cp -a "$LIVE" "$BACKUP/live.json"
[[ -f "$DERIVED_SECTIONS" ]] && cp -a "$DERIVED_SECTIONS" "$BACKUP/derived-sections.json" || true
[[ -f "$DERIVED_TEMPLATES" ]] && cp -a "$DERIVED_TEMPLATES" "$BACKUP/derived-templates.json" || true
for f in "${CORES[@]}"; do cp -a "$f" "$BACKUP/$(basename "$f")"; done
for n in moorail-route-editor.html moorail-route-editor-stops.html; do [[ -f "$PUBLIC/$n" ]] && cp -a "$PUBLIC/$n" "$BACKUP/$n" || true; done

echo "=== 2/8 INDEX DES PARCOURS PAR NUMERO DANS network.json ==="
cp -a "$BUILDER" "$TMP/builder.py"
python3 - "$TMP/builder.py" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1]);s=p.read_text(encoding='utf-8')
marker='# LB_MOORAIL_TRAIN_ROUTES_V85'
if marker not in s:
    old='    selected_numbers=set();valid_trip_count=0\n'
    new="    # LB_MOORAIL_TRAIN_ROUTES_V85\n    train_routes=defaultdict(list)\n    selected_numbers=set();valid_trip_count=0\n"
    if old not in s: raise SystemExit('ERREUR ancre selected_numbers absente')
    s=s.replace(old,new,1)

    old2="        valid_trip_count+=1;selected_numbers.add(str(t['number']));trip={**t,'tid':tid}\n"
    new2="""        valid_trip_count+=1;selected_numbers.add(str(t['number']));trip={**t,'tid':tid}\n        num=str(t['number'])\n        sig='|'.join(norm(x['name']) for x in ss)\n        if not any(v.get('_sig')==sig for v in train_routes[num]):\n            train_routes[num].append({'_sig':sig,'tripId':tid,'token':t['token'],'stops':[dict(x) for x in ss]})\n"""
    if old2 not in s: raise SystemExit('ERREUR ancre valid_trip_count absente')
    s=s.replace(old2,new2,1)

    old3="    payload={\n      'version':8,'generatedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'date':str(today),\n"
    new3="""    train_routes_public={}\n    for num,variants in train_routes.items():\n        train_routes_public[num]=[{k:v for k,v in item.items() if k!='_sig'} for item in variants]\n\n    payload={\n      'version':8,'generatedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'date':str(today),\n"""
    if old3 not in s: raise SystemExit('ERREUR ancre payload absente')
    s=s.replace(old3,new3,1)

    old4="      'controls':controls,'corridors':corridors,'spines':spines_public,'tasks':tasks\n"
    new4="      'controls':controls,'corridors':corridors,'spines':spines_public,'tasks':tasks,'trainRoutes':train_routes_public\n"
    if old4 not in s: raise SystemExit('ERREUR ancre payload tasks absente')
    s=s.replace(old4,new4,1)

p.write_text(s,encoding='utf-8')
PY
python3 -m py_compile "$TMP/builder.py"
python3 "$TMP/builder.py" --root "$ROOT" --gtfs "$GTFS" --output "$TMP/network.json" > "$TMP/build.out"
cat "$TMP/build.out" | tail -1
python3 - "$TMP/network.json" <<'PY'
import json,sys
p=json.load(open(sys.argv[1]));r=(p.get('trainRoutes') or {}).get('2656') or []
assert r,'2656 absent de trainRoutes'
print('Variantes 2656 indexées :',len(r))
for v in r:
    print(' ',v.get('tripId'),'|',' → '.join(x.get('name','?') for x in v.get('stops') or []))
assert any([x.get('name') for x in v.get('stops') or []]==['Metz','Meuse TGV','Paris Est'] for v in r),r
PY

echo "=== 3/8 PATCH DES CORES : FALLBACK PAR NUMERO ==="
mkdir -p "$TMP/cores"
for f in "${CORES[@]}"; do
  out="$TMP/cores/$(basename "$f")"
  cp -a "$f" "$out"
  python3 - "$out" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1]);s=p.read_text(encoding='utf-8')
marker='/* LB_MOORAIL_SELECTED_ROUTE_BY_NUMBER_V85 */'
if marker in s:
    print('Déjà V8.5 :',p)
    raise SystemExit(0)

if 'let lbMoorailV8Spines = [];' not in s: raise SystemExit('ERREUR lbMoorailV8Spines absent')
s=s.replace('  let lbMoorailV8Spines = [];','  let lbMoorailV8Spines = [];\n  let lbMoorailV8TrainRoutes = {};',1)

needle='      lbMoorailV8Spines=Array.isArray(p?.spines)?p.spines:[];'
if needle not in s: raise SystemExit('ERREUR chargement spines absent')
s=s.replace(needle,needle+"\n      lbMoorailV8TrainRoutes=(p?.trainRoutes && typeof p.trainRoutes==='object')?p.trainRoutes:{};",1)

helper=r'''

  /* LB_MOORAIL_SELECTED_ROUTE_BY_NUMBER_V85 */
  function lbMoorailSelectedTrainNumberV85(trainId){
    let d=null;
    try{ d=trainDataById.get(trainId) || (typeof buildStaticPanelTrainData==='function'?buildStaticPanelTrainData(trainId):null); }catch(_){ d=null; }
    const vals=[d?.number,d?.trainNumber,d?.train_number,d?.trip_short_name,d?.tripShortName,trainId];
    for(const raw of vals){
      const m=String(raw||'').match(/(?:^|[^0-9])([0-9]{2,6})(?:[^0-9]|$)/);
      if(m)return m[1];
    }
    return '';
  }

  function lbMoorailSelectedFromNamedStopsV85(stops){
    if(!Array.isArray(stops)||stops.length<2||!lbMoorailLiveLoaded)return null;
    const combined=[],sectionIds=[];
    for(let i=0;i<stops.length-1;i++){
      const a=stops[i],b=stops[i+1];
      if(!a?.name||!b?.name)return null;
      const path=lbMoorailResolvedPathBetweenStops(a,b);
      if(!path||!Array.isArray(path.coords)||path.coords.length<2)return null;
      appendRailCoords(combined,path.coords);
      if(path.moorailSectionId)sectionIds.push(path.moorailSectionId);
      if(Array.isArray(path.moorailSectionIds))sectionIds.push(...path.moorailSectionIds);
    }
    if(combined.length<2)return null;
    return {coords:combined,sectionIds:[...new Set(sectionIds)]};
  }

  function lbMoorailSelectedRouteForTrainV85(trainId,seq){
    const normal=lbMoorailSelectedFullRoute(seq);
    if(normal)return {...normal,resolution:'stopTimesByTrip'};
    const number=lbMoorailSelectedTrainNumberV85(trainId);
    if(!number)return null;
    const variants=Array.isArray(lbMoorailV8TrainRoutes?.[number])?lbMoorailV8TrainRoutes[number]:[];
    for(const variant of variants){
      const routed=lbMoorailSelectedFromNamedStopsV85(variant?.stops||[]);
      if(routed){
        console.info('[MOO RAIL V8.5] tracé sélectionné résolu par numéro',number,variant?.tripId,routed.sectionIds);
        return {...routed,resolution:'network-trainRoutes',trainNumber:number,tripId:variant?.tripId};
      }
    }
    console.warn('[MOO RAIL V8.5] aucune variante MooRail complète pour',number);
    return null;
  }
'''
anchor='  async function drawSelectedTripRoute(trainId){'
if anchor not in s: raise SystemExit('ERREUR drawSelectedTripRoute absent')
s=s.replace(anchor,helper+'\n'+anchor,1)

old='      const lbMoorailSelected = lbMoorailSelectedFullRoute(seq);'
new='      const lbMoorailSelected = lbMoorailSelectedRouteForTrainV85(trainId,seq);'
if old not in s: raise SystemExit('ERREUR appel lbMoorailSelectedFullRoute absent')
s=s.replace(old,new,1)

p.write_text(s,encoding='utf-8')
PY
  grep -qF 'LB_MOORAIL_SELECTED_ROUTE_BY_NUMBER_V85' "$out"
  grep -qF 'lbMoorailSelectedRouteForTrainV85(trainId,seq)' "$out"
done

echo "=== 4/8 INSTALLATION BUILDER + NETWORK + CORES ==="
install -o "$SERVICE_USER" -g "$SERVICE_GROUP" -m 0755 "$TMP/builder.py" "$BUILDER"
install -o "$SERVICE_USER" -g "$SERVICE_GROUP" -m 0644 "$TMP/network.json" "$NETWORK"
for f in "${CORES[@]}"; do install -o root -g root -m 0644 "$TMP/cores/$(basename "$f")" "$f"; done

# Force le navigateur à reprendre le JS éditeur V8.4 au lieu d'un cache antérieur.
for n in moorail-route-editor.html moorail-route-editor-stops.html; do
  f="$PUBLIC/$n"; [[ -f "$f" ]] || continue
  python3 - "$f" <<'PY'
from pathlib import Path
import re,sys
p=Path(sys.argv[1]);s=p.read_text(encoding='utf-8')
s=re.sub(r'/map-v2/moorail-route-editor-stops\.js\?v=[^"\']+', '/map-v2/moorail-route-editor-stops.js?v=8.5', s)
p.write_text(s,encoding='utf-8')
PY
done

echo "=== 5/8 SELF-TEST TRANSACTIONNEL EDITEUR : SAVE -> STATE -> LIVE -> DELETE ==="
python3 - "$STATE" "$LIVE" "$DERIVED_SECTIONS" "$DERIVED_TEMPLATES" <<'PY'
import json,sys,urllib.request,shutil,tempfile,pathlib,time
state,live,ds,dt=map(pathlib.Path,sys.argv[1:])
tmp=pathlib.Path(tempfile.mkdtemp(prefix='moorail-v85-selftest.'))
files=[state,live,ds,dt]
back={}
for p in files:
    if p.exists():
        q=tmp/p.name;shutil.copy2(p,q);back[p]=q
sid='sec-v85-selftest-'+str(int(time.time()))
base='http://127.0.0.1:3111/api/map-v2/route-editor'
def req(path,payload=None):
    data=None;headers={}
    if payload is not None:
        data=json.dumps(payload).encode();headers={'content-type':'application/json'}
    r=urllib.request.Request(base+path,data=data,headers=headers,method='POST' if payload is not None else 'GET')
    with urllib.request.urlopen(r,timeout=10) as x:return json.loads(x.read())
def getjson(url):
    with urllib.request.urlopen(url,timeout=10) as x:return json.loads(x.read())
try:
    payload={
      'routeId':'network-autre-a-verifier','sectionId':sid,'status':'validated','source':'MOORAIL_VALIDATED_SECTIONS_V8',
      'canonical':True,'canonicalSectionId':sid,'corridor':'AUTRE_A_VERIFIER','validationEngine':'ROUTER_V6',
      'route':{'origin':'Réseau','destination':'SELFTEST','signature':'SELFTEST'},
      'stopFrom':{'name':'__MOO_V85_SELFTEST_A__','lat':49.119,'lon':6.175},
      'stopTo':{'name':'__MOO_V85_SELFTEST_B__','lat':49.120,'lon':6.176},
      'waypoints':[],'coordinates':[[6.175,49.119],[6.176,49.120]],'distanceKm':0.2
    }
    out=req('/save',payload);assert out.get('ok') is True,out
    st=req('/state');assert sid in (st.get('sections') or {}),'selftest absent état'
    lv=getjson('http://127.0.0.1:3111/data/moorail-live-v1/sections.json?v='+str(time.time()))
    assert any(str(x.get('sectionId'))==sid for x in (lv.get('pairs') or [])),'selftest absent live après save'
    dele=req('/delete',{'sectionId':sid});assert dele.get('ok') is True,dele
    st2=req('/state');assert sid not in (st2.get('sections') or {}),'selftest encore état après delete'
    lv2=getjson('http://127.0.0.1:3111/data/moorail-live-v1/sections.json?v='+str(time.time()))
    assert not any(str(x.get('sectionId'))==sid for x in (lv2.get('pairs') or [])),'selftest encore live après delete'
    print('SELF-TEST EDITEUR : SAVE -> STATE -> LIVE -> DELETE = OK')
finally:
    # Restaure octet pour octet l'état précédent : aucune brique de test ne reste.
    for p,q in back.items():shutil.copy2(q,p)
    shutil.rmtree(tmp,ignore_errors=True)
PY

echo "=== 6/8 TEST 2656 : INDEX + LIVE + RESOLUTION ==="
python3 - "$NETWORK" "$LIVE" <<'PY'
import json,sys,unicodedata
net=json.load(open(sys.argv[1]));lv=json.load(open(sys.argv[2]))
def norm(s):
    s=unicodedata.normalize('NFKD',str(s or ''))
    return ''.join(c for c in s if not unicodedata.combining(c)).strip().lower()
pairs={(norm(x.get('from')),norm(x.get('to'))):x for x in (lv.get('pairs') or [])}
variants=(net.get('trainRoutes') or {}).get('2656') or []
assert variants,'2656 absent index V8.5'
ok=False
for v in variants:
    names=[x.get('name') for x in (v.get('stops') or [])]
    print('2656 :',' → '.join(names))
    good=True
    for a,b in zip(names,names[1:]):
        hit=pairs.get((norm(a),norm(b)))
        print(' ',a,'→',b,'| LIVE',bool(hit),'|',hit.get('sectionId') if hit else '-')
        good &= bool(hit)
    ok |= good
assert ok,'aucune variante 2656 entièrement LIVE'
print('2656 : TRACE MOO RAIL COMPLET DISPONIBLE = OK')
PY

echo "=== 7/8 RESTART + TEST PRODUIT SERVI ==="
RESTARTED=1
systemctl restart "$SERVICE"
for _ in $(seq 1 30); do
  if systemctl is-active --quiet "$SERVICE" && curl -fsS --max-time 2 http://127.0.0.1:3111/api/map-v2/health >/dev/null 2>&1; then break; fi
  sleep 1
done
systemctl is-active --quiet "$SERVICE"
for f in "${CORES[@]}"; do
  n="$(basename "$f")"
  curl -fsS --max-time 10 "http://127.0.0.1:3111/$n?v=$STAMP" > "$TMP/served-$n"
  grep -qF 'LB_MOORAIL_SELECTED_ROUTE_BY_NUMBER_V85' "$TMP/served-$n"
  grep -qF 'lbMoorailSelectedRouteForTrainV85(trainId,seq)' "$TMP/served-$n"
  echo "  SERVI : $n"
done
curl -fsS --max-time 10 "http://127.0.0.1:3111/data/moorail-network-v8/network.json?v=$STAMP" > "$TMP/served-network.json"
python3 - "$TMP/served-network.json" <<'PY'
import json,sys
p=json.load(open(sys.argv[1]));assert (p.get('trainRoutes') or {}).get('2656')
print('network.json servi contient trainRoutes[2656] : OK')
PY

echo "=== 8/8 HEALTH FINAL ==="
curl -fsS --max-time 5 http://127.0.0.1:3111/api/map-v2/health

echo
SUCCESS=1
trap - EXIT
cleanup

echo "============================================================"
echo " MOO RAIL V8.5 INSTALLE ET VALIDE"
echo "============================================================"
echo " - index des variantes par numéro dans network.json"
echo " - fallback du tracé sélectionné par numéro de train"
echo " - 2656 vérifié : Metz -> Meuse TGV -> Paris Est, 100 % LIVE"
echo " - pipeline éditeur SAVE -> STATE -> LIVE -> DELETE testé réellement"
echo " - cache éditeur forcé en v=8.5"
echo "Backup : $BACKUP"
echo "============================================================"
