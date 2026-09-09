#!/usr/bin/env bash
set -euo pipefail

ROOT="${MOORAIL_ROOT:-/opt/labetaillere-map-v2-src/map-v2}"
PUBLIC="$ROOT/public"
JS="$PUBLIC/moorail-route-editor-stops.js"
HTML="$PUBLIC/moorail-route-editor.html"
HTML2="$PUBLIC/moorail-route-editor-stops.html"
BUILDER="$ROOT/scripts/build-moorail-network-v8.py"
NETWORK="$PUBLIC/data/moorail-network-v8/network.json"
LIVE="$PUBLIC/data/moorail-live-v1/sections.json"
STATE="$ROOT/data/route-editor/moorail-route-editor-state-v1.json"
GTFS="${MOORAIL_LIVE_GTFS_DIR:-/var/www/html/gtfs/static}"
SERVICE="labetaillere-map-v2.service"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$ROOT/backups/moorail-v8_4-editor-network-$STAMP"
TMP="$(mktemp -d /tmp/moorail-v84.XXXXXX)"
SUCCESS=0
RESTARTED=0

cleanup(){ rm -rf "$TMP"; }
rollback(){
  [[ "$SUCCESS" == 1 ]] && return 0
  echo "ROLLBACK MOO RAIL V8.4..." >&2
  [[ -f "$BACKUP/build-moorail-network-v8.py" ]] && cp -a "$BACKUP/build-moorail-network-v8.py" "$BUILDER" || true
  [[ -f "$BACKUP/network.json" ]] && cp -a "$BACKUP/network.json" "$NETWORK" || true
  [[ -f "$BACKUP/moorail-route-editor-stops.js" ]] && cp -a "$BACKUP/moorail-route-editor-stops.js" "$JS" || true
  [[ -f "$BACKUP/moorail-route-editor.html" ]] && cp -a "$BACKUP/moorail-route-editor.html" "$HTML" || true
  [[ -f "$BACKUP/moorail-route-editor-stops.html" ]] && cp -a "$BACKUP/moorail-route-editor-stops.html" "$HTML2" || true
  if [[ "$RESTARTED" == 1 ]]; then systemctl restart "$SERVICE" >/dev/null 2>&1 || true; fi
}
finish(){ rc=$?; trap - EXIT; rollback; cleanup; exit "$rc"; }
trap finish EXIT

[[ ${EUID:-$(id -u)} -eq 0 ]] || { echo "ERREUR: lancer avec sudo/root" >&2; exit 2; }
for f in "$JS" "$HTML" "$BUILDER" "$NETWORK" "$STATE" "$LIVE" "$GTFS/trips.txt" "$GTFS/stop_times.txt" "$GTFS/stops.txt"; do
  [[ -f "$f" ]] || { echo "ERREUR fichier absent: $f" >&2; exit 3; }
done

SERVICE_USER="$(systemctl show -p User --value "$SERVICE" 2>/dev/null || true)"
SERVICE_GROUP="$(systemctl show -p Group --value "$SERVICE" 2>/dev/null || true)"
[[ -n "$SERVICE_USER" ]] || SERVICE_USER=root
[[ -n "$SERVICE_GROUP" ]] || SERVICE_GROUP="$(id -gn "$SERVICE_USER" 2>/dev/null || echo root)"

echo "============================================================"
echo " MOO RAIL V8.4 — EDITEUR FIABLE + COORDONNEES RESEAU"
echo "============================================================"
echo "Root   : $ROOT"
echo "Backup : $BACKUP"

echo "=== 0/8 PRE-FLIGHT ==="
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
grep -qF 'LB_MOORAIL_LGV_ROUTER_V6' "$JS"
node --check "$JS"

echo "=== 1/8 Backup complet ==="
mkdir -p "$BACKUP"
cp -a "$BUILDER" "$BACKUP/build-moorail-network-v8.py"
cp -a "$NETWORK" "$BACKUP/network.json"
cp -a "$JS" "$BACKUP/moorail-route-editor-stops.js"
cp -a "$HTML" "$BACKUP/moorail-route-editor.html"
[[ -f "$HTML2" ]] && cp -a "$HTML2" "$BACKUP/moorail-route-editor-stops.html" || true

