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
BACKUP="$ROOT/backups/tgv-pagny-canonical-v7-$STAMP"
TMP="$(mktemp -d /tmp/lb-tgv-pagny-v7.XXXXXX)"
SUCCESS=0
RESTARTED=0

cleanup(){ rm -rf "$TMP"; }
rollback(){
  if [[ "$SUCCESS" -eq 1 ]]; then return; fi
  echo "ERREUR : rollback TGV Pagny canonical V7..." >&2
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
for f in "$BUILDER" "$TRIPS" "$PATHS" "$NETWORK" "$SPEED" "$CONNECTIONS"; do
  [[ -f "$f" ]] || { echo "ERREUR : fichier absent: $f" >&2; exit 3; }
done
mkdir -p "$BACKUP"
cp -a "$BUILDER" "$TRIPS" "$PATHS" "$BACKUP/"

echo "============================================================"
echo "TGV PARIS/CHAMPAGNE -> METZ — CORRIDOR RFN CANONIQUE V7"
echo "005000 -> 005341 -> 090000 -> 089000"
echo "============================================================"

echo "=== 1/4 Patch durable du builder ==="
python3 - "$BUILDER" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1]); text=p.read_text(encoding='utf-8')
marker='# BER_TGV_PAGNY_CANONICAL_V7'
if marker in text:
    print('builder déjà patché V7')
    raise SystemExit(0)
if '# BER_TGV_REQUIRED_CONNECTOR_V3' not in text:
    raise SystemExit('ERREUR : moteur Pagny V3 absent')
anchor='\ndef ber_route_pair(graph,start_coord,end_coord,profile,stop_a_name,stop_b_name):\n'
if text.count(anchor)!=1:
    raise SystemExit(f'ERREUR ancre ber_route_pair: {text.count(anchor)}')
