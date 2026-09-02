#!/usr/bin/env bash
set -euo pipefail

ROOT="/opt/labetaillere-map-v2-src/map-v2"
BUILDER="$ROOT/scripts/build_dataset.py"
TRIPS="$ROOT/data/generated/trips.json"
PATHS="$ROOT/data/generated/paths.json"
SRC="$ROOT/data/sources"
NETWORK="$SRC/lignes-par-statut.geojson"
LGV="$SRC/lignes-lgv.geojson"
SPEED="$SRC/vitesses.geojson"
CONNECTIONS="$SRC/lignes-par-type.geojson"
EXTRA="$SRC/lux-network.geojson"
SERVICE="labetaillere-map-v2.service"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$ROOT/backups/tgv-pagny-north-v1-$STAMP"
TMP="$(mktemp -d /tmp/lb-tgv-pagny-north.XXXXXX)"
SUCCESS=0
RESTARTED=0

cleanup(){ rm -rf "$TMP"; }
rollback(){
  if [[ "$SUCCESS" -eq 1 ]]; then return; fi
  echo
  echo "ERREUR : rollback TGV Pagny/Vandières..."
  for f in "$BUILDER" "$TRIPS" "$PATHS"; do
    b="$BACKUP/$(basename "$f")"
    [[ -f "$b" ]] && cp -a "$b" "$f"
  done
  if [[ "$RESTARTED" -eq 1 ]]; then
    systemctl restart "$SERVICE" >/dev/null 2>&1 || true
  fi
}
trap 'rollback; cleanup' EXIT

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  echo "ERREUR : lancer avec sudo/root" >&2
  exit 2
fi
for f in "$BUILDER" "$TRIPS" "$PATHS" "$NETWORK" "$LGV" "$SPEED" "$CONNECTIONS"; do
  [[ -f "$f" ]] || { echo "ERREUR : fichier absent: $f" >&2; exit 3; }
done
mkdir -p "$BACKUP"
cp -a "$BUILDER" "$TRIPS" "$PATHS" "$BACKUP/"

echo "============================================================"
echo "TGV PARIS ↔ METZ/LUX — RACCORD NORD PAGNY/VANDIERES"
echo "============================================================"
echo "Backup : $BACKUP"
echo

