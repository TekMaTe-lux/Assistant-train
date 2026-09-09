#!/usr/bin/env bash
set -euo pipefail

ROOT="${MOORAIL_ROOT:-/opt/labetaillere-map-v2-src/map-v2}"
PUBLIC="$ROOT/public"
JS="$PUBLIC/moorail-route-editor-stops.js"
HTML="$PUBLIC/moorail-route-editor.html"
HTML2="$PUBLIC/moorail-route-editor-stops.html"
STATE="$ROOT/data/route-editor/moorail-route-editor-state-v1.json"
LIVE="$PUBLIC/data/moorail-live-v1/sections.json"
NETWORK="$PUBLIC/data/moorail-network-v8/network.json"
BUILDER="$ROOT/scripts/build-moorail-network-v8.py"
GTFS="${MOORAIL_LIVE_GTFS_DIR:-/var/www/html/gtfs/static}"
DERIVED_SECTIONS="$ROOT/data/route-editor/moorail-validated-sections-v1.json"
DERIVED_TEMPLATES="$ROOT/data/route-editor/moorail-route-templates-v1.json"
SERVICE="labetaillere-map-v2.service"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$ROOT/backups/moorail-v8_8-foreign-proxy-$STAMP"
TMP="$(mktemp -d /tmp/moorail-v88.XXXXXX)"
SUCCESS=0
RESTARTED=0

cleanup(){ rm -rf "$TMP"; }
rollback(){
  [[ "$SUCCESS" == 1 ]] && return 0
  echo "ROLLBACK MOO RAIL V8.8..." >&2
  for n in moorail-route-editor-stops.js moorail-route-editor.html moorail-route-editor-stops.html; do
    [[ -f "$BACKUP/$n" ]] && cp -a "$BACKUP/$n" "$PUBLIC/$n" || true
  done
  [[ -f "$BACKUP/state.json" ]] && cp -a "$BACKUP/state.json" "$STATE" || true
  [[ -f "$BACKUP/live.json" ]] && cp -a "$BACKUP/live.json" "$LIVE" || true
  [[ -f "$BACKUP/network.json" ]] && cp -a "$BACKUP/network.json" "$NETWORK" || true
  if [[ -f "$BACKUP/derived-sections.json" ]]; then cp -a "$BACKUP/derived-sections.json" "$DERIVED_SECTIONS"; elif [[ -f "$BACKUP/derived-sections.absent" ]]; then rm -f "$DERIVED_SECTIONS"; fi
  if [[ -f "$BACKUP/derived-templates.json" ]]; then cp -a "$BACKUP/derived-templates.json" "$DERIVED_TEMPLATES"; elif [[ -f "$BACKUP/derived-templates.absent" ]]; then rm -f "$DERIVED_TEMPLATES"; fi
  if [[ "$RESTARTED" == 1 ]]; then systemctl restart "$SERVICE" >/dev/null 2>&1 || true; fi
}
finish(){ rc=$?; trap - EXIT; rollback; cleanup; exit "$rc"; }
trap finish EXIT

[[ ${EUID:-$(id -u)} -eq 0 ]] || { echo "ERREUR: lancer avec sudo/root" >&2; exit 2; }
for f in "$JS" "$HTML" "$STATE" "$LIVE" "$NETWORK" "$BUILDER" "$GTFS/stops.txt"; do
  [[ -f "$f" ]] || { echo "ERREUR fichier absent: $f" >&2; exit 3; }
done

SERVICE_USER="$(systemctl show -p User --value "$SERVICE" 2>/dev/null || true)"
SERVICE_GROUP="$(systemctl show -p Group --value "$SERVICE" 2>/dev/null || true)"
[[ -n "$SERVICE_USER" ]] || SERVICE_USER=root
[[ -n "$SERVICE_GROUP" ]] || SERVICE_GROUP="$(id -gn "$SERVICE_USER" 2>/dev/null || echo root)"

echo "============================================================"
echo " MOO RAIL V8.8 — PROXY DROIT RESEAUX ETRANGERS"
echo "============================================================"
echo "Règle temporaire : tant que BE / LU / CH n'ont pas leur réseau"
echo "ferroviaire détaillé, une brique étrangère ne doit JAMAIS être"
echo "accrochée de force au RFN français : elle est tirée droit."
echo