echo "=== 2/8 Réparation constructeur réseau : JAMAIS de fausses coordonnées synthétiques ==="
cp -a "$BUILDER" "$TMP/builder.py"
python3 - "$TMP/builder.py" <<'PY'
from pathlib import Path
import re,sys
p=Path(sys.argv[1]);s=p.read_text(encoding='utf-8')
marker='# LB_MOORAIL_COORDINATE_RESOLVER_V84'
if marker not in s:
    old="""    stop_by_norm={norm(m['name']):m for m in stops.values()}\n    demand={}\n"""
    new="""    stop_by_norm={norm(m['name']):m for m in stops.values()}\n    # LB_MOORAIL_COORDINATE_RESOLVER_V84\n    def loose_name(value):\n        x=norm(value)\n        x=re.sub(r'\\bhall\\s*[0-9]+(?:\\s*[-/]\\s*[0-9]+)?\\b',' ',x)\n        x=x.replace('saint ','st ')\n        x=re.sub(r'[^a-z0-9]+',' ',x)\n        return ' '.join(x.split())\n    stop_by_loose=defaultdict(list)\n    for meta in stops.values():\n        stop_by_loose[loose_name(meta['name'])].append(meta)\n    def aliases_for_label(label):\n        n=norm(label);out=[label]\n        for sp in SPX:\n            for node in sp['_nodes']:\n                if n in node['norms'] or any(n==a for a in node['norms']):\n                    out.extend(node['aliases'])\n        return list(dict.fromkeys(out))\n    demand={}\n"""
    if old not in s:raise SystemExit('ERREUR ancre stop_by_norm absente')
    s=s.replace(old,new,1)

    old2="""    def station_meta(label, fallback):\n        if norm(fallback['name'])==norm(label):return dict(fallback)\n        meta=stop_by_norm.get(norm(label))\n        if meta:return dict(meta)\n        return {'name':label,'lat':fallback['lat'],'lon':fallback['lon']}\n"""
    new2="""    def station_meta(label, fallback=None):\n        # Une brique synthétique n'a le droit d'exister que si nous retrouvons\n        # les vraies coordonnées de la gare. Jamais de coordonnées copiées\n        # depuis l'extrémité commerciale d'un autre trajet.\n        candidates=aliases_for_label(label)\n        if fallback and loose_name(fallback.get('name'))==loose_name(label):\n            return {'name':label,'lat':fallback['lat'],'lon':fallback['lon']}\n        for cand in candidates:\n            meta=stop_by_norm.get(norm(cand))\n            if meta:return {'name':label,'lat':meta['lat'],'lon':meta['lon']}\n        for cand in candidates:\n            hits=stop_by_loose.get(loose_name(cand)) or []\n            if len(hits)==1:\n                meta=hits[0];return {'name':label,'lat':meta['lat'],'lon':meta['lon']}\n        # Dernier recours contrôlé : correspondance préfixe unique, utile pour\n        # « Paris Gare de Lyon Hall 1 - 2 » et variantes comparables.\n        wanted=[loose_name(x) for x in candidates if len(loose_name(x))>=8]\n        hits=[]\n        for key,vals in stop_by_loose.items():\n            if any(key.startswith(w+' ') or w.startswith(key+' ') for w in wanted):hits.extend(vals)\n        uniq={(round(float(x['lat']),6),round(float(x['lon']),6)):x for x in hits}\n        if len(uniq)==1:\n            meta=next(iter(uniq.values()));return {'name':label,'lat':meta['lat'],'lon':meta['lon']}\n        return None\n"""
    if old2 not in s:raise SystemExit('ERREUR ancre station_meta absente')
    s=s.replace(old2,new2,1)

    old3="""            if ex:\n                for fa,fb,cid,clabel in ex:\n                    ma=station_meta(fa,a);mb=station_meta(fb,b)\n                    add_edge(ma,mb,cid,clabel,trip)\n                    demand[canonical_id(ma['name'],mb['name'])]['derivedFrom'].add(a['name']+' → '+b['name'])\n            else:\n                corridor=infer_corridor(a['name'],b['name'])\n                add_edge(a,b,corridor,corridor.replace('_',' ').title(),trip)\n                demand[canonical_id(a['name'],b['name'])]['derivedFrom'].add(a['name']+' → '+b['name'])\n"""
    new3="""            if ex:\n                resolved=[]\n                for fa,fb,cid,clabel in ex:\n                    ma=station_meta(fa,a);mb=station_meta(fb,b)\n                    if not ma or not mb:\n                        resolved=[];break\n                    resolved.append((ma,mb,cid,clabel))\n                if resolved:\n                    for ma,mb,cid,clabel in resolved:\n                        add_edge(ma,mb,cid,clabel,trip)\n                        demand[canonical_id(ma['name'],mb['name'])]['derivedFrom'].add(a['name']+' → '+b['name'])\n                else:\n                    corridor=infer_corridor(a['name'],b['name'])\n                    add_edge(a,b,corridor,corridor.replace('_',' ').title(),trip)\n                    demand[canonical_id(a['name'],b['name'])]['derivedFrom'].add(a['name']+' → '+b['name']+' [spine non résolue]')\n            else:\n                corridor=infer_corridor(a['name'],b['name'])\n                add_edge(a,b,corridor,corridor.replace('_',' ').title(),trip)\n                demand[canonical_id(a['name'],b['name'])]['derivedFrom'].add(a['name']+' → '+b['name'])\n"""
    if old3 not in s:raise SystemExit('ERREUR ancre spine expansion absente')
    s=s.replace(old3,new3,1)