helper=r'''
# BER_TGV_PAGNY_CANONICAL_V7
# Le GTFS SNCF des TGV n'expose pas de shape_id. Pour le corridor Paris/Champagne
# -> Metz, on n'autorise donc plus le Dijkstra général à "deviner" le sillon.
# Séquence RFN imposée : 005000 (LGV Est) -> 005341 (raccord Pagny nord)
# -> 090000 -> 089000 jusqu'à Metz. Les petits écarts de topologie RFN aux
# jonctions sont pontés explicitement entre les noeuds physiques les plus proches.
_BER_PAGNY_V7_CACHE={}

def ber_pair_requires_pagny_canonical_v7(profile,stop_a_name,stop_b_name):
    if profile != 'tgv':
        return False
    a=norm(str(stop_a_name or '')); z=norm(str(stop_b_name or ''))
    west=('PARIS EST','CHAMPAGNE-ARDENNE TGV','MEUSE TGV')
    a_w=any(t in a for t in west); z_w=any(t in z for t in west)
    a_m='METZ' in a; z_m='METZ' in z
    return (a_w and z_m) or (a_m and z_w)

def ber_v7_nodes_for_code(graph,code):
    key=ber_line_key(code); out=set()
    for u,edges in graph.edges.items():
        for v,attrs in edges:
            if ber_line_key((attrs or {}).get('line')) == key:
                out.add(u); out.add(v)
    return out

def ber_v7_nearest_node(graph,coord,nodes):
    best=None
    for n in nodes:
        d=haversine(coord,graph.coords[n])
        if best is None or d < best[0]: best=(d,n)
    return best

def ber_v7_nearest_pair(graph,a_nodes,b_nodes):
    import math
    cell=0.01
    grid={}
    for n in b_nodes:
        lon,lat=graph.coords[n]; k=(int(lon/cell),int(lat/cell)); grid.setdefault(k,[]).append(n)
    best=None
    for a in a_nodes:
        lon,lat=graph.coords[a]; ix=int(lon/cell); iy=int(lat/cell)
        for r in range(0,8):
            found=False
            for x in range(ix-r,ix+r+1):
                for y in range(iy-r,iy+r+1):
                    if r and ix-r < x < ix+r and iy-r < y < iy+r: continue
                    for b in grid.get((x,y),()):
                        d=haversine(graph.coords[a],graph.coords[b])
                        if best is None or d < best[0]: best=(d,a,b)
                        found=True
            if found and best is not None and best[0] < (r+1)*1200:
                break
    return best

def ber_v7_filtered_route(graph,start,end,allowed_codes):
    import heapq
    allowed={ber_line_key(x) for x in allowed_codes}
    if start==end:return [start]
    dist={start:0.0}; prev={}; heap=[(0.0,start)]
    while heap:
        cost,u=heapq.heappop(heap)
        if cost != dist.get(u): continue
        if u==end: break
        for v,attrs in graph.edges.get(u,()):
            if ber_line_key((attrs or {}).get('line')) not in allowed: continue
            nd=cost+haversine(graph.coords[u],graph.coords[v])
            if nd < dist.get(v,float('inf')):
                dist[v]=nd; prev[v]=u; heapq.heappush(heap,(nd,v))
    if end not in dist:return None
    out=[end]
    while out[-1]!=start:out.append(prev[out[-1]])
    out.reverse(); return out

def ber_v7_dedupe(nodes):
    out=[]
    for n in nodes:
        if not out or out[-1]!=n:out.append(n)
    return out

def ber_v7_cache(graph):
    k=id(graph)
    if k in _BER_PAGNY_V7_CACHE:return _BER_PAGNY_V7_CACHE[k]
    n5000=ber_v7_nodes_for_code(graph,'005000')
    n5341=ber_v7_nodes_for_code(graph,'005341')
    n90000=ber_v7_nodes_for_code(graph,'090000')
    n89000=ber_v7_nodes_for_code(graph,'089000')
    if not all((n5000,n5341,n90000,n89000)):
        raise RuntimeError(f'V7 lignes RFN absentes: 005000={len(n5000)} 005341={len(n5341)} 090000={len(n90000)} 089000={len(n89000)}')
    req_lgv=min(n5341,key=lambda n: ber_v7_nearest_node(graph,graph.coords[n],n5000)[0])
    req_classic=min((n for n in n5341 if n!=req_lgv),key=lambda n: ber_v7_nearest_node(graph,graph.coords[n],n90000)[0])
    j_lgv=ber_v7_nearest_node(graph,graph.coords[req_lgv],n5000)
    j_90=ber_v7_nearest_node(graph,graph.coords[req_classic],n90000)
    bridge=ber_v7_nearest_pair(graph,n90000,n89000)
    if not j_lgv or j_lgv[0] > 1200:
        raise RuntimeError(f'V7 jonction 005000/005341 trop éloignée: {None if not j_lgv else j_lgv[0]:.0f} m')
    if not j_90 or j_90[0] > 1200:
        raise RuntimeError(f'V7 jonction 005341/090000 trop éloignée: {None if not j_90 else j_90[0]:.0f} m')
    if not bridge or bridge[0] > 1200:
        raise RuntimeError(f'V7 jonction 090000/089000 trop éloignée: {None if not bridge else bridge[0]:.0f} m')
    req_path=ber_v7_filtered_route(graph,req_lgv,req_classic,('005341',))
    if not req_path:
        req_path=ber_v7_filtered_route(graph,req_classic,req_lgv,('005341',))
        if req_path:req_path=list(reversed(req_path))
    if not req_path: raise RuntimeError('V7 impossible de parcourir 005341')
    data={
      'n5000':n5000,'n90000':n90000,'n89000':n89000,
      'req_lgv':req_lgv,'req_classic':req_classic,'j_lgv':j_lgv[1],'j_90':j_90[1],
      'bridge90':bridge[1],'bridge89':bridge[2],'req_path':req_path,
      'gaps':(j_lgv[0],j_90[0],bridge[0])
    }
    _BER_PAGNY_V7_CACHE[k]=data
    return data

def ber_route_pagny_canonical_v7(graph,start_coord,end_coord,stop_a_name,stop_b_name):
    a=norm(str(stop_a_name or '')); z=norm(str(stop_b_name or ''))
    reverse='METZ' in a
    west_coord=end_coord if reverse else start_coord
    metz_coord=start_coord if reverse else end_coord
    west_name=z if reverse else a
    c=ber_v7_cache(graph)
    west_anchor=ber_v7_nearest_node(graph,west_coord,c['n5000'])
    metz_anchor=ber_v7_nearest_node(graph,metz_coord,c['n89000'])
    if not west_anchor or not metz_anchor:return None
    prefix=[]
    if 'PARIS EST' in west_name:
        prefix=graph.route_between_coords(west_coord,graph.coords[west_anchor[1]],'tgv') or []
        if not prefix:return None
        plen=sum(haversine(graph.coords[prefix[i-1]],graph.coords[prefix[i]]) for i in range(1,len(prefix)))
        if plen > 70000: raise RuntimeError(f'V7 approche Paris->LGV anormale: {plen/1000:.1f} km')
        for i in range(1,len(prefix)):
            attrs=ber_edge_attrs(graph,prefix[i-1],prefix[i]) or {}
            if ber_line_key(attrs.get('line')) == ber_line_key('CFL'):
                raise RuntimeError('V7 approche Paris->LGV passe par CFL')
    else:
        if west_anchor[0] > 5000:
            raise RuntimeError(f'V7 arrêt LGV trop éloigné de 005000 ({stop_b_name if reverse else stop_a_name}): {west_anchor[0]:.0f} m')
        prefix=[west_anchor[1]]
    lgv=ber_v7_filtered_route(graph,west_anchor[1],c['j_lgv'],('005000',))
    p90=ber_v7_filtered_route(graph,c['j_90'],c['bridge90'],('090000',))
    p89=ber_v7_filtered_route(graph,c['bridge89'],metz_anchor[1],('089000',))
    if not lgv or not p90 or not p89:return None
    nodes=ber_v7_dedupe(prefix + lgv + c['req_path'] + p90 + p89)
    if max(graph.coords[n][0] for n in nodes) > 6.26:
        raise RuntimeError('V7 détour oriental détecté (> 6.26E)')
    return list(reversed(nodes)) if reverse else nodes
'''
text=text.replace(anchor,'\n'+helper+anchor,1)
old='''def ber_route_pair(graph,start_coord,end_coord,profile,stop_a_name,stop_b_name):\n    if ber_pair_requires_pagny_005341(profile,stop_a_name,stop_b_name):'''
new='''def ber_route_pair(graph,start_coord,end_coord,profile,stop_a_name,stop_b_name):\n    if ber_pair_requires_pagny_canonical_v7(profile,stop_a_name,stop_b_name):\n        forced=ber_route_pagny_canonical_v7(graph,start_coord,end_coord,stop_a_name,stop_b_name)\n        if forced:\n            return forced\n        raise RuntimeError(f'Corridor RFN canonique Pagny V7 introuvable pour {stop_a_name} -> {stop_b_name}')\n    if ber_pair_requires_pagny_005341(profile,stop_a_name,stop_b_name):'''
if text.count(old)!=1:
    raise SystemExit(f'ERREUR bloc ber_route_pair attendu {text.count(old)} fois')