# Le RFN audité contient deux branches distinctes :
# 005340 = raccord sud (côté Nancy / Vandières)
# 005341 = raccord nord (côté Metz / Pagny)
# Pour Paris <-> Metz/Thionville/Luxembourg, on donne au calcul un profil
# spécifique qui exclut pratiquement 005340 et impose le choix de 005341.
echo "=== 1/5 Patch durable du builder ==="
python3 - "$BUILDER" <<'PY'
from pathlib import Path
import re,sys
p=Path(sys.argv[1])
text=p.read_text(encoding='utf-8')
marker='# BER_TGV_PAGNY_NORTH_V1'
if marker not in text:
    # 1) Profil de routage par paire de gares.
    anchor='\ndef path_metrics(coords):'
    if text.count(anchor) != 1:
        raise SystemExit(f'ancre path_metrics: {text.count(anchor)} occurrence(s)')
    helper=r'''
# BER_TGV_PAGNY_NORTH_V1
# 005341 = raccord nord Pagny (Metz/Luxembourg) ; 005340 = raccord sud Vandières (Nancy).
def ber_tgv_pair_profile(profile, stop_a_name, stop_b_name):
    if profile != "tgv":
        return profile
    pair = norm(f"{stop_a_name} | {stop_b_name}")
    if "PARIS" in pair and any(token in pair for token in ("METZ", "THIONVILLE", "LUXEMBOURG")):
        return "tgv_pagny_north"
    return profile
'''
    text=text.replace(anchor,'\n'+helper+anchor,1)

    # 2) Coût Dijkstra : ce profil ne doit pas emprunter le raccord sud.
    old='''        if profile == "ter" and attrs.get("lgv"):
            cost *= 14
        elif profile == "tgv" and attrs.get("lgv"):
            # La vitesse nominale favorise déjà la LGV. Un bonus trop fort fait
            # dépasser le bon raccordement pour rester artificiellement plus
            # longtemps sur la LGV (cas Strasbourg -> Metz à Lucy).
            cost *= 0.95
        elif profile == "tgv" and speed < 160:
            cost *= 1.7
        return cost'''
    new='''        line = str(attrs.get("line") or "")
        if profile == "tgv_pagny_north":
            if line == "005340":
                cost *= 1000000
            elif line == "005341":
                cost *= 0.08
            if attrs.get("lgv"):
                cost *= 0.95
            elif speed < 160:
                cost *= 1.7
        elif profile == "ter" and attrs.get("lgv"):
            cost *= 14
        elif profile == "tgv" and attrs.get("lgv"):
            # La vitesse nominale favorise déjà la LGV. Un bonus trop fort fait
            # dépasser le bon raccordement pour rester artificiellement plus
            # longtemps sur la LGV (cas Strasbourg -> Metz à Lucy).
            cost *= 0.95
        elif profile == "tgv" and speed < 160:
            cost *= 1.7
        return cost'''
    if text.count(old) != 1:
        raise SystemExit(f'ancre edge_cost: {text.count(old)} occurrence(s)')
    text=text.replace(old,new,1)

    # 3) Seule la paire Paris <-> nord Lorraine utilise ce profil spécial.
    pattern=re.compile(r'(?P<i>[ \t]*)nodes = graph\.route_between_coords\(stop_a\["coord"\], stop_b\["coord"\], profile\)')
    m=list(pattern.finditer(text))
    if len(m) != 1:
        raise SystemExit(f'appel route_between_coords: {len(m)} occurrence(s)')
    indent=m[0].group('i')
    repl=(
        f'{indent}routing_profile = ber_tgv_pair_profile(profile, stop_a["name"], stop_b["name"])\n'
        f'{indent}nodes = graph.route_between_coords(stop_a["coord"], stop_b["coord"], routing_profile)'
    )
    text=pattern.sub(repl,text,count=1)
    p.write_text(text,encoding='utf-8')
    print('builder patché : raccord nord 005341 pour Paris ↔ Metz/Lux')
else:
    print('builder déjà patché')
PY
python3 -m py_compile "$BUILDER"

# Recalcule immédiatement les paths générés concernés avec le builder patché.
echo "=== 2/5 Recalcul ciblé des TGV concernés ==="
python3 - "$BUILDER" "$TRIPS" "$PATHS" "$NETWORK" "$LGV" "$SPEED" "$CONNECTIONS" "$EXTRA" "$TMP/trips.json" "$TMP/paths.json" <<'PY'
import hashlib,importlib.util,json,sys
from pathlib import Path
builder,trips_file,paths_file,network_file,lgv_file,speed_file,connections_file,extra_file,out_trips,out_paths=map(Path,sys.argv[1:])
spec=importlib.util.spec_from_file_location('lb_builder',builder)
b=importlib.util.module_from_spec(spec); spec.loader.exec_module(b)
trips=json.load(open(trips_file,encoding='utf-8'))
paths=json.load(open(paths_file,encoding='utf-8'))
network=b.load_geojson(network_file); lgv=b.load_geojson(lgv_file); speed_data=b.load_geojson(speed_file)
lgv_by_line=b.metadata_by_line(lgv,b.is_lgv_properties)
speed_by_line=b.metadata_by_line(speed_data,lambda props:b.parse_speed(props))
lgv_codes={code for code,values in lgv_by_line.items() if any(values)}
max_speeds={code:max(values) for code,values in speed_by_line.items() if values}
graph=b.RailGraph()
for feature in network.get('features',[]):
    props=feature.get('properties') or {}; code=b.line_code(props)
    status=str(b.pick(props,b.STATUS_KEYS,'EXPLOITE')); is_lgv=code in lgv_codes
    vmax=max_speeds.get(code,300.0 if is_lgv else 120.0)
    for coords in b.iter_lines(feature.get('geometry')):
        graph.add_line(coords,speed=vmax,is_lgv=is_lgv,status=status,code=code)
