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
BACKUP="$ROOT/backups/tgv-pagny-reims-v4-$STAMP"
TMP="$(mktemp -d /tmp/lb-tgv-pagny-reims-v4.XXXXXX)"
SUCCESS=0
RESTARTED=0

cleanup(){ rm -rf "$TMP"; }
rollback(){
  if [[ "$SUCCESS" -eq 1 ]]; then return; fi
  echo "ERREUR : rollback TGV Pagny/Reims V4..." >&2
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
echo "TGV REIMS/CHAMPAGNE ↔ METZ/LUX — PAGNY 005341 V4"
echo "============================================================"

echo "=== 1/4 Extension de la règle Pagny existante ==="
python3 - "$BUILDER" <<'PY'
from pathlib import Path
import re,sys
p=Path(sys.argv[1])
text=p.read_text(encoding='utf-8')
if '# BER_TGV_REQUIRED_CONNECTOR_V3' not in text:
    raise SystemExit('ERREUR : règle TGV V3 absente du builder ; ne pas empiler un autre moteur')

pattern=re.compile(
    r"def ber_pair_requires_pagny_005341\(profile, stop_a_name, stop_b_name\):\n"
    r"(?:    .*\n)+?"
    r"(?=\n+def ber_edge_attrs)",
    re.M,
)
new='''def ber_pair_requires_pagny_005341(profile, stop_a_name, stop_b_name):
    if profile != 'tgv':
        return False
    pair = norm(f'{stop_a_name} | {stop_b_name}')
    west = any(token in pair for token in ('PARIS', 'REIMS', 'CHAMPAGNE', 'MEUSE TGV'))
    east = any(token in pair for token in ('METZ', 'THIONVILLE', 'LUXEMBOURG'))
    return west and east

'''
updated,count=pattern.subn(new,text,count=1)
if count != 1:
    raise SystemExit(f'ERREUR : fonction Pagny introuvable ou ambiguë ({count})')
if updated == text:
    print('règle Pagny déjà à jour')
else:
    p.write_text(updated,encoding='utf-8')
    print('règle étendue : Paris/Reims/Champagne/Meuse TGV ↔ Metz/Thionville/Luxembourg')
PY
python3 -m py_compile "$BUILDER"

echo "=== 2/4 Reconstruction ciblée des TGV concernés ==="
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
    for feature in b.load_geojson(extra_file).get('features',[]):
        props=feature.get('properties') or {}; code=b.line_code(props) or 'CFL'
        for coords in b.iter_lines(feature.get('geometry')):
            graph.add_line(coords,speed=120.0,is_lgv=False,status='EXPLOITE',code=code)
for feature in b.load_geojson(connections_file).get('features',[]):
    props=feature.get('properties') or {}
    if not b.is_connector_properties(props): continue
    code=b.line_code(props); is_lgv=code in lgv_codes or b.is_lgv_properties(props)
    vmax=max_speeds.get(code,220.0 if is_lgv else 100.0)
    for coords in b.iter_lines(feature.get('geometry')):
        graph.add_line(coords,speed=vmax,is_lgv=is_lgv,status='EXPLOITE',code=code)
graph.connect_nearby_endpoints()
req=b.ber_line_key('005341'); forb=b.ber_line_key('005340')

def forced_pair(a,z):
    return b.ber_pair_requires_pagny_005341('tgv',a.get('name',''),z.get('name',''))

def eligible(t):
    if str(t.get('category') or '').lower()!='tgv': return False
    s=t.get('stops') or []
    return any(forced_pair(s[i],s[i+1]) for i in range(len(s)-1))

def build(t):
    stops=t.get('stops') or []; full=[]; offsets=[0.0]; has_reims=False
    for i in range(len(stops)-1):
        a,z=stops[i],stops[i+1]
        ac=(float(a['lon']),float(a['lat'])); zc=(float(z['lon']),float(z['lat']))
        nodes=b.ber_route_pair(graph,ac,zc,'tgv',a.get('name',''),z.get('name',''))
        if not nodes: return None
        lines=b.ber_nodes_line_keys(graph,nodes)
        if forced_pair(a,z):
            if req not in lines: raise SystemExit(f'{a.get("name")} -> {z.get("name")}: 005341 absent')
            if forb in lines: raise SystemExit(f'{a.get("name")} -> {z.get("name")}: 005340 emprunté')
            pair=b.norm(f'{a.get("name","")} | {z.get("name","")}')
            has_reims = has_reims or any(x in pair for x in ('REIMS','CHAMPAGNE','MEUSE TGV'))
            print(f'VALIDÉ {a.get("name")} -> {z.get("name")}: raccord Pagny 005341')
        seg=b.simplify_collinear([graph.coords[n] for n in nodes])
        if full and seg and full[-1]==seg[0]: seg=seg[1:]
        full.extend(seg)
        offsets.append(b.path_metrics(full)[1] if len(full)>1 else offsets[-1])
    cumulative,length=b.path_metrics(full)
    return full,cumulative,length,offsets,has_reims

cache={}; changed=0; reims_changed=0; numbers=set()
for tid,t in trips.items():
    if not eligible(t): continue
    names=[str(s.get('name') or '') for s in (t.get('stops') or [])]
    sig='BER_TGV_REQUIRED_005341_V4|'+'|'.join(b.norm(x) for x in names)
    item=cache.get(sig)
    if item is None:
        built=build(t)
        if not built: raise SystemExit(f'échec recalcul {tid}')
        coords,cumulative,length,offsets,has_reims=built
        pid='p-ber4-'+hashlib.sha1(sig.encode()).hexdigest()[:16]
        paths[pid]={'coordinates':coords,'cumulative':cumulative,'length':length,'stopOffsets':offsets,'profile':'tgv','pathSource':'BER_TGV_REQUIRED_005341_V4','requiredConnector':'005341','forbiddenConnector':'005340'}
        item=(pid,offsets,length,has_reims); cache[sig]=item
    pid,offsets,length,has_reims=item
    old=t.get('pathId'); old_len=(paths.get(old) or {}).get('length')
    if old_len is not None and length>float(old_len)+20000:
        raise SystemExit(f'chemin anormalement long {tid}: {old_len} -> {length}')
    t['pathId']=pid; t['offsets']=offsets; t['pathSource']='BER_TGV_REQUIRED_005341_V4'
    changed+=1; reims_changed+=int(has_reims); numbers.add(str(t.get('number') or ''))
if changed<1:
    raise SystemExit('aucun TGV Pagny recalculé')
if reims_changed<1:
    raise SystemExit('aucun TGV Reims/Champagne/Meuse -> Metz/Lux trouvé : arrêt avant publication')
json.dump(trips,open(out_trips,'w',encoding='utf-8'),ensure_ascii=False,separators=(',',':'))
json.dump(paths,open(out_paths,'w',encoding='utf-8'),ensure_ascii=False,separators=(',',':'))
print(f'TGV recalculés: {changed} ; dont Reims/Champagne/Meuse: {reims_changed} ; numéros: {sorted(x for x in numbers if x)}')
PY
python3 -m json.tool "$TMP/trips.json" >/dev/null
python3 -m json.tool "$TMP/paths.json" >/dev/null
install -m 0644 "$TMP/trips.json" "$TRIPS"
install -m 0644 "$TMP/paths.json" "$PATHS"

echo "=== 3/4 Redémarrage + health ==="
RESTARTED=1
systemctl restart "$SERVICE"
for _ in $(seq 1 20); do
  if systemctl is-active --quiet "$SERVICE" && curl -fsS --max-time 2 http://127.0.0.1:3111/api/map-v2/health >/dev/null 2>&1; then break; fi
  sleep 1
done
systemctl is-active --quiet "$SERVICE"
curl -fsS --max-time 5 http://127.0.0.1:3111/api/map-v2/health

echo
echo "=== 4/4 Contrôle dataset V4 ==="
python3 - "$TRIPS" "$PATHS" <<'PY'
import json,sys
trips=json.load(open(sys.argv[1],encoding='utf-8')); paths=json.load(open(sys.argv[2],encoding='utf-8'))
rows=[t for t in trips.values() if t.get('pathSource')=='BER_TGV_REQUIRED_005341_V4']
if not rows: raise SystemExit('aucun trip V4')
for t in rows:
    p=paths.get(t.get('pathId')) or {}
    if p.get('requiredConnector')!='005341' or p.get('forbiddenConnector')!='005340':
        raise SystemExit(f'métadonnées raccord invalides: {t.get("number")}')
print('OK:',len(rows),'TGV V4 utilisent la règle Pagny 005341 / 005340 interdit')
PY

SUCCESS=1
trap - EXIT
cleanup

echo "============================================================"
echo "CORRECTION TGV PAGNY/REIMS V4 OK"
echo "Reims/Champagne/Meuse TGV ↔ Metz/Lux : raccord 005341 imposé"
echo "Raccord sud 005340                  : interdit"
echo "Autres trains                       : logique inchangée"
echo "Backup                              : $BACKUP"
echo "============================================================"