text=text.replace(old,new,1)
p.write_text(text,encoding='utf-8')
print('builder patché V7 : 005000 -> 005341 -> 090000 -> 089000')
PY
python3 -m py_compile "$BUILDER"

echo "=== 2/4 Reconstruction ciblée des TGV Paris/Champagne <-> Metz ==="
python3 - "$BUILDER" "$TRIPS" "$PATHS" "$NETWORK" "$LGV" "$SPEED" "$CONNECTIONS" "$EXTRA" "$TMP/trips.json" "$TMP/paths.json" <<'PY'
import hashlib,importlib.util,json,sys
from pathlib import Path
builder,trips_file,paths_file,network_file,lgv_file,speed_file,connections_file,extra_file,out_trips,out_paths=map(Path,sys.argv[1:])
spec=importlib.util.spec_from_file_location('lb_builder',builder); b=importlib.util.module_from_spec(spec); spec.loader.exec_module(b)
trips=json.load(open(trips_file,encoding='utf-8')); paths=json.load(open(paths_file,encoding='utf-8'))
network=b.load_geojson(network_file); speed_data=b.load_geojson(speed_file)
speed_by_line=b.metadata_by_line(speed_data,lambda props:b.parse_speed(props)); max_speeds={code:max(values) for code,values in speed_by_line.items() if values}
graph=b.RailGraph()
for feature in network.get('features',[]):
    props=feature.get('properties') or {}; code=b.line_code(props); status=str(b.pick(props,b.STATUS_KEYS,'EXPLOITE'))
    vmax=max_speeds.get(code,120.0)
    for coords in b.iter_lines(feature.get('geometry')): graph.add_line(coords,speed=vmax,is_lgv=(b.ber_line_key(code)==b.ber_line_key('005000')),status=status,code=code)