if extra_file.exists():
    extra=b.load_geojson(extra_file)
    for feature in extra.get('features',[]):
        props=feature.get('properties') or {}; code=b.line_code(props) or 'CFL'
        for coords in b.iter_lines(feature.get('geometry')):
            graph.add_line(coords,speed=120.0,is_lgv=False,status='EXPLOITE',code=code)
connections=b.load_geojson(connections_file)
for feature in connections.get('features',[]):
    props=feature.get('properties') or {}
    if not b.is_connector_properties(props): continue
    code=b.line_code(props); is_lgv=code in lgv_codes or b.is_lgv_properties(props)
    vmax=max_speeds.get(code,220.0 if is_lgv else 100.0)
    for coords in b.iter_lines(feature.get('geometry')):
        graph.add_line(coords,speed=vmax,is_lgv=is_lgv,status='EXPLOITE',code=code)
graph.connect_nearby_endpoints()

def eligible(trip):
    if str(trip.get('category') or '').lower() != 'tgv': return False
    stops=trip.get('stops') or []
    return any(b.ber_tgv_pair_profile('tgv',stops[i].get('name',''),stops[i+1].get('name',''))=='tgv_pagny_north' for i in range(len(stops)-1))

def build(trip):
    stops=trip.get('stops') or []; full=[]; offsets=[0.0]
    for i in range(len(stops)-1):
        a,z=stops[i],stops[i+1]
        ac=(float(a['lon']),float(a['lat'])); zc=(float(z['lon']),float(z['lat']))
        profile=b.ber_tgv_pair_profile('tgv',a.get('name',''),z.get('name',''))
        nodes=graph.route_between_coords(ac,zc,profile)
        if not nodes: return None
        seg=b.simplify_collinear([graph.coords[n] for n in nodes])
        if full and seg and full[-1]==seg[0]: seg=seg[1:]
        full.extend(seg)
        offsets.append(b.path_metrics(full)[1] if len(full)>1 else offsets[-1])
    if len(full)<2:return None
    cumulative,length=b.path_metrics(full)
    return full,cumulative,length,offsets

cache={}; changed=0; numbers=set(); reports=[]
for tid,trip in trips.items():
    if not eligible(trip): continue
    names=[str(s.get('name') or '') for s in (trip.get('stops') or [])]
    sig='BER_TGV_PAGNY_NORTH_V1|'+'|'.join(b.norm(x) for x in names)
    item=cache.get(sig)
    if item is None:
        built=build(trip)
        if not built: raise SystemExit(f'échec recalcul {tid}: {names}')
        coords,cumulative,length,offsets=built
        pid='p-ber-'+hashlib.sha1(sig.encode()).hexdigest()[:16]
        paths[pid]={'coordinates':coords,'cumulative':cumulative,'length':length,'stopOffsets':offsets,'profile':'tgv','pathSource':'BER_TGV_PAGNY_NORTH_V1','requiredConnector':'005341'}
        item=(pid,offsets,length); cache[sig]=item
    pid,offsets,length=item
    old=trip.get('pathId'); old_len=(paths.get(old) or {}).get('length')
    if old_len is not None and length > float(old_len)+15000:
        raise SystemExit(f'chemin anormalement long {tid}: {old_len} -> {length}')
    trip['pathId']=pid; trip['offsets']=offsets; trip['pathSource']='BER_TGV_PAGNY_NORTH_V1'
    changed+=1; numbers.add(str(trip.get('number') or '')); reports.append((tid,old,pid,old_len,length))
if changed<1 or '2870' not in numbers:
    raise SystemExit(f'aucun 2870 réparé: changed={changed} numbers={sorted(numbers)}')
json.dump(trips,open(out_trips,'w',encoding='utf-8'),ensure_ascii=False,separators=(',',':'))
json.dump(paths,open(out_paths,'w',encoding='utf-8'),ensure_ascii=False,separators=(',',':'))
print(f'trips réparés: {changed} ; numéros: {sorted(x for x in numbers if x)}')
for r in reports[:20]: print(' -',r)
PY
python3 -m json.tool "$TMP/trips.json" >/dev/null
python3 -m json.tool "$TMP/paths.json" >/dev/null
install -m 0644 "$TMP/trips.json" "$TRIPS"
install -m 0644 "$TMP/paths.json" "$PATHS"