echo "=== 0/9 PRE-FLIGHT ==="
systemctl is-active --quiet "$SERVICE"
curl -fsS --max-time 5 http://127.0.0.1:3111/api/map-v2/health > "$TMP/health-before.json"
python3 - "$TMP/health-before.json" "$NETWORK" <<'PY'
import json,sys
h=json.load(open(sys.argv[1]));n=json.load(open(sys.argv[2]))
assert h.get('ok') is True,h
assert n.get('version')==8,n.get('version')
print('Health :',h)
print('Network:',n.get('strictTripsToday'),'GV /',(n.get('stats') or {}).get('tasks'),'briques')
PY
grep -qF 'LB_MOORAIL_VALIDATED_SECTIONS_V8' "$JS"
grep -qF 'LB_MOORAIL_EDITOR_SAVE_V84' "$JS"
grep -qF 'LB_MOORAIL_LGV_ROUTER_V6' "$JS"
node --check "$JS"

if grep -qF 'LB_MOORAIL_FOREIGN_STRAIGHT_V88' "$JS"; then
  echo "ERREUR: V8.8 déjà présente dans l'éditeur" >&2
  exit 4
fi

echo "=== 1/9 DECOUVERTE DES GARES ETRANGERES BE / LU / CH ==="
python3 - "$GTFS/stops.txt" "$NETWORK" "$TMP/foreign.json" <<'PY'
import csv,json,re,sys,unicodedata,math
from pathlib import Path

def norm(s):
    s=unicodedata.normalize('NFKD',str(s or ''))
    return ''.join(c for c in s if not unicodedata.combining(c)).strip().lower()

stops_path,network_path,out=map(Path,sys.argv[1:])
country_prefix={'88':'BE','82':'LU','85':'CH'}
by={'BE':set(),'LU':set(),'CH':set()}

with stops_path.open('r',encoding='utf-8-sig',errors='replace',newline='') as f:
    for r in csv.DictReader(f):
        name=str(r.get('stop_name') or '').strip()
        if not name:continue
        blob=' '.join(str(r.get(k) or '') for k in ('stop_id','parent_station','stop_code'))
        nums=re.findall(r'(?<!\d)(\d{8})(?!\d)',blob)
        for num in nums:
            c=country_prefix.get(num[:2])
            if c:by[c].add(name)

# Filet de sécurité sur les noms usuels rencontrés dans les flux SNCF.
seed={
 'BE':['Bruxelles Midi','Bruxelles-Midi','Brussels Midi','Mons','Liège-Guillemins','Liege-Guillemins','Tournai','Kortrijk','Antwerpen-Centraal'],
 'LU':['Luxembourg','Bettembourg','Esch-sur-Alzette','Rodange'],
 'CH':['Basel SBB','Bâle CFF','Bale CFF','Genève Cornavin','Geneve Cornavin','Genève','Geneve','Lausanne','Zürich HB','Zurich HB','Bern','Berne','Neuchâtel','Neuchatel','Vallorbe']
}
for c,names in seed.items():by[c].update(names)

# Ne garde aussi que les noms réellement utiles au réseau actuel + seeds,
# afin de ne pas injecter des centaines de variantes inutiles dans le JS.
net=json.load(open(network_path,encoding='utf-8'))
used=set()
for t in net.get('tasks') or []:
    for side in ('from','to'):
        n=(t.get(side) or {}).get('name')
        if n:used.add(norm(n))
for variants in (net.get('trainRoutes') or {}).values():
    for v in variants or []:
        for s in v.get('stops') or []:
            n=s.get('name')
            if n:used.add(norm(n))

for c in by:
    discovered={x for x in by[c] if norm(x) in used}
    # garde les seeds même si la variante exacte n'est pas actuellement utilisée,
    # pour que l'éditeur sache les reconnaître au prochain refresh GTFS.
    discovered.update(seed[c])
    by[c]=sorted(discovered)

Path(out).write_text(json.dumps(by,ensure_ascii=False,indent=2),encoding='utf-8')
for c in ('BE','LU','CH'):
    print(f' {c}: {len(by[c])} noms reconnus')
    print('    '+', '.join(by[c][:18]))

# Contrôle explicite du cas qui vient de révéler le problème.
alln={norm(x):c for c,names in by.items() for x in names}
assert alln.get(norm('Bruxelles Midi'))=='BE',by
PY

cat "$TMP/foreign.json"