if extra_file.exists():
    for feature in b.load_geojson(extra_file).get('features',[]):
        props=feature.get('properties') or {}; code=b.line_code(props) or 'CFL'
        for coords in b.iter_lines(feature.get('geometry')): graph.add_line(coords,speed=120.0,is_lgv=False,status='EXPLOITE',code=code)
for feature in b.load_geojson(connections_file).get('features',[]):
    props=feature.get('properties') or {}
    if not b.is_connector_properties(props):continue
    code=b.line_code(props); vmax=max_speeds.get(code,100.0)
    for coords in b.iter_lines(feature.get('geometry')): graph.add_line(coords,speed=vmax,is_lgv=(b.ber_line_key(code)==b.ber_line_key('005000')),status='EXPLOITE',code=code)
graph.connect_nearby_endpoints()

cacheinfo=b.ber_v7_cache(graph)
print('jonctions V7 (m): 005000/005341=%.1f 005341/090000=%.1f 090000/089000=%.1f' % cacheinfo['gaps'])

def eligible(t):
    if str(t.get('category') or '').lower()!='tgv':return False
    s=t.get('stops') or []
    return any(b.ber_pair_requires_pagny_canonical_v7('tgv',s[i].get('name',''),s[i+1].get('name','')) for i in range(len(s)-1))

def build(t):
    stops=t.get('stops') or []; full=[]; offsets=[0.0]; canon=0
    for i in range(len(stops)-1):
        a,z=stops[i],stops[i+1]
        ac=(float(a['lon']),float(a['lat'])); zc=(float(z['lon']),float(z['lat']))
        nodes=b.ber_route_pair(graph,ac,zc,'tgv',a.get('name',''),z.get('name',''))
        if not nodes:return None
        if b.ber_pair_requires_pagny_canonical_v7('tgv',a.get('name',''),z.get('name','')):
            canon+=1
            xs=[graph.coords[n][0] for n in nodes]
            if max(xs)>6.26:raise SystemExit(f'détour est encore présent {a.get("name")}->{z.get("name")}: maxlon={max(xs)}')
            print(f'VALIDÉ CANONIQUE {a.get("name")} -> {z.get("name")}: 005000 -> 005341 -> 090000 -> 089000 ; maxlon={max(xs):.4f}')
        seg=b.simplify_collinear([graph.coords[n] for n in nodes])
        if full and seg and full[-1]==seg[0]:seg=seg[1:]
        full.extend(seg)
        offsets.append(b.path_metrics(full)[1] if len(full)>1 else offsets[-1])
    cumulative,length=b.path_metrics(full)
    return full,cumulative,length,offsets,canon