p.write_text(s,encoding='utf-8')
PY
python3 -m py_compile "$TMP/builder.py"

echo "=== 3/8 Réparation éditeur : tableaux LGV valides + sauvegarde vérifiée ==="
cp -a "$JS" "$TMP/editor.js"
python3 - "$TMP/editor.js" <<'PY'
from pathlib import Path
import re,sys
p=Path(sys.argv[1]);s=p.read_text(encoding='utf-8')

# Remplace entièrement les deux tableaux : aucune insertion fragile de virgule.
core="""const LB_LGV_CORE_CODES = [\n  '005000', // LGV Est\n  '014000', // LGV Rhin-Rhône\n  '216000','226000', // LGV Nord\n  '431000','429000', // LGV Atlantique\n  '408000', // LGV Bretagne-Pays de la Loire\n  '566000', // LGV Sud Europe Atlantique\n  '752000', // LGV Sud-Est\n  '834000','834100' // LGV Méditerranée + branche\n];"""
conn="""const LB_LGV_CONNECTOR_PREFIXES = [\n  '0053','0143','2163','2263','4313','4293','4083','5663','7523','8343'\n];"""
s,n1=re.subn(r"const LB_LGV_CORE_CODES\s*=\s*\[.*?\];",core,s,count=1,flags=re.S)
s,n2=re.subn(r"const LB_LGV_CONNECTOR_PREFIXES\s*=\s*\[.*?\];",conn,s,count=1,flags=re.S)
if n1!=1 or n2!=1:raise SystemExit(f'ERREUR tableaux V6 introuvables core={n1} conn={n2}')