echo "=== 2/9 BACKUP COMPLET ==="
mkdir -p "$BACKUP"
cp -a "$JS" "$BACKUP/moorail-route-editor-stops.js"
cp -a "$HTML" "$BACKUP/moorail-route-editor.html"
[[ -f "$HTML2" ]] && cp -a "$HTML2" "$BACKUP/moorail-route-editor-stops.html" || true
cp -a "$STATE" "$BACKUP/state.json"
cp -a "$LIVE" "$BACKUP/live.json"
cp -a "$NETWORK" "$BACKUP/network.json"
[[ -f "$DERIVED_SECTIONS" ]] && cp -a "$DERIVED_SECTIONS" "$BACKUP/derived-sections.json" || touch "$BACKUP/derived-sections.absent"
[[ -f "$DERIVED_TEMPLATES" ]] && cp -a "$DERIVED_TEMPLATES" "$BACKUP/derived-templates.json" || touch "$BACKUP/derived-templates.absent"
echo "Backup : $BACKUP"

echo "=== 3/9 PATCH EDITEUR : ETRANGER = LIGNE DROITE, JAMAIS RFN FR ==="
cp -a "$JS" "$TMP/editor.js"
python3 - "$TMP/editor.js" "$TMP/foreign.json" <<'PY'
from pathlib import Path
import json,re,sys
p=Path(sys.argv[1]);foreign=json.load(open(sys.argv[2],encoding='utf-8'));s=p.read_text(encoding='utf-8')
marker='/* LB_MOORAIL_FOREIGN_STRAIGHT_V88 */'
if marker in s:raise SystemExit('V8.8 déjà présente')

helper=marker+r'''
const LB_FOREIGN_PROXY_NAMES_V88 = __FOREIGN__;
const LB_FOREIGN_PROXY_LOOKUP_V88 = (()=>{
  const m=new Map();
  for(const [country,names] of Object.entries(LB_FOREIGN_PROXY_NAMES_V88)){
    for(const name of names||[])m.set(norm(name),country);
  }
  return m;
})();
function lbForeignProxyCountryV88(stop){
  return LB_FOREIGN_PROXY_LOOKUP_V88.get(norm(stop?.name||stop?.stop_name||stop?.label||''))||'';
}
function lbForeignProxyPairV88(pair){
  if(!Array.isArray(pair)||pair.length<2)return null;
  const a=lbForeignProxyCountryV88(pair[0]),b=lbForeignProxyCountryV88(pair[1]);
  if(!a&&!b)return null;
  return {fromCountry:a||'FR',toCountry:b||'FR',country:a||b};
}
'''.replace('__FOREIGN__',json.dumps(foreign,ensure_ascii=False,separators=(',',':')))

anchor='function esc(s)'
idx=s.find(anchor)
if idx<0:raise SystemExit('ERREUR ancre function esc absente')
s=s[:idx]+helper+'\n'+s[idx:]

# Quand une brique contient une gare étrangère reconnue, on ne charge pas le RFN
# français pour la gare étrangère : le jaune devient un proxy droit contrôlé.
old="""  setStatus(`Chargement du RFN entre ${esc(pair[0].name)} et ${esc(pair[1].name)}…`);\n  await loadCorridor(pair[0],pair[1]);\n  buildGraph();renderFixed();renderVia();await recompute();\n"""
new="""  const lbProxyV88=lbForeignProxyPairV88(pair);\n  if(lbProxyV88){\n    state.graph=null;state.via=[];\n    el.legHelp.innerHTML=`<b>${esc(pair[0].name)}</b> → <b>${esc(pair[1].name)}</b><br><b>PROXY FRONTIÈRE V8.8</b> : réseau ${esc(lbProxyV88.country)} détaillé absent. Le trajet est volontairement tiré droit et ne s'accroche pas au RFN français.`;\n    renderFixed();renderVia();await recompute();\n    return;\n  }\n  setStatus(`Chargement du RFN entre ${esc(pair[0].name)} et ${esc(pair[1].name)}…`);\n  await loadCorridor(pair[0],pair[1]);\n  buildGraph();renderFixed();renderVia();await recompute();\n"""
if old not in s:raise SystemExit('ERREUR ancre activateLeg RFN absente')
s=s.replace(old,new,1)