echo "=== 3/5 Validation géométrique ==="
python3 - "$TRIPS" "$PATHS" <<'PY'
import json,math,sys
trips=json.load(open(sys.argv[1],encoding='utf-8')); paths=json.load(open(sys.argv[2],encoding='utf-8'))
rows=[t for t in trips.values() if str(t.get('number') or '')=='2870' and t.get('pathSource')=='BER_TGV_PAGNY_NORTH_V1']
if not rows: raise SystemExit('2870 non réparé')
def hav(c,p):
    R=6371.0; lon1,lat1=map(math.radians,c); lon2,lat2=map(math.radians,p)
    x=math.sin((lat2-lat1)/2)**2+math.cos(lat1)*math.cos(lat2)*math.sin((lon2-lon1)/2)**2
    return 2*R*math.asin(min(1,math.sqrt(x)))
north=(6.027062006107198,48.980617830259646)
south=(6.038063780587194,48.953176591009495)
for pid in sorted({t['pathId'] for t in rows}):
    coords=(paths.get(pid) or {}).get('coordinates') or []
    dn=min((hav(c,north) for c in coords),default=999)
    ds=min((hav(c,south) for c in coords),default=999)
    print(f'{pid}: points={len(coords)} · Pagny nord={dn:.3f} km · Vandières sud={ds:.3f} km')
    if dn>0.30: raise SystemExit(f'{pid}: ne rejoint pas correctement 005341')
    if ds<0.60: raise SystemExit(f'{pid}: passe encore trop près du raccord sud 005340')
print(f'2870: {len(rows)} variantes réparées')
PY

echo "=== 4/5 Redémarrage service carte ==="
RESTARTED=1
systemctl restart "$SERVICE"
for _ in $(seq 1 20); do
  if systemctl is-active --quiet "$SERVICE" && curl -fsS --max-time 2 http://127.0.0.1:3111/api/map-v2/health >/dev/null 2>&1; then break; fi
  sleep 1
done
systemctl is-active --quiet "$SERVICE"
curl -fsS --max-time 5 http://127.0.0.1:3111/api/map-v2/health

echo
echo "=== 5/5 API réelle 2870 ==="
python3 - <<'PY'
import json,math,urllib.parse,urllib.request
q=urllib.parse.urlencode({'stops':'Luxembourg|Thionville|Metz|Paris Est','profile':'tgv','number':'2870'})
with urllib.request.urlopen('http://127.0.0.1:3111/api/map-v2/match-path?'+q,timeout=5) as r:p=json.load(r)
pid=p.get('pathId'); coords=((p.get('path') or {}).get('geometry') or {}).get('coordinates') or []
print('pathId:',pid,'points:',len(coords),'matchedTripId:',p.get('matchedTripId'))
if not str(pid or '').startswith('p-ber-'): raise SystemExit('API 2870 renvoie encore ancien path')
def hav(c,p):
 R=6371.0; a,b=map(math.radians,c); x,y=map(math.radians,p); z=math.sin((y-b)/2)**2+math.cos(b)*math.cos(y)*math.sin((x-a)/2)**2; return 2*R*math.asin(min(1,math.sqrt(z)))
north=(6.027062006107198,48.980617830259646); south=(6.038063780587194,48.953176591009495)
dn=min(hav(c,north) for c in coords); ds=min(hav(c,south) for c in coords)
print('Pagny nord 005341:',round(dn,3),'km ; Vandières sud 005340:',round(ds,3),'km')
if dn>0.30 or ds<0.60: raise SystemExit('validation raccord TGV échouée')
PY

SUCCESS=1
trap - EXIT
cleanup

echo
echo "============================================================"
echo "CORRECTION TGV PAGNY/VANDIERES OK"
echo "============================================================"
echo "Paris ↔ Metz/Lux : raccord nord 005341"
echo "Raccord sud 005340: exclu pour ce flux"
echo "Autres TGV        : logique existante conservée"
echo "Builder           : corrigé durablement"
echo "Dataset partagé   : réparé + service rechargé"
echo "Backup             : $BACKUP"
echo "============================================================"
