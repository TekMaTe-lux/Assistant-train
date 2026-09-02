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
BACKUP="$ROOT/backups/tgv-pagny-required-v3-$STAMP"
TMP="$(mktemp -d /tmp/lb-tgv-pagny-required.XXXXXX)"
SUCCESS=0
RESTARTED=0

cleanup(){ rm -rf "$TMP"; }
rollback(){
  if [[ "$SUCCESS" -eq 1 ]]; then return; fi
  echo
  echo "ERREUR : rollback TGV raccord obligatoire 005341..."
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
echo "TGV PARIS ↔ METZ/LUX — 005341 OBLIGATOIRE V3"
echo "============================================================"
echo "Backup : $BACKUP"
echo

echo "=== 1/5 Patch durable du builder ==="
python3 - "$BUILDER" <<'PY'
from pathlib import Path
import re,sys
p=Path(sys.argv[1]); text=p.read_text(encoding='utf-8')
marker='# BER_TGV_REQUIRED_CONNECTOR_V3'
if marker in text:
    print('builder déjà patché V3')
    raise SystemExit(0)
if '# BER_TGV_PAGNY_NORTH_V1' in text:
    raise SystemExit('ERREUR : ancien patch V1 encore présent alors que le rollback devait le retirer')

anchor='\ndef path_metrics(coords):'
if text.count(anchor)!=1:
    raise SystemExit(f'ancre path_metrics: {text.count(anchor)} occurrence(s)')
helper=r'''
# BER_TGV_REQUIRED_CONNECTOR_V3
# Les données RFN contiennent des raccordements automatiques de quelques mètres
# pour recoller des géométries. Ils sont indispensables localement mais ne doivent
# jamais permettre de contourner un raccordement ferroviaire officiel.
def ber_line_key(value):
    digits = ''.join(ch for ch in str(value or '') if ch.isdigit())
    if digits:
        try: return str(int(digits))
        except ValueError: pass
    return norm(str(value or ''))


def ber_pair_requires_pagny_005341(profile, stop_a_name, stop_b_name):
    if profile != 'tgv': return False
    pair = norm(f'{stop_a_name} | {stop_b_name}')
    return 'PARIS' in pair and any(token in pair for token in ('METZ','THIONVILLE','LUXEMBOURG'))


def ber_edge_attrs(graph, a, z):
    for neighbour, attrs in graph.edges.get(a, ()):
        if neighbour == z:
            return attrs
    return None


def ber_nodes_line_keys(graph, nodes):
    out=[]
    for i in range(1,len(nodes)):
        attrs=ber_edge_attrs(graph,nodes[i-1],nodes[i]) or {}
        out.append(ber_line_key(attrs.get('line')))
    return out


def ber_required_line_components(graph, required_code):
    req=ber_line_key(required_code)
    adj={}
    for node,edges in graph.edges.items():
        for neighbour,attrs in edges:
            if ber_line_key(attrs.get('line')) != req:
                continue
            adj.setdefault(node,set()).add(neighbour)
            adj.setdefault(neighbour,set()).add(node)
    unseen=set(adj); components=[]
    while unseen:
        root=next(iter(unseen)); stack=[root]; comp=set()
        while stack:
            n=stack.pop()
            if n in comp: continue
            comp.add(n); unseen.discard(n)
            stack.extend(adj.get(n,()))
        components.append((comp,adj))
    return components


def ber_line_only_path(adj,start,end,allowed):
    q=[start]; previous={start:None}; pos=0
    while pos < len(q):
        n=q[pos]; pos+=1
        if n==end: break
        for z in adj.get(n,()):
            if z not in allowed or z in previous: continue
            previous[z]=n; q.append(z)
    if end not in previous: return None
    out=[end]
    while out[-1] != start: out.append(previous[out[-1]])
    out.reverse(); return out


def ber_best_coord_to_node(graph, coord, target, profile, reverse=False):
    candidates=graph.nearest_candidates(coord)
    best=None
    for snap,node in candidates:
        nodes=graph.route(target,node,profile) if reverse else graph.route(node,target,profile)
        if not nodes: continue
        if reverse: nodes=list(nodes)
        length=snap
        for i in range(1,len(nodes)):
            length += haversine(graph.coords[nodes[i-1]],graph.coords[nodes[i]])
        item=(length,nodes)
        if best is None or item[0] < best[0]: best=item
    return None if best is None else best[1]


def ber_route_via_required_line(graph,start_coord,end_coord,profile,required_code,forbidden_code=None):
    required=ber_line_key(required_code); forbidden=ber_line_key(forbidden_code) if forbidden_code else None
    best=None
    for comp,adj in ber_required_line_components(graph,required):
        endpoints=[n for n in comp if len([z for z in adj.get(n,()) if z in comp])==1]
        if len(endpoints)<2: continue
        # Les jeux RFN peuvent contenir plusieurs composantes/voies. On teste
        # toutes les paires d'extrémités de chaque composante et les deux sens.
        for ai in range(len(endpoints)):
            for bi in range(ai+1,len(endpoints)):
                required_nodes=ber_line_only_path(adj,endpoints[ai],endpoints[bi],comp)
                if not required_nodes or len(required_nodes)<2: continue
                for req_nodes in (required_nodes,list(reversed(required_nodes))):
                    left=ber_best_coord_to_node(graph,start_coord,req_nodes[0],profile,False)
                    right=ber_best_coord_to_node(graph,end_coord,req_nodes[-1],profile,True)
                    if not left or not right: continue
                    nodes=left + req_nodes[1:] + right[1:]
                    lines=ber_nodes_line_keys(graph,nodes)
                    if required not in lines: continue
                    if forbidden and forbidden in lines: continue
                    length=sum(haversine(graph.coords[nodes[i-1]],graph.coords[nodes[i]]) for i in range(1,len(nodes)))
                    if best is None or length < best[0]: best=(length,nodes,lines)
    return None if best is None else best[1]


def ber_route_pair(graph,start_coord,end_coord,profile,stop_a_name,stop_b_name):
    if ber_pair_requires_pagny_005341(profile,stop_a_name,stop_b_name):
        forced=ber_route_via_required_line(graph,start_coord,end_coord,'tgv','005341','005340')
        if forced:
            return forced
        raise RuntimeError(f'Raccord 005341 introuvable pour {stop_a_name} -> {stop_b_name}')
    return graph.route_between_coords(start_coord,end_coord,profile)
'''
text=text.replace(anchor,'\n'+helper+anchor,1)

old='nodes = graph.route_between_coords(stop_a["coord"], stop_b["coord"], profile)'
new='nodes = ber_route_pair(graph, stop_a["coord"], stop_b["coord"], profile, stop_a["name"], stop_b["name"])'
if text.count(old)!=1:
    raise SystemExit(f'appel builder route_between_coords: {text.count(old)} occurrence(s)')
text=text.replace(old,new,1)
p.write_text(text,encoding='utf-8')
print('builder patché : traversée physique de 005341 obligatoire pour Paris ↔ Metz/Lux')
PY
python3 -m py_compile "$BUILDER"

echo "=== 2/5 Reconstruction ciblée + contrôle des arêtes ==="
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
req=b.ber_line_key('005341'); forb=b.ber_line_key('005340')
req_edges=sum(1 for u,edges in graph.edges.items() for v,a in edges if b.ber_line_key(a.get('line'))==req)//2
forb_edges=sum(1 for u,edges in graph.edges.items() for v,a in edges if b.ber_line_key(a.get('line'))==forb)//2
print(f'graphe: 005341={req} -> {req_edges} arêtes ; 005340={forb} -> {forb_edges} arêtes')
if req_edges<1: raise SystemExit('aucune arête du raccord 005341 dans le graphe')

def eligible(t):
    if str(t.get('category') or '').lower()!='tgv': return False
    s=t.get('stops') or []
    return any(b.ber_pair_requires_pagny_005341('tgv',s[i].get('name',''),s[i+1].get('name','')) for i in range(len(s)-1))

def build(t):
    stops=t.get('stops') or []; full=[]; offsets=[0.0]; used=[]
    for i in range(len(stops)-1):
        a,z=stops[i],stops[i+1]; ac=(float(a['lon']),float(a['lat'])); zc=(float(z['lon']),float(z['lat']))
        nodes=b.ber_route_pair(graph,ac,zc,'tgv',a.get('name',''),z.get('name',''))
        if not nodes:return None
        lines=b.ber_nodes_line_keys(graph,nodes); used.extend(lines)
        if b.ber_pair_requires_pagny_005341('tgv',a.get('name',''),z.get('name','')):
            if req not in lines: raise SystemExit(f'{a.get("name")} -> {z.get("name")}: 005341 absent')
            if forb in lines: raise SystemExit(f'{a.get("name")} -> {z.get("name")}: 005340 emprunté')
            print(f'VALIDÉ {a.get("name")} -> {z.get("name")}: 005341 utilisé ; 005340 absent ; auto-connectors={lines.count("connector")}')
        seg=b.simplify_collinear([graph.coords[n] for n in nodes])
        if full and seg and full[-1]==seg[0]: seg=seg[1:]
        full.extend(seg); offsets.append(b.path_metrics(full)[1] if len(full)>1 else offsets[-1])
    cumulative,length=b.path_metrics(full); return full,cumulative,length,offsets,used

cache={}; changed=0; numbers=set(); reports=[]
for tid,t in trips.items():
    if not eligible(t):continue
    names=[str(s.get('name') or '') for s in (t.get('stops') or [])]
    sig='BER_TGV_REQUIRED_005341_V3|'+'|'.join(b.norm(x) for x in names)
    item=cache.get(sig)
    if item is None:
        built=build(t)
        if not built: raise SystemExit(f'échec recalcul {tid}')
        coords,cumulative,length,offsets,used=built
        pid='p-ber3-'+hashlib.sha1(sig.encode()).hexdigest()[:16]
        paths[pid]={'coordinates':coords,'cumulative':cumulative,'length':length,'stopOffsets':offsets,'profile':'tgv','pathSource':'BER_TGV_REQUIRED_005341_V3','requiredConnector':'005341','forbiddenConnector':'005340'}
        item=(pid,offsets,length); cache[sig]=item
    pid,offsets,length=item
    old=t.get('pathId'); old_len=(paths.get(old) or {}).get('length')
    if old_len is not None and length>float(old_len)+20000: raise SystemExit(f'chemin anormalement long {tid}: {old_len} -> {length}')
    t['pathId']=pid; t['offsets']=offsets; t['pathSource']='BER_TGV_REQUIRED_005341_V3'; changed+=1; numbers.add(str(t.get('number') or '')); reports.append((tid,old,pid,old_len,length))
if changed<1 or '2870' not in numbers: raise SystemExit(f'aucun 2870 réparé: {changed}')
json.dump(trips,open(out_trips,'w',encoding='utf-8'),ensure_ascii=False,separators=(',',':')); json.dump(paths,open(out_paths,'w',encoding='utf-8'),ensure_ascii=False,separators=(',',':'))
print(f'trips réparés: {changed} ; numéros: {sorted(x for x in numbers if x)}')
for r in reports[:10]:print(' -',r)
PY
python3 -m json.tool "$TMP/trips.json" >/dev/null
python3 -m json.tool "$TMP/paths.json" >/dev/null
install -m 0644 "$TMP/trips.json" "$TRIPS"
install -m 0644 "$TMP/paths.json" "$PATHS"

echo "=== 3/5 Validation dataset 2870 ==="
python3 - "$TRIPS" "$PATHS" <<'PY'
import json,sys
trips=json.load(open(sys.argv[1],encoding='utf-8')); paths=json.load(open(sys.argv[2],encoding='utf-8'))
rows=[t for t in trips.values() if str(t.get('number') or '')=='2870' and t.get('pathSource')=='BER_TGV_REQUIRED_005341_V3']
if not rows: raise SystemExit('2870 V3 absent')
ids=sorted({t.get('pathId') for t in rows})
for pid in ids:
 p=paths.get(pid) or {}; print(pid,'points=',len(p.get('coordinates') or []),'length=',p.get('length'),'required=',p.get('requiredConnector'),'forbidden=',p.get('forbiddenConnector'))
 if p.get('requiredConnector')!='005341' or p.get('forbiddenConnector')!='005340': raise SystemExit('métadonnées raccord invalides')
print(f'2870: {len(rows)} variantes V3')
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
import json,urllib.parse,urllib.request
q=urllib.parse.urlencode({'stops':'Luxembourg|Thionville|Metz|Paris Est','profile':'tgv','number':'2870'})
with urllib.request.urlopen('http://127.0.0.1:3111/api/map-v2/match-path?'+q,timeout=5) as r:p=json.load(r)
pid=p.get('pathId'); coords=((p.get('path') or {}).get('geometry') or {}).get('coordinates') or []
print('pathId:',pid,'points:',len(coords),'matchedTripId:',p.get('matchedTripId'))
if not str(pid or '').startswith('p-ber3-'): raise SystemExit('API 2870 renvoie encore un ancien path')
PY

SUCCESS=1
trap - EXIT
cleanup

echo
echo "============================================================"
echo "CORRECTION TGV 005341 V3 OK"
echo "============================================================"
echo "Paris ↔ Metz/Lux : traversée physique 005341 obligatoire"
echo "005340            : interdit sur ces segments"
echo "Auto-connecteurs  : autorisés uniquement autour des coupures RFN"
echo "Autres trains     : logique existante conservée"
echo "Production UI     : NON MODIFIEE"
echo "Backup            : $BACKUP"
echo "============================================================"