old2="""  const p=stopPair();if(!p||!state.graph)return;\n  const anchors=[];const A=anchorAt(L.latLng(+p[0].lat,+p[0].lon),'stop'),B=anchorAt(L.latLng(+p[1].lat,+p[1].lon),'stop');if(!A||!B){setStatus('Impossible d’accrocher une gare au RFN détaillé.','bad');return;}\n"""
new2="""  const p=stopPair();if(!p)return;\n  const lbProxyV88=lbForeignProxyPairV88(p);\n  if(lbProxyV88){\n    const a=[+p[0].lon,+p[0].lat],b=[+p[1].lon,+p[1].lat];\n    if(!a.every(Number.isFinite)||!b.every(Number.isFinite)){setStatus('Coordonnées de la brique étrangère invalides.','bad');return;}\n    const km=distanceLL(a,b)/1000;\n    const steps=Math.max(1,Math.ceil(km/5));\n    const all=[];\n    for(let i=0;i<=steps;i++){const t=i/steps;all.push([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t]);}\n    state.routeCoords=all;state.routeKm=km;state.routeErrors=0;\n    const line=L.polyline(all.map(x=>[x[1],x[0]]),{pane:'route',color:'#ffd84d',weight:5,opacity:.96,dashArray:'14 9'}).addTo(map);state.routeLayers.push(line);\n    updateMetrics(1,km,0);\n    setStatus(`✓ PROXY FRONTIÈRE ${esc(lbProxyV88.country)} : ${esc(p[0].name)} → ${esc(p[1].name)} tiré droit sur ${km.toFixed(1)} km. Temporaire jusqu’à intégration du réseau étranger.`,`ok`);\n    return;\n  }\n  if(!state.graph)return;\n  const anchors=[];const A=anchorAt(L.latLng(+p[0].lat,+p[0].lon),'stop'),B=anchorAt(L.latLng(+p[1].lat,+p[1].lon),'stop');if(!A||!B){setStatus('Impossible d’accrocher une gare au RFN détaillé.','bad');return;}\n"""
if old2 not in s:raise SystemExit('ERREUR ancre recompute absente')
s=s.replace(old2,new2,1)

# Métadonnée explicite : la source reste V8 pour être considérée comme canonique,
# mais l'engine dit clairement qu'il s'agit d'un proxy droit temporaire.
old3="corridor:state.route.corridor,validationEngine:'ROUTER_V6',"
new3="corridor:state.route.corridor,validationEngine:(lbForeignProxyPairV88(pair)?'FOREIGN_STRAIGHT_V88':'ROUTER_V6'),geometryMode:(lbForeignProxyPairV88(pair)?'FOREIGN_STRAIGHT_PROXY':'RFN_ROUTED'),"
if old3 not in s:raise SystemExit('ERREUR ancre validationEngine V8.4 absente')
s=s.replace(old3,new3,1)

p.write_text(s,encoding='utf-8')
print('Patch éditeur V8.8 préparé')
PY
node --check "$TMP/editor.js"
grep -qF 'LB_MOORAIL_FOREIGN_STRAIGHT_V88' "$TMP/editor.js"
grep -qF 'FOREIGN_STRAIGHT_V88' "$TMP/editor.js"
grep -qF "dashArray:'14 9'" "$TMP/editor.js"

echo "=== 4/9 DRY-RUN BRUXELLES ↔ LILLE ==="
python3 - "$NETWORK" "$TMP/foreign.json" <<'PY'
import json,math,sys,unicodedata

def norm(s):
    s=unicodedata.normalize('NFKD',str(s or ''))
    return ''.join(c for c in s if not unicodedata.combining(c)).strip().lower()
def hav(a,b):
    R=6371.0
    p1,p2=math.radians(a['lat']),math.radians(b['lat'])
    dp=math.radians(b['lat']-a['lat']);dl=math.radians(b['lon']-a['lon'])
    x=math.sin(dp/2)**2+math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
    return 2*R*math.atan2(math.sqrt(x),math.sqrt(1-x))

n=json.load(open(sys.argv[1],encoding='utf-8'))
hit=None
for t in n.get('tasks') or []:
    a=(t.get('from') or {}).get('name');b=(t.get('to') or {}).get('name')
    if {norm(a),norm(b)}=={norm('Lille Europe'),norm('Bruxelles Midi')}:
        hit=t;break
assert hit,'Brique Lille Europe ↔ Bruxelles Midi absente du réseau V8'
a=hit['from'];b=hit['to'];km=hav(a,b)
print('Brique :',a['name'],'↔',b['name'])
print('Distance droite : %.1f km'%km)
print('Impact aujourd’hui :',hit.get('impactToday'),'train(s)')
print('Trains :',', '.join(str(x) for x in (hit.get('trainNumbers') or [])[:20]))
assert 70 < km < 140,km
print('DRY-RUN PROXY BRUXELLES/LILLE : OK')
PY