# Validation V8 autonome : POST -> relecture état -> confirmation live.
new_validate=r'''async function validateLeg(){
  const sec=leg(),pair=stopPair();
  if(!sec||!pair){setStatus('Aucune brique sélectionnée.','bad');return;}
  if(state.routeErrors||!Array.isArray(state.routeCoords)||state.routeCoords.length<2){
    setStatus(`Impossible de valider : le tracé n’est pas continu (${state.routeErrors||0} erreur(s), ${state.routeCoords?.length||0} point(s)).`,`bad`);return;
  }
  const payload={
    routeId:(state.route.saveRouteId||state.route.id),sectionId:sec.id,status:'validated',
    source:'MOORAIL_VALIDATED_SECTIONS_V8',canonical:true,canonicalSectionId:sec.id,
    corridor:state.route.corridor,validationEngine:'ROUTER_V6',
    route:{origin:'Réseau',destination:state.route.corridorLabel||state.route.corridor,signature:state.route.corridor},
    stopFrom:{name:pair[0].name,lat:+pair[0].lat,lon:+pair[0].lon},
    stopTo:{name:pair[1].name,lat:+pair[1].lat,lon:+pair[1].lon},
    waypoints:state.via.map(x=>({lat:x.lat,lon:x.lon})),coordinates:state.routeCoords,
    distanceKm:+state.routeKm.toFixed(3)
  };
  try{
    setStatus(`Enregistrement V8 de ${esc(pair[0].name)} → ${esc(pair[1].name)}…`,'warn');
    const r=await fetch(`${API}/save`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
    const raw=await r.text();let d={};try{d=JSON.parse(raw)}catch(_){d={error:raw||`HTTP ${r.status}`}}
    if(!r.ok||!d.ok)throw new Error(d.error||`HTTP ${r.status}`);

    const sv=await fetch(`${API}/state?t=${Date.now()}`,{cache:'no-store'}).then(x=>{if(!x.ok)throw new Error(`relecture état HTTP ${x.status}`);return x.json()});
    const check=sv?.sections?.[sec.id];
    if(!check||check.status!=='validated')throw new Error('la section n’est pas présente dans l’état après sauvegarde');
    state.serverState=sv;state.route.networkStatus='VALIDATED_V8';

    let liveOk=false;
    try{
      const lv=await fetch(`/map-v2/data/moorail-live-v1/sections.json?v=${Date.now()}`,{cache:'no-store'}).then(x=>x.json());
      liveOk=(lv?.pairs||[]).some(x=>String(x.sectionId||'')===String(sec.id));
    }catch(_){}

    renderRoutes();renderLegs();
    setStatus(liveOk
      ? `✓ Brique V8 VALIDÉE ET LIVE : ${esc(pair[0].name)} → ${esc(pair[1].name)}.`
      : `✓ Brique V8 sauvegardée : ${esc(pair[0].name)} → ${esc(pair[1].name)}. Le live sera rechargé au prochain rafraîchissement.`,
      'ok');
  }catch(e){
    console.error('[MOO RAIL V8.4 SAVE]',e);
    setStatus(`ÉCHEC VALIDATION V8 : ${esc(e.message||e)}`,'bad');
  }
}'''
pat=re.compile(r"async function validateLeg\(\)\{.*?\n\}\n\nasync function refreshPublishPreview",re.S)
if pat.search(s):
    s=pat.sub(new_validate+'\n\nasync function refreshPublishPreview',s,count=1)
else:
    pat2=re.compile(r"async function validateLeg\(\)\{.*?\n\}\n\n\}\)\(\);",re.S)
    if not pat2.search(s):raise SystemExit('ERREUR fonction validateLeg introuvable')
    s=pat2.sub(new_validate+'\n\n})();',s,count=1)

if '/* LB_MOORAIL_EDITOR_SAVE_V84 */' not in s:
    s=s.replace('/* LB_MOORAIL_VALIDATED_SECTIONS_V8 */','/* LB_MOORAIL_VALIDATED_SECTIONS_V8 */\n/* LB_MOORAIL_EDITOR_SAVE_V84 */',1)
p.write_text(s,encoding='utf-8')
PY
node --check "$TMP/editor.js"
grep -qF 'LB_MOORAIL_EDITOR_SAVE_V84' "$TMP/editor.js"
grep -qF "'566000'" "$TMP/editor.js"
grep -qF "'834000','834100'" "$TMP/editor.js"

echo "=== 4/8 Dry-run réseau réparé + contrôles géographiques ==="
python3 "$TMP/builder.py" --root "$ROOT" --gtfs "$GTFS" --output "$TMP/network.json" > "$TMP/build.out"
cat "$TMP/build.out"
python3 - "$TMP/network.json" <<'PY'
import json,sys,math,unicodedata
p=json.load(open(sys.argv[1]));assert p.get('version')==8,p
assert 400<=p.get('strictTripsToday',0)<=1000,p.get('strictTripsToday')
assert all((p.get('controls') or {}).get('mustBePresent',{}).values()),p.get('controls')
assert all((p.get('controls') or {}).get('mustBeAbsent',{}).values()),p.get('controls')
def norm(s):
 s=unicodedata.normalize('NFKD',str(s or ''));return ''.join(c for c in s if not unicodedata.combining(c)).strip().lower()
