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
BACKUP="$ROOT/backups/tgv-pagny-lgv-approach-v5-$STAMP"
TMP="$(mktemp -d /tmp/lb-tgv-pagny-lgv-v5.XXXXXX)"
SUCCESS=0
RESTARTED=0

cleanup(){ rm -rf "$TMP"; }
rollback(){
  if [[ "$SUCCESS" -eq 1 ]]; then return; fi
  echo "ERREUR : rollback TGV Pagny LGV approach V5..." >&2
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
echo "TGV REIMS/CHAMPAGNE -> METZ — RESTER SUR LGV JUSQU'A PAGNY V5"
echo "============================================================"

echo "=== 1/4 Patch durable du routage Pagny ==="
python3 - "$BUILDER" <<'PY'
from pathlib import Path
import re,sys
p=Path(sys.argv[1]); text=p.read_text(encoding='utf-8')
if '# BER_TGV_REQUIRED_CONNECTOR_V3' not in text:
    raise SystemExit('ERREUR : moteur Pagny V3 absent')
marker='# BER_TGV_PAGNY_LGV_APPROACH_V5'
if marker in text:
    print('builder déjà patché V5')
    raise SystemExit(0)

# 1) Ajoute une règle stricte uniquement pour les segments déjà sur la LGV
#    (Champagne-Ardenne/Reims/Meuse/Lorraine TGV <-> Metz/Thionville/Luxembourg).
anchor='\ndef ber_route_via_required_line(graph,start_coord,end_coord,profile,required_code,forbidden_code=None):'
if text.count(anchor)!=1:
    raise SystemExit(f'ancre ber_route_via_required_line: {text.count(anchor)}')
helper=r'''
# BER_TGV_PAGNY_LGV_APPROACH_V5
# Pour un segment démarrant déjà sur la LGV Est (Champagne-Ardenne TGV, Meuse TGV,
# Lorraine TGV), on ne doit pas quitter la LGV avant le raccordement de Pagny.
def ber_pair_requires_strict_lgv_to_pagny(profile, stop_a_name, stop_b_name):
    if profile != 'tgv':
        return False
    a=norm(str(stop_a_name or '')); z=norm(str(stop_b_name or ''))
    west_tokens=('REIMS','CHAMPAGNE','MEUSE TGV','LORRAINE TGV')
    east_tokens=('METZ','THIONVILLE','LUXEMBOURG')
    a_west=any(t in a for t in west_tokens); z_west=any(t in z for t in west_tokens)
    a_east=any(t in a for t in east_tokens); z_east=any(t in z for t in east_tokens)
    return (a_west and z_east) or (a_east and z_west)


def ber_lgv_side_for_pagny(stop_a_name, stop_b_name):
    a=norm(str(stop_a_name or '')); z=norm(str(stop_b_name or ''))
    west_tokens=('REIMS','CHAMPAGNE','MEUSE TGV','LORRAINE TGV')
    east_tokens=('METZ','THIONVILLE','LUXEMBOURG')
    if any(t in a for t in west_tokens) and any(t in z for t in east_tokens):
        return 'start'
    if any(t in a for t in east_tokens) and any(t in z for t in west_tokens):
        return 'end'
    return None


def ber_path_is_lgv_only_approach(graph,nodes):
    if not nodes or len(nodes)<2:
        return False
    seen_lgv=False
    connector_key=ber_line_key('connector')
    for i in range(1,len(nodes)):
        attrs=ber_edge_attrs(graph,nodes[i-1],nodes[i]) or {}
        line=ber_line_key(attrs.get('line'))
        if attrs.get('lgv'):
            seen_lgv=True
            continue
        # Les micro-connecteurs automatiques ne représentent pas une ligne classique.
        if line == connector_key:
            continue
        return False
    return seen_lgv
'''
text=text.replace(anchor,'\n'+helper+anchor.replace('):',',lgv_side=None):'),1)

# 2) Dans la recherche via 005341, élimine toute solution qui quitte la LGV avant Pagny.
old='''                    left=ber_best_coord_to_node(graph,start_coord,req_nodes[0],profile,False)\n                    right=ber_best_coord_to_node(graph,end_coord,req_nodes[-1],profile,True)\n                    if not left or not right: continue\n                    nodes=left + req_nodes[1:] + right[1:]'''
new='''                    left=ber_best_coord_to_node(graph,start_coord,req_nodes[0],profile,False)\n                    right=ber_best_coord_to_node(graph,end_coord,req_nodes[-1],profile,True)\n                    if not left or not right: continue\n                    if lgv_side == 'start' and not ber_path_is_lgv_only_approach(graph,left):\n                        continue\n                    if lgv_side == 'end' and not ber_path_is_lgv_only_approach(graph,right):\n                        continue\n                    nodes=left + req_nodes[1:] + right[1:]'''
if text.count(old)!=1:
    raise SystemExit(f'ancre left/right: {text.count(old)}')
text=text.replace(old,new,1)

# 3) Passe le sens LGV uniquement pour les relations qui commencent/finissent déjà sur la LGV.
old2="""    if ber_pair_requires_pagny_005341(profile,stop_a_name,stop_b_name):\n        forced=ber_route_via_required_line(graph,start_coord,end_coord,'tgv','005341','005340')"""
new2="""    if ber_pair_requires_pagny_005341(profile,stop_a_name,stop_b_name):\n        lgv_side = ber_lgv_side_for_pagny(stop_a_name,stop_b_name) if ber_pair_requires_strict_lgv_to_pagny(profile,stop_a_name,stop_b_name) else None\n        forced=ber_route_via_required_line(graph,start_coord,end_coord,'tgv','005341','005340',lgv_side=lgv_side)"""
if text.count(old2)!=1:
    raise SystemExit(f'ancre ber_route_pair: {text.count(old2)}')
text=text.replace(old2,new2,1)
p.write_text(text,encoding='utf-8')
print('builder patché V5 : Champagne/Reims/Meuse/Lorraine restent sur LGV jusqu’à Pagny')
PY
python3 -m py_compile "$BUILDER"

echo "=== 2/4 Reconstruction ciblée + validation géométrique ==="
python3 - "$BUILDER" "$TRIPS" "$PATHS" "$NETWORK" "$LGV" "$SPEED" "$CONNECTIONS" "$EXTRA" "$TMP/trips.json" "$TMP/paths.json" <<'PY'
import hashlib,importlib.util,json,sys
from pathlib import Path
builder,trips_file,paths_file,network_file,lgv_file,speed_file,connections_file,extra_file,out_trips,out_paths=map(Path,sys.argv[1:])
spec=importlib.util.spec_from_file_location('lb_builder',builder); b=importlib.util.module_from_spec(spec); spec.loader.exec_module(b)
trips=json.load(open(trips_file,encoding='utf-8')); paths=json.load(open(paths_file,encoding='utf-8'))
network=b.load_geojson(network_file); lgv=b.load_geojson(lgv_file); speed_data=b.load_geojson(speed_file)
lgv_by_line=b.metadata_by_line(lgv,b.is_lgv_properties); speed_by_line=b.metadata_by_line(speed_data,lambda props:b.parse_speed(props))
lgv_codes={code for code,values in lgv_by_line.items() if any(values)}; max_speeds={code:max(values) for code,values in speed_by_line.items() if values}
graph=b.RailGraph()
for feature in network.get('features',[]):
    props=feature.get('properties') or {}; code=b.line_code(props); status=str(b.pick(props,b.STATUS_KEYS,'EXPLOITE')); is_lgv=code in lgv_codes; vmax=max_speeds.get(code,300.0 if is_lgv else 120.0)
    for coords in b.iter_lines(feature.get('geometry')): graph.add_line(coords,speed=vmax,is_lgv=is_lgv,status=status,code=code)
if extra_file.exists():
    for feature in b.load_geojson(extra_file).get('features',[]):
        props=feature.get('properties') or {}; code=b.line_code(props) or 'CFL'
        for coords in b.iter_lines(feature.get('geometry')): graph.add_line(coords,speed=120.0,is_lgv=False,status='EXPLOITE',code=code)
for feature in b.load_geojson(connections_file).get('features',[]):
    props=feature.get('properties') or {}
    if not b.is_connector_properties(props): continue
    code=b.line_code(props); is_lgv=code in lgv_codes or b.is_lgv_properties(props); vmax=max_speeds.get(code,220.0 if is_lgv else 100.0)
    for coords in b.iter_lines(feature.get('geometry')): graph.add_line(coords,speed=vmax,is_lgv=is_lgv,status='EXPLOITE',code=code)
graph.connect_nearby_endpoints()
req=b.ber_line_key('005341'); forb=b.ber_line_key('005340'); connector=b.ber_line_key('connector')

def strict_pair(a,z): return b.ber_pair_requires_strict_lgv_to_pagny('tgv',a.get('name',''),z.get('name',''))
def eligible(t):
    if str(t.get('category') or '').lower()!='tgv': return False
    s=t.get('stops') or []
    return any(strict_pair(s[i],s[i+1]) for i in range(len(s)-1))

def validate_strict(a,z,nodes):
    edges=[]
    for i in range(1,len(nodes)):
        attrs=b.ber_edge_attrs(graph,nodes[i-1],nodes[i]) or {}
        edges.append((b.ber_line_key(attrs.get('line')),bool(attrs.get('lgv'))))
    req_idx=[i for i,(line,_) in enumerate(edges) if line==req]
    if not req_idx: raise SystemExit(f'{a.get("name")} -> {z.get("name")}: 005341 absent')
    if any(line==forb for line,_ in edges): raise SystemExit(f'{a.get("name")} -> {z.get("name")}: 005340 emprunté')
    side=b.ber_lgv_side_for_pagny(a.get('name',''),z.get('name',''))
    approach=edges[:min(req_idx)] if side=='start' else edges[max(req_idx)+1:] if side=='end' else []
    bad=[line for line,is_lgv in approach if not is_lgv and line!=connector]
    if bad:
        raise SystemExit(f'{a.get("name")} -> {z.get("name")}: sortie LGV trop tôt avant/après Pagny: {bad[:8]}')
    if not any(is_lgv for _,is_lgv in approach):
        raise SystemExit(f'{a.get("name")} -> {z.get("name")}: approche LGV non détectée')
    return edges

def build(t):
    stops=t.get('stops') or []; full=[]; offsets=[0.0]; checked=[]
    for i in range(len(stops)-1):
        a,z=stops[i],stops[i+1]; ac=(float(a['lon']),float(a['lat'])); zc=(float(z['lon']),float(z['lat']))
        nodes=b.ber_route_pair(graph,ac,zc,'tgv',a.get('name',''),z.get('name',''))
        if not nodes: return None
        if strict_pair(a,z):
            edges=validate_strict(a,z,nodes); checked.append((a.get('name',''),z.get('name',''),edges))
            print(f'VALIDÉ STRICT {a.get("name")} -> {z.get("name")}: LGV jusqu’à Pagny 005341')
        seg=b.simplify_collinear([graph.coords[n] for n in nodes])
        if full and seg and full[-1]==seg[0]: seg=seg[1:]
        full.extend(seg); offsets.append(b.path_metrics(full)[1] if len(full)>1 else offsets[-1])
    cumulative,length=b.path_metrics(full); return full,cumulative,length,offsets,checked

cache={}; changed=0; numbers=set(); strict_count=0
for tid,t in trips.items():
    if not eligible(t): continue
    names=[str(s.get('name') or '') for s in (t.get('stops') or [])]
    sig='BER_TGV_PAGNY_LGV_APPROACH_V5|'+'|'.join(b.norm(x) for x in names)
    item=cache.get(sig)
    if item is None:
        built=build(t)
        if not built: raise SystemExit(f'échec recalcul {tid}')
        coords,cumulative,length,offsets,checked=built
        pid='p-ber5-'+hashlib.sha1(sig.encode()).hexdigest()[:16]
        paths[pid]={'coordinates':coords,'cumulative':cumulative,'length':length,'stopOffsets':offsets,'profile':'tgv','pathSource':'BER_TGV_PAGNY_LGV_APPROACH_V5','requiredConnector':'005341','forbiddenConnector':'005340','strictLgvApproach':True}
        item=(pid,offsets,length,len(checked)); cache[sig]=item
    pid,offsets,length,nchecked=item
    old=t.get('pathId'); old_len=(paths.get(old) or {}).get('length')
    if old_len is not None and length>float(old_len)+20000: raise SystemExit(f'chemin anormalement long {tid}: {old_len} -> {length}')
    t['pathId']=pid; t['offsets']=offsets; t['pathSource']='BER_TGV_PAGNY_LGV_APPROACH_V5'
    changed+=1; strict_count+=nchecked; numbers.add(str(t.get('number') or ''))
if changed<1 or strict_count<1: raise SystemExit('aucun TGV strict recalculé')
if '2807' not in numbers: raise SystemExit(f'TGV 2807 absent des TGV recalculés: {sorted(numbers)}')
json.dump(trips,open(out_trips,'w',encoding='utf-8'),ensure_ascii=False,separators=(',',':'))
json.dump(paths,open(out_paths,'w',encoding='utf-8'),ensure_ascii=False,separators=(',',':'))
print(f'TGV stricts recalculés: {changed} ; validations de segments: {strict_count} ; 2807=OK')
PY
python3 -m json.tool "$TMP/trips.json" >/dev/null
python3 -m json.tool "$TMP/paths.json" >/dev/null
install -m 0644 "$TMP/trips.json" "$TRIPS"
install -m 0644 "$TMP/paths.json" "$PATHS"

echo "=== 3/4 Redémarrage service ==="
RESTARTED=1
systemctl restart "$SERVICE"
for _ in $(seq 1 20); do
  if systemctl is-active --quiet "$SERVICE" && curl -fsS --max-time 2 http://127.0.0.1:3111/api/map-v2/health >/dev/null 2>&1; then break; fi
  sleep 1
done
systemctl is-active --quiet "$SERVICE"
curl -fsS --max-time 5 http://127.0.0.1:3111/api/map-v2/health

echo
echo "=== 4/4 Contrôle final 2807 ==="
python3 - "$TRIPS" "$PATHS" <<'PY'
import json,sys
trips=json.load(open(sys.argv[1],encoding='utf-8')); paths=json.load(open(sys.argv[2],encoding='utf-8'))
rows=[t for t in trips.values() if str(t.get('number') or '')=='2807' and t.get('pathSource')=='BER_TGV_PAGNY_LGV_APPROACH_V5']
if not rows: raise SystemExit('2807 V5 absent')
for t in rows:
    p=paths.get(t.get('pathId')) or {}
    print('2807',t.get('pathId'),'points=',len(p.get('coordinates') or []),'length=',p.get('length'),'strict=',p.get('strictLgvApproach'))
    if p.get('requiredConnector')!='005341' or p.get('strictLgvApproach') is not True: raise SystemExit('métadonnées V5 invalides')
print('2807 V5 validé')
PY

SUCCESS=1
trap - EXIT
cleanup

echo "============================================================"
echo "CORRECTION V5 OK"
echo "Champagne/Reims/Meuse/Lorraine TGV -> Metz : LGV jusqu'à Pagny 005341"
echo "Plus de détour préalable par Jaulny"
echo "TGV 2807 validé explicitement"
echo "Backup : $BACKUP"
echo "============================================================"