cache={}; changed=0; numbers=set(); n2807=0
for tid,t in trips.items():
    if not eligible(t):continue
    names=[str(s.get('name') or '') for s in (t.get('stops') or [])]
    sig='BER_TGV_PAGNY_CANONICAL_V7|'+'|'.join(b.norm(x) for x in names)
    item=cache.get(sig)
    if item is None:
        built=build(t)
        if not built:raise SystemExit(f'échec recalcul {tid}')
        coords,cumulative,length,offsets,canon=built
        pid='p-ber7-'+hashlib.sha1(sig.encode()).hexdigest()[:16]
        paths[pid]={'coordinates':coords,'cumulative':cumulative,'length':length,'stopOffsets':offsets,'profile':'tgv','pathSource':'BER_TGV_PAGNY_CANONICAL_V7','canonicalLines':['005000','005341','090000','089000'],'forbiddenConnector':'005340'}
        item=(pid,offsets,length,canon);cache[sig]=item
    pid,offsets,length,canon=item
    old=t.get('pathId'); old_len=(paths.get(old) or {}).get('length')
    if old_len is not None and length > float(old_len)+30000:
        raise SystemExit(f'chemin V7 anormalement plus long {tid}: {old_len} -> {length}')
    t['pathId']=pid;t['offsets']=offsets;t['pathSource']='BER_TGV_PAGNY_CANONICAL_V7'
    changed+=1;numbers.add(str(t.get('number') or ''))
    if str(t.get('number') or '')=='2807':n2807+=1
if changed<1:raise SystemExit('aucun TGV éligible V7')
if n2807<1:raise SystemExit('2807 non recalculé par V7')
json.dump(trips,open(out_trips,'w',encoding='utf-8'),ensure_ascii=False,separators=(',',':'))
json.dump(paths,open(out_paths,'w',encoding='utf-8'),ensure_ascii=False,separators=(',',':'))
print('TGV recalculés:',changed,'; variantes 2807:',n2807,'; numéros:',sorted(x for x in numbers if x)[:80])
PY

install -m 0644 "$TMP/trips.json" "$TRIPS"
install -m 0644 "$TMP/paths.json" "$PATHS"

echo "=== 3/4 Redémarrage + health ==="
systemctl restart "$SERVICE"
RESTARTED=1
sleep 2
curl -fsS http://127.0.0.1:3111/api/map-v2/health
echo

echo "=== 4/4 Contrôle final 2807 / dataset ==="
python3 - "$TRIPS" "$PATHS" <<'PY'
import json,sys
trips=json.load(open(sys.argv[1],encoding='utf-8'));paths=json.load(open(sys.argv[2],encoding='utf-8'))
rows=[]
for tid,t in trips.items():
    if str(t.get('number') or '')!='2807':continue
    if t.get('pathSource')!='BER_TGV_PAGNY_CANONICAL_V7':continue
    p=paths.get(t.get('pathId')) or {}; coords=p.get('coordinates') or []
    if not coords:raise SystemExit('2807 V7 sans coordonnées')
    maxlon=max(c[0] for c in coords)
    if maxlon>6.26:raise SystemExit(f'2807 V7 repart trop à l’est: {maxlon}')
    if p.get('canonicalLines')!=['005000','005341','090000','089000']:raise SystemExit('métadonnées canonique V7 absentes')
    rows.append((tid,t.get('pathId'),round(p.get('length',0)/1000,2),round(maxlon,5)))
if not rows:raise SystemExit('aucune variante 2807 V7')
print('2807 V7 OK — variantes:',len(rows))
for r in rows[:8]:print(' ',r)
PY

SUCCESS=1
echo "============================================================"
echo "CORRECTION TGV PAGNY CANONIQUE V7 OK"
echo "Paris/Champagne -> Metz : 005000 -> 005341 -> 090000 -> 089000"
echo "Détour Baudrecourt/Lucy : refusé par validation maxlon 6.26"
echo "Raccord sud 005340      : non utilisé"
echo "Backup                  : $BACKUP"
echo "============================================================"