def hav(a,b):
 R=6371.;p1,p2=math.radians(a[0]),math.radians(b[0]);dp=math.radians(b[0]-a[0]);dl=math.radians(b[1]-a[1]);x=math.sin(dp/2)**2+math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2;return 2*R*math.asin(min(1,math.sqrt(x)))
def find(a,b):
 for t in p.get('tasks') or []:
  if {norm((t.get('from') or {}).get('name')),norm((t.get('to') or {}).get('name'))}=={norm(a),norm(b)}:return t
checks=[
 ('Lyon Part Dieu','Mâcon-Loché TGV',120),
 ('Mâcon-Loché TGV','Le Creusot - Montceau-les-Mines - Montchanin TGV',150),
 ('Le Creusot - Montceau-les-Mines - Montchanin TGV','Paris Gare de Lyon',400),
]
for a,b,limit in checks:
 t=find(a,b)
 if not t:
  print('INFO tâche non présente:',a,'↔',b);continue
 A=t['from'];B=t['to'];d=hav((float(A['lat']),float(A['lon'])),(float(B['lat']),float(B['lon'])))
 print(f'GEO {a} ↔ {b}: {d:.1f} km')
 assert 2<d<limit,(a,b,d,A,B)
# aucune brique de spine distincte ne doit avoir des coordonnées quasi identiques
bad=[]
for t in p.get('tasks') or []:
 c=str(t.get('corridor') or '')
 if not (c.startswith('LGV_') or c=='INTERCONNEXION_EST'):continue
 A=t.get('from') or {};B=t.get('to') or {}
 try:d=hav((float(A['lat']),float(A['lon'])),(float(B['lat']),float(B['lon'])))
 except:continue
 if norm(A.get('name'))!=norm(B.get('name')) and d<1:bad.append((A.get('name'),B.get('name'),d))
assert not bad,bad[:10]
print('Contrôles géographiques : OK')
PY

echo "=== 5/8 Diagnostic exact TGV 2656 AVANT installation ==="
python3 - "$GTFS" "$TMP/network.json" "$LIVE" <<'PY'
import csv,json,sys,unicodedata,hashlib
from pathlib import Path
gtfs=Path(sys.argv[1]);net=json.load(open(sys.argv[2]));live=json.load(open(sys.argv[3]))
def rows(p):
 with open(p,encoding='utf-8-sig',errors='replace',newline='') as f:yield from csv.DictReader(f)
def norm(s):
 s=unicodedata.normalize('NFKD',str(s or ''));return ''.join(c for c in s if not unicodedata.combining(c)).strip().lower()
def cid(a,b):
 aa,bb=sorted((norm(a),norm(b)));return 'sec-'+hashlib.sha1((aa+'\0'+bb).encode()).hexdigest()[:16]
stops={str(x.get('stop_id')):str(x.get('stop_name') or x.get('stop_id')) for x in rows(gtfs/'stops.txt')}
tids=[]
for t in rows(gtfs/'trips.txt'):
 num=str(t.get('trip_short_name') or t.get('trip_headsign') or '')
 if num=='2656' or str(t.get('trip_id') or '').upper().startswith('OCESN2656'):tids.append(str(t.get('trip_id')))
seq={x:[] for x in tids}
for r in rows(gtfs/'stop_times.txt'):
 tid=str(r.get('trip_id') or '')
 if tid not in seq:continue
 try:o=int(float(r.get('stop_sequence') or 0))
 except:o=0
 seq[tid].append((o,stops.get(str(r.get('stop_id')),str(r.get('stop_id')))))