echo "=== 5/9 INSTALLATION EDITEUR V8.8 ==="
install -o "$SERVICE_USER" -g "$SERVICE_GROUP" -m 0644 "$TMP/editor.js" "$JS"
for f in "$HTML" "$HTML2"; do
  [[ -f "$f" ]] || continue
  python3 - "$f" <<'PY'
from pathlib import Path
import re,sys
p=Path(sys.argv[1]);s=p.read_text(encoding='utf-8')
s=re.sub(r'/map-v2/moorail-route-editor-stops\.js\?v=[^"\']+', '/map-v2/moorail-route-editor-stops.js?v=8.8', s)
p.write_text(s,encoding='utf-8')
PY
done
node --check "$JS"

echo "=== 6/9 PUBLICATION AUTOMATIQUE DES PROXIES ETRANGERS MANQUANTS ==="
python3 - "$NETWORK" "$LIVE" "$TMP/foreign.json" <<'PY'
import json,sys,unicodedata,math,urllib.request,urllib.error
from pathlib import Path

def norm(s):
    s=unicodedata.normalize('NFKD',str(s or ''))
    return ''.join(c for c in s if not unicodedata.combining(c)).strip().lower()
def hav(a,b):
    R=6371.0
    p1,p2=math.radians(a['lat']),math.radians(b['lat'])
    dp=math.radians(b['lat']-a['lat']);dl=math.radians(b['lon']-a['lon'])
    x=math.sin(dp/2)**2+math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
    return 2*R*math.atan2(math.sqrt(x),math.sqrt(1-x))
def post(payload):
    req=urllib.request.Request('http://127.0.0.1:3111/api/map-v2/route-editor/save',data=json.dumps(payload,ensure_ascii=False).encode(),headers={'content-type':'application/json'},method='POST')
    with urllib.request.urlopen(req,timeout=20) as r:return json.loads(r.read())

network=json.load(open(sys.argv[1],encoding='utf-8'))
live=json.load(open(sys.argv[2],encoding='utf-8'))
foreign=json.load(open(sys.argv[3],encoding='utf-8'))
lookup={norm(name):country for country,names in foreign.items() for name in names}
live_ids={str(x.get('sectionId') or '') for x in live.get('pairs') or []}

candidates=[]
for t in network.get('tasks') or []:
    a=t.get('from') or {};b=t.get('to') or {}
    ca=lookup.get(norm(a.get('name')),'');cb=lookup.get(norm(b.get('name')),'')
    if not ca and not cb:continue
    if str(t.get('sectionId') or '') in live_ids:continue
    try:
        aa={'lat':float(a['lat']),'lon':float(a['lon'])};bb={'lat':float(b['lat']),'lon':float(b['lon'])}
    except:continue
    km=hav(aa,bb)
    if km>350:
        print('  SKIP >350 km :',a.get('name'),'→',b.get('name'),'%.1f km'%km)
        continue
    candidates.append((t,a,b,ca or cb,km))

print('Proxies étrangers manquants à créer :',len(candidates))
for t,a,b,country,km in candidates:
    steps=max(1,math.ceil(km/5))
    coords=[]
    for i in range(steps+1):
        q=i/steps
        coords.append([float(a['lon'])+(float(b['lon'])-float(a['lon']))*q,float(a['lat'])+(float(b['lat'])-float(a['lat']))*q])
    payload={
      'routeId':t.get('routeId') or ('network-foreign-'+country.lower()),
      'sectionId':t.get('sectionId'),'status':'validated',
      'source':'MOORAIL_VALIDATED_SECTIONS_V8','canonical':True,'canonicalSectionId':t.get('sectionId'),
      'corridor':t.get('corridor') or ('FOREIGN_'+country),
      'validationEngine':'FOREIGN_STRAIGHT_V88','geometryMode':'FOREIGN_STRAIGHT_PROXY','foreignProxyCountry':country,
      'route':{'origin':'Réseau','destination':t.get('corridorLabel') or t.get('corridor') or country,'signature':t.get('corridor') or country},
      'stopFrom':{'name':a.get('name'),'lat':float(a['lat']),'lon':float(a['lon'])},
      'stopTo':{'name':b.get('name'),'lat':float(b['lat']),'lon':float(b['lon'])},
      'waypoints':[],'coordinates':coords,'distanceKm':round(km,3)
    }
    d=post(payload)
    if not d.get('ok'):raise SystemExit('SAVE échoué '+str((a.get('name'),b.get('name'),d)))
    print('  ✅',country,'|',a.get('name'),'↔',b.get('name'),'| %.1f km'%km,'|',t.get('sectionId'))
PY

# L'API régénère sections.json à chaque save. On demande ensuite au builder V8
# de refléter les nouveaux statuts VALIDATED_V8 dans network.json.
systemctl start moorail-network-v8-refresh.service
for _ in $(seq 1 30); do
  if ! systemctl is-active --quiet moorail-network-v8-refresh.service; then break; fi
  sleep 1
done

# Certains systèmes considèrent un oneshot réussi comme inactive : on vérifie le résultat,
# pas l'état final du service.

echo "=== 7/9 VERIFICATION LIVE + ETAT BRUXELLES/LILLE ==="
python3 - "$STATE" "$LIVE" "$NETWORK" <<'PY'
import json,sys,unicodedata

def norm(s):
    s=unicodedata.normalize('NFKD',str(s or ''))
    return ''.join(c for c in s if not unicodedata.combining(c)).strip().lower()
state=json.load(open(sys.argv[1],encoding='utf-8'));live=json.load(open(sys.argv[2],encoding='utf-8'));net=json.load(open(sys.argv[3],encoding='utf-8'))
want={norm('Lille Europe'),norm('Bruxelles Midi')}
rows=[x for x in live.get('pairs') or [] if {norm(x.get('from')),norm(x.get('to'))}==want]
assert len(rows)>=2,rows
sid=str(rows[0].get('sectionId') or '')
sec=(state.get('sections') or {}).get(sid) or {}
assert sec.get('status')=='validated',sec
assert sec.get('validationEngine')=='FOREIGN_STRAIGHT_V88',sec.get('validationEngine')
assert sec.get('geometryMode')=='FOREIGN_STRAIGHT_PROXY',sec.get('geometryMode')
print('LIVE Bruxelles/Lille : OK | section',sid,'|',len(rows[0].get('coords') or []),'points')
print('STATE engine         :',sec.get('validationEngine'))
for t in net.get('tasks') or []:
    if {norm((t.get('from') or {}).get('name')),norm((t.get('to') or {}).get('name'))}==want:
        print('NETWORK status       :',t.get('status'),'| impact',t.get('impactToday'))
        assert t.get('status')=='VALIDATED_V8',t
        break
else:raise AssertionError('task Bruxelles/Lille absente après refresh')
PY

echo "=== 8/9 RESTART + PRODUIT SERVI ==="
RESTARTED=1
systemctl restart "$SERVICE"
for _ in $(seq 1 30); do
  if systemctl is-active --quiet "$SERVICE" && curl -fsS --max-time 2 http://127.0.0.1:3111/api/map-v2/health >/dev/null 2>&1; then break; fi
  sleep 1
done
systemctl is-active --quiet "$SERVICE"
curl -fsS --max-time 10 "http://127.0.0.1:3111/moorail-route-editor-stops.js?$(date +%s)" -o "$TMP/served.js"
grep -qF 'LB_MOORAIL_FOREIGN_STRAIGHT_V88' "$TMP/served.js"
grep -qF 'FOREIGN_STRAIGHT_V88' "$TMP/served.js"
echo "Editeur V8.8 servi : OK"

echo "=== 9/9 HEALTH FINAL ==="
HEALTH="$(curl -fsS --max-time 5 http://127.0.0.1:3111/api/map-v2/health)"
echo "$HEALTH"
python3 - "$TMP/health-before.json" <(printf '%s' "$HEALTH") <<'PY'
import json,sys
before=json.load(open(sys.argv[1]));after=json.load(open(sys.argv[2]))
assert after.get('ok') is True,after
assert after.get('network')==before.get('network'),(before,after)
print('Non-régression health/network : OK')
PY

SUCCESS=1
trap - EXIT
cleanup

echo
echo "============================================================"
echo " MOO RAIL V8.8 INSTALLE ET VALIDE"
echo "============================================================"
echo " - Belgique / Luxembourg / Suisse : proxy droit temporaire"
echo " - aucune gare étrangère reconnue n'est accrochée au RFN français"
echo " - proxies manquants publiés automatiquement dans sections.json"
echo " - Bruxelles Midi ↔ Lille Europe vérifié LIVE"
echo " - l'éditeur affiche ces proxies en jaune pointillé"
echo "Backup : $BACKUP"
echo "============================================================"