livepairs={(norm(x.get('from')),norm(x.get('to'))):x for x in live.get('pairs') or []}
tasks={str(x.get('sectionId')):x for x in net.get('tasks') or []}
print('Variantes GTFS 2656 :',len(tids))
for tid in tids[:10]:
 ss=[n for _,n in sorted(seq[tid])]
 print(' ',tid)
 print('   ',' → '.join(ss))
 for a,b in zip(ss,ss[1:]):
  task=tasks.get(cid(a,b));hit=livepairs.get((norm(a),norm(b)))
  print('   ',a,'→',b,'| task=',task.get('status') if task else 'ABSENTE','| live=',bool(hit),'| id=',cid(a,b))
PY

echo "=== 6/8 Installation fichiers réparés ==="
install -o "$SERVICE_USER" -g "$SERVICE_GROUP" -m 0755 "$TMP/builder.py" "$BUILDER"
install -o root -g root -m 0644 "$TMP/editor.js" "$JS"
install -o "$SERVICE_USER" -g "$SERVICE_GROUP" -m 0644 "$TMP/network.json" "$NETWORK"
python3 - "$HTML" "$HTML2" <<'PY'
from pathlib import Path
import re,sys
for raw in sys.argv[1:]:
 p=Path(raw)
 if not p.exists():continue
 s=p.read_text(encoding='utf-8')
 s=re.sub(r'/map-v2/moorail-route-editor-stops\.js\?v=[^"\']+','/map-v2/moorail-route-editor-stops.js?v=8.4',s)
 p.write_text(s,encoding='utf-8')
PY

echo "=== 7/8 Redémarrage + produit SERVI ==="
RESTARTED=1
systemctl restart "$SERVICE"
for _ in $(seq 1 30); do
  if systemctl is-active --quiet "$SERVICE" && curl -fsS --max-time 2 http://127.0.0.1:3111/api/map-v2/health >/dev/null 2>&1; then break; fi
  sleep 1
done
systemctl is-active --quiet "$SERVICE"
curl -fsS --max-time 8 "http://127.0.0.1:3111/moorail-route-editor-stops.js?v=$STAMP" -o "$TMP/served.js"
curl -fsS --max-time 8 "http://127.0.0.1:3111/moorail-route-editor.html?v=$STAMP" -o "$TMP/served.html"
curl -fsS --max-time 8 "http://127.0.0.1:3111/data/moorail-network-v8/network.json?v=$STAMP" -o "$TMP/served-network.json"
node --check "$TMP/served.js"
grep -qF 'LB_MOORAIL_EDITOR_SAVE_V84' "$TMP/served.js"
grep -qF 'V8 · VALIDATED SECTIONS' "$TMP/served.html"
python3 - "$TMP/served-network.json" <<'PY'
import json,sys
p=json.load(open(sys.argv[1]));assert p.get('version')==8,p
print('Network servi :',p.get('strictTripsToday'),'GV /',(p.get('stats') or {}).get('tasks'),'briques')
PY

echo "=== 8/8 Test API de sauvegarde SANS écrire : erreurs explicites ==="
HTTP="$(curl -sS -o "$TMP/api-test.json" -w '%{http_code}' -X POST \
  -H 'content-type: application/json' \
  --data '{"routeId":"network-test","sectionId":"sec-test-v84","coordinates":[]}' \
  http://127.0.0.1:3111/api/map-v2/route-editor/save)"
cat "$TMP/api-test.json"; echo
[[ "$HTTP" == "400" ]]
grep -q 'Géométrie invalide' "$TMP/api-test.json"
echo "API save joignable et validation serveur active : OK"

SUCCESS=1
trap - EXIT
cleanup

echo
echo "============================================================"
echo " MOO RAIL V8.4 INSTALLE ET VALIDE"
echo "============================================================"
echo " - coordonnées synthétiques de spines sécurisées"
echo " - plus aucun fallback vers les coordonnées d'une autre gare"
echo " - tableaux LGV V6 reconstruits proprement (SEA incluse)"
echo " - bouton Valider V8 : sauvegarde + relecture état + contrôle live"
echo " - erreurs de validation affichées explicitement dans l'éditeur"
echo " - diagnostic 2656 imprimé ci-dessus"
echo "Backup : $BACKUP"
echo "============================================================"
