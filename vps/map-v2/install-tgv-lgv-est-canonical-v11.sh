#!/usr/bin/env bash
set -euo pipefail

ROOT="/opt/labetaillere-map-v2-src/map-v2"
BUILDER="$ROOT/scripts/build_dataset.py"
TRIPS="$ROOT/data/generated/trips.json"
PATHS="$ROOT/data/generated/paths.json"
SRC="$ROOT/data/sources"
NETWORK="$SRC/lignes-par-statut.geojson"
SPEED="$SRC/vitesses.geojson"
CONNECTIONS="$SRC/lignes-par-type.geojson"
EXTRA="$SRC/lux-network.geojson"
SERVICE="labetaillere-map-v2.service"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$ROOT/backups/tgv-lgv-est-canonical-v11-$STAMP"
TMP="$(mktemp -d /tmp/lb-tgv-lgv-est-v11.XXXXXX)"
SUCCESS=0
RESTARTED=0

cleanup(){ rm -rf "$TMP"; }
rollback(){
  if [[ "$SUCCESS" -eq 1 ]]; then return; fi
  if [[ -d "$BACKUP" ]]; then
    echo "ERREUR : rollback TGV LGV Est canonical V11..." >&2
    for f in "$BUILDER" "$TRIPS" "$PATHS"; do
      b="$BACKUP/$(basename "$f")"
      [[ -f "$b" ]] && cp -a "$b" "$f"
    done
    if [[ "$RESTARTED" -eq 1 ]]; then
      systemctl restart "$SERVICE" >/dev/null 2>&1 || true
    fi
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

cat > "$TMP/patch_builder.py" <<'PY'
from pathlib import Path
import re,sys
p=Path(sys.argv[1]); text=p.read_text(encoding='utf-8')
marker='# BER_TGV_LGV_EST_CANONICAL_V11'
if marker in text:
    print('builder V11 déjà présent')
    raise SystemExit(0)
if '# BER_TGV_REQUIRED_CONNECTOR_V3' not in text:
    raise SystemExit('ERREUR : base Pagny V3 absente du builder')
anchor='\ndef ber_route_pair(graph,start_coord,end_coord,profile,stop_a_name,stop_b_name):\n'
if text.count(anchor)!=1:
    raise SystemExit(f'ERREUR : ancre ber_route_pair trouvée {text.count(anchor)} fois')
helper=r'''
# BER_TGV_LGV_EST_CANONICAL_V11
# Corridor physique des TGV Paris-Est <-> Metz/Luxembourg :
# 001000 (Paris-Est -> Noisy-le-Sec) -> 070000 (Noisy-le-Sec -> Vaires)
# -> 005000 (LGV Est) -> 005341 (raccord Pagny nord) -> 090000 -> 089000 -> Metz.
# Les GeoJSON RFN ont quelques doubles sommets quasi identiques mais non soudés.
# V11 autorise uniquement des micro-ponts INTERNES A UNE MEME LIGNE <= 1.0 m.
_BER_V11_CACHE={}
_BER_V11_ADJ_CACHE={}

def ber_v11_tag_stop(name):
    n=norm(str(name or ''))
    if 'PARIS' in n:
        return 'paris'
    if 'CHAMPAGNE' in n or 'MEUSE TGV' in n:
        return 'lgv'
    if 'METZ' in n:
        return 'metz'
    return None

def ber_v11_pair_kind(profile,a,z):
    if profile != 'tgv':
        return None
    ta=ber_v11_tag_stop(a); tz=ber_v11_tag_stop(z)
    pair={ta,tz}
    if pair=={'paris','lgv'}:
        return 'paris_lgv'
    if pair=={'paris','metz'}:
        return 'paris_metz'
    if pair=={'lgv','metz'}:
        return 'lgv_metz'
    return None

def ber_v11_nodes_for_code(graph,code):
    key=ber_line_key(code); out=set()
    for u,edges in graph.edges.items():
        for v,attrs in edges:
            if ber_line_key((attrs or {}).get('line'))==key:
                out.add(u); out.add(v)
    return out

def ber_v11_nearest_node(graph,coord,nodes):
    best=None
    for n in nodes:
        d=haversine(coord,graph.coords[n])
        if best is None or d<best[0]: best=(d,n)
    return best

def ber_v11_nearest_pair(graph,a_nodes,b_nodes):
    cell=0.01
    grid={}
    for n in b_nodes:
        lon,lat=graph.coords[n]
        grid.setdefault((int(lon/cell),int(lat/cell)),[]).append(n)
    best=None
    for a in a_nodes:
        lon,lat=graph.coords[a]; ix=int(lon/cell); iy=int(lat/cell)
        for r in range(0,10):
            seen=False
            for x in range(ix-r,ix+r+1):
                for y in range(iy-r,iy+r+1):
                    if r and ix-r<x<ix+r and iy-r<y<iy+r: continue
                    for b in grid.get((x,y),()):
                        d=haversine(graph.coords[a],graph.coords[b]); seen=True
                        if best is None or d<best[0]: best=(d,a,b)
            if seen and best is not None and best[0] < (r+1)*1200:
                break
    return best

def ber_v11_line_adj(graph,code):
    ck=(id(graph),ber_line_key(code))
    if ck in _BER_V11_ADJ_CACHE:
        return _BER_V11_ADJ_CACHE[ck]
    key=ber_line_key(code)
    nodes=ber_v11_nodes_for_code(graph,code)
    adj={n:[] for n in nodes}
    for u in nodes:
        for v,attrs in graph.edges.get(u,()):
            if v in nodes and ber_line_key((attrs or {}).get('line'))==key:
                adj[u].append((v,haversine(graph.coords[u],graph.coords[v]),False))
    # Micro-soudure strictement interne à la même ligne, <=1 m.
    # Cellule ~2.2 m en latitude : on ne teste que les voisins immédiats.
    cell=0.00002
    grid={}
    for n in nodes:
        lon,lat=graph.coords[n]
        grid.setdefault((int(lon/cell),int(lat/cell)),[]).append(n)
    bridges=0
    for u in nodes:
        lon,lat=graph.coords[u]; ix=int(lon/cell); iy=int(lat/cell)
        existing={v for v,_,_ in adj[u]}
        for x in range(ix-1,ix+2):
            for y in range(iy-1,iy+2):
                for v in grid.get((x,y),()):
                    if v==u or v in existing: continue
                    d=haversine(graph.coords[u],graph.coords[v])
                    if d<=1.0:
                        adj[u].append((v,d,True)); bridges+=1
    _BER_V11_ADJ_CACHE[ck]=(adj,bridges)
    return adj,bridges

def ber_v11_line_route(graph,start,end,code):
    import heapq
    adj,_=ber_v11_line_adj(graph,code)
    if start not in adj or end not in adj:return None
    if start==end:return [start]
    dist={start:0.0}; prev={}; heap=[(0.0,start)]
    while heap:
        cost,u=heapq.heappop(heap)
        if cost!=dist.get(u):continue
        if u==end:break
        for v,w,_virtual in adj.get(u,()):
            nd=cost+w
            if nd<dist.get(v,float('inf')):
                dist[v]=nd; prev[v]=u; heapq.heappush(heap,(nd,v))
    if end not in dist:return None
    out=[end]
    while out[-1]!=start:out.append(prev[out[-1]])
    out.reverse();return out

def ber_v11_dedupe(parts):
    out=[]
    for part in parts:
        for n in (part or []):
            if not out or out[-1]!=n:out.append(n)
    return out

def ber_v11_cache(graph):
    k=id(graph)
    if k in _BER_V11_CACHE:return _BER_V11_CACHE[k]
    codes=('001000','070000','005000','005341','090000','089000')
    ns={c:ber_v11_nodes_for_code(graph,c) for c in codes}
    missing={c:len(v) for c,v in ns.items() if not v}
    if missing:raise RuntimeError(f'V11 lignes RFN absentes: {missing}')
    j10=ber_v11_nearest_pair(graph,ns['001000'],ns['070000'])
    j05=ber_v11_nearest_pair(graph,ns['070000'],ns['005000'])
    j53=ber_v11_nearest_pair(graph,ns['005000'],ns['005341'])
    j39=ber_v11_nearest_pair(graph,ns['005341'],ns['090000'])
    j98=ber_v11_nearest_pair(graph,ns['090000'],ns['089000'])
    pairs={'001000/070000':j10,'070000/005000':j05,'005000/005341':j53,'005341/090000':j39,'090000/089000':j98}
    for name,pair in pairs.items():
        if not pair or pair[0]>1200:
            raise RuntimeError(f'V11 jonction {name} absente/trop éloignée: {None if not pair else pair[0]}')
    raccord=ber_v11_line_route(graph,j53[2],j39[1],'005341')
    if not raccord:raise RuntimeError('V11 raccord 005341 non parcourable')
    data={
      'nodes':ns,
      'j001_e':j10[1],'j070_w':j10[2],
      'j070_e':j05[1],'j005_w':j05[2],
      'j005_e':j53[1],'j341_w':j53[2],
      'j341_e':j39[1],'j090_w':j39[2],
      'j090_e':j98[1],'j089_w':j98[2],
      'raccord':raccord,'gaps':tuple(x[0] for x in (j10,j05,j53,j39,j98))
    }
    _BER_V11_CACHE[k]=data;return data

def ber_v11_forward_paris_to_lgv(graph,paris_coord,lgv_coord):
    c=ber_v11_cache(graph)
    p=ber_v11_nearest_node(graph,paris_coord,c['nodes']['001000'])
    z=ber_v11_nearest_node(graph,lgv_coord,c['nodes']['005000'])
    if not p or not z or p[0]>1000 or z[0]>5000:return None
    p1=ber_v11_line_route(graph,p[1],c['j001_e'],'001000')
    p7=ber_v11_line_route(graph,c['j070_w'],c['j070_e'],'070000')
    p5=ber_v11_line_route(graph,c['j005_w'],z[1],'005000')
    if not p1 or not p7 or not p5:return None
    return ber_v11_dedupe((p1,p7,p5))

def ber_v11_forward_lgv_to_metz(graph,lgv_coord,metz_coord):
    c=ber_v11_cache(graph)
    a=ber_v11_nearest_node(graph,lgv_coord,c['nodes']['005000'])
    z=ber_v11_nearest_node(graph,metz_coord,c['nodes']['089000'])
    if not a or not z or a[0]>5000 or z[0]>1000:return None
    p5=ber_v11_line_route(graph,a[1],c['j005_e'],'005000')
    p9=ber_v11_line_route(graph,c['j090_w'],c['j090_e'],'090000')
    p8=ber_v11_line_route(graph,c['j089_w'],z[1],'089000')
    if not p5 or not p9 or not p8:return None
    return ber_v11_dedupe((p5,c['raccord'],p9,p8))

def ber_v11_forward_paris_to_metz(graph,paris_coord,metz_coord):
    c=ber_v11_cache(graph)
    p=ber_v11_nearest_node(graph,paris_coord,c['nodes']['001000'])
    z=ber_v11_nearest_node(graph,metz_coord,c['nodes']['089000'])
    if not p or not z or p[0]>1000 or z[0]>1000:return None
    p1=ber_v11_line_route(graph,p[1],c['j001_e'],'001000')
    p7=ber_v11_line_route(graph,c['j070_w'],c['j070_e'],'070000')
    p5=ber_v11_line_route(graph,c['j005_w'],c['j005_e'],'005000')
    p9=ber_v11_line_route(graph,c['j090_w'],c['j090_e'],'090000')
    p8=ber_v11_line_route(graph,c['j089_w'],z[1],'089000')
    if not p1 or not p7 or not p5 or not p9 or not p8:return None
    return ber_v11_dedupe((p1,p7,p5,c['raccord'],p9,p8))

def ber_route_lgv_est_canonical_v11(graph,start_coord,end_coord,profile,a,z):
    kind=ber_v11_pair_kind(profile,a,z)
    if not kind:return None
    ta=ber_v11_tag_stop(a); reverse=False
    if kind=='paris_lgv':
        if ta=='paris':nodes=ber_v11_forward_paris_to_lgv(graph,start_coord,end_coord)
        else:nodes=ber_v11_forward_paris_to_lgv(graph,end_coord,start_coord);reverse=True
    elif kind=='lgv_metz':
        if ta=='lgv':nodes=ber_v11_forward_lgv_to_metz(graph,start_coord,end_coord)
        else:nodes=ber_v11_forward_lgv_to_metz(graph,end_coord,start_coord);reverse=True
    else:
        if ta=='paris':nodes=ber_v11_forward_paris_to_metz(graph,start_coord,end_coord)
        else:nodes=ber_v11_forward_paris_to_metz(graph,end_coord,start_coord);reverse=True
    if not nodes:return None
    # Toute la partie Metz doit rester à l'ouest de Lucy/Baudrecourt.
    if ('METZ' in norm(a) or 'METZ' in norm(z)) and max(graph.coords[n][0] for n in nodes)>6.26:
        raise RuntimeError(f'V11 détour oriental détecté pour {a} -> {z}')
    return list(reversed(nodes)) if reverse else nodes
'''
text=text.replace(anchor,'\n'+helper+anchor,1)
old='''def ber_route_pair(graph,start_coord,end_coord,profile,stop_a_name,stop_b_name):\n    if ber_pair_requires_pagny_005341(profile,stop_a_name,stop_b_name):'''
new='''def ber_route_pair(graph,start_coord,end_coord,profile,stop_a_name,stop_b_name):\n    if ber_v11_pair_kind(profile,stop_a_name,stop_b_name):\n        forced=ber_route_lgv_est_canonical_v11(graph,start_coord,end_coord,profile,stop_a_name,stop_b_name)\n        if forced:\n            return forced\n        raise RuntimeError(f'Corridor RFN LGV Est V11 introuvable pour {stop_a_name} -> {stop_b_name}')\n    if ber_pair_requires_pagny_005341(profile,stop_a_name,stop_b_name):'''
if text.count(old)!=1:raise SystemExit(f'ERREUR : début ber_route_pair attendu une fois, trouvé {text.count(old)}')
text=text.replace(old,new,1)
p.write_text(text,encoding='utf-8')
print('builder patché V11')
PY

build_graph_py=''

# ---------- PRE-FLIGHT SUR COPIE : AUCUNE MODIFICATION ----------
cp -a "$BUILDER" "$TMP/build_dataset.py"
python3 "$TMP/patch_builder.py" "$TMP/build_dataset.py"
python3 -m py_compile "$TMP/build_dataset.py"

echo "============================================================"
echo "TGV LGV EST — PRÉFLIGHT V11 SANS MODIFICATION"
echo "001000 -> 070000 -> 005000 -> 005341 -> 090000 -> 089000"
echo "micro-soudures internes même ligne <= 1.0 m"
echo "============================================================"

python3 - "$TMP/build_dataset.py" "$TRIPS" "$NETWORK" "$SPEED" "$CONNECTIONS" "$EXTRA" <<'PY'
import importlib.util,json,sys
from pathlib import Path
builder,trips_file,network_file,speed_file,connections_file,extra_file=map(Path,sys.argv[1:])
spec=importlib.util.spec_from_file_location('lbv11',builder); b=importlib.util.module_from_spec(spec); spec.loader.exec_module(b)
trips=json.load(open(trips_file,encoding='utf-8'))
network=b.load_geojson(network_file); speed_data=b.load_geojson(speed_file)
speed_by_line=b.metadata_by_line(speed_data,lambda props:b.parse_speed(props)); max_speeds={code:max(values) for code,values in speed_by_line.items() if values}
graph=b.RailGraph()
for feature in network.get('features',[]):
    props=feature.get('properties') or {}; code=b.line_code(props); status=str(b.pick(props,b.STATUS_KEYS,'EXPLOITE'))
    for coords in b.iter_lines(feature.get('geometry')):graph.add_line(coords,speed=max_speeds.get(code,120.0),is_lgv=(b.ber_line_key(code)==b.ber_line_key('005000')),status=status,code=code)
if extra_file.exists():
    for feature in b.load_geojson(extra_file).get('features',[]):
        props=feature.get('properties') or {}; code=b.line_code(props) or 'CFL'
        for coords in b.iter_lines(feature.get('geometry')):graph.add_line(coords,speed=120.0,is_lgv=False,status='EXPLOITE',code=code)
for feature in b.load_geojson(connections_file).get('features',[]):
    props=feature.get('properties') or {}
    if not b.is_connector_properties(props):continue
    code=b.line_code(props)
    for coords in b.iter_lines(feature.get('geometry')):graph.add_line(coords,speed=max_speeds.get(code,100.0),is_lgv=False,status='EXPLOITE',code=code)
graph.connect_nearby_endpoints()
c=b.ber_v11_cache(graph)
print('jonctions V11 (m): 001000/070000=%.1f 070000/005000=%.1f 005000/005341=%.1f 005341/090000=%.1f 090000/089000=%.1f' % c['gaps'])
for code in ('001000','070000','005000','005341','090000','089000'):
    _adj,bridges=b.ber_v11_line_adj(graph,code);print(f'micro-ponts {code}: {bridges//2}')

# Une variante réelle 2807 avec Champagne, et une sans Champagne.
vs=[t for t in trips.values() if str(t.get('number') or '')=='2807']
if not vs:raise SystemExit('ERREUR : 2807 absent du dataset')
coords={}
for t in vs:
    for s in (t.get('stops') or []):coords[str(s.get('name') or '')]=(float(s['lon']),float(s['lat']))
for name in ('Paris Est','Metz'):
    if name not in coords:raise SystemExit(f'ERREUR : {name} absent des variantes 2807')
checks=[('Paris Est','Metz'),('Metz','Paris Est')]
if 'Champagne-Ardenne TGV' in coords:
    checks += [('Paris Est','Champagne-Ardenne TGV'),('Champagne-Ardenne TGV','Paris Est'),('Champagne-Ardenne TGV','Metz'),('Metz','Champagne-Ardenne TGV')]
for a,z in checks:
    nodes=b.ber_route_pair(graph,coords[a],coords[z],'tgv',a,z)
    if not nodes:raise SystemExit(f'ERREUR préflight {a} -> {z}: aucun chemin')
    length=sum(b.haversine(graph.coords[nodes[i-1]],graph.coords[nodes[i]]) for i in range(1,len(nodes)))
    print(f'OK V11 {a} -> {z}: {len(nodes)} noeuds, {length/1000:.2f} km')
print('PRÉFLIGHT V11 VALIDÉ — aucune modification effectuée jusque-là')
PY

# ---------- INSTALLATION TRANSACTIONNELLE ----------
mkdir -p "$BACKUP"
cp -a "$BUILDER" "$TRIPS" "$PATHS" "$BACKUP/"
echo "Backup : $BACKUP"
python3 "$TMP/patch_builder.py" "$BUILDER"
python3 -m py_compile "$BUILDER"

echo "=== Reconstruction des TGV concernés ==="
python3 - "$BUILDER" "$TRIPS" "$PATHS" "$NETWORK" "$SPEED" "$CONNECTIONS" "$EXTRA" "$TMP/trips.json" "$TMP/paths.json" <<'PY'
import hashlib,importlib.util,json,sys
from pathlib import Path
builder,trips_file,paths_file,network_file,speed_file,connections_file,extra_file,out_trips,out_paths=map(Path,sys.argv[1:])
spec=importlib.util.spec_from_file_location('lbv11',builder); b=importlib.util.module_from_spec(spec); spec.loader.exec_module(b)
trips=json.load(open(trips_file,encoding='utf-8'));paths=json.load(open(paths_file,encoding='utf-8'))
network=b.load_geojson(network_file);speed_data=b.load_geojson(speed_file)
speed_by_line=b.metadata_by_line(speed_data,lambda props:b.parse_speed(props));max_speeds={code:max(values) for code,values in speed_by_line.items() if values}
graph=b.RailGraph()
for feature in network.get('features',[]):
    props=feature.get('properties') or {};code=b.line_code(props);status=str(b.pick(props,b.STATUS_KEYS,'EXPLOITE'))
    for coords in b.iter_lines(feature.get('geometry')):graph.add_line(coords,speed=max_speeds.get(code,120.0),is_lgv=(b.ber_line_key(code)==b.ber_line_key('005000')),status=status,code=code)
if extra_file.exists():
    for feature in b.load_geojson(extra_file).get('features',[]):
        props=feature.get('properties') or {};code=b.line_code(props) or 'CFL'
        for coords in b.iter_lines(feature.get('geometry')):graph.add_line(coords,speed=120.0,is_lgv=False,status='EXPLOITE',code=code)
for feature in b.load_geojson(connections_file).get('features',[]):
    props=feature.get('properties') or {}
    if not b.is_connector_properties(props):continue
    code=b.line_code(props)
    for coords in b.iter_lines(feature.get('geometry')):graph.add_line(coords,speed=max_speeds.get(code,100.0),is_lgv=False,status='EXPLOITE',code=code)
graph.connect_nearby_endpoints()

def eligible(t):
    if str(t.get('category') or '').lower()!='tgv':return False
    s=t.get('stops') or []
    return any(b.ber_v11_pair_kind('tgv',s[i].get('name',''),s[i+1].get('name','')) for i in range(len(s)-1))

def build(t):
    stops=t.get('stops') or [];full=[];offsets=[0.0];canon=0
    for i in range(len(stops)-1):
        a,z=stops[i],stops[i+1]
        nodes=b.ber_route_pair(graph,(float(a['lon']),float(a['lat'])),(float(z['lon']),float(z['lat'])),'tgv',a.get('name',''),z.get('name',''))
        if not nodes:return None
        if b.ber_v11_pair_kind('tgv',a.get('name',''),z.get('name','')):
            canon+=1;print(f"VALIDÉ V11 {a.get('name')} -> {z.get('name')}")
        seg=b.simplify_collinear([graph.coords[n] for n in nodes])
        if full and seg and full[-1]==seg[0]:seg=seg[1:]
        full.extend(seg)
        offsets.append(b.path_metrics(full)[1] if len(full)>1 else offsets[-1])
    cumulative,length=b.path_metrics(full)
    return full,cumulative,length,offsets,canon

cache={};changed=0;n2807=0
for tid,t in trips.items():
    if not eligible(t):continue
    names=[str(s.get('name') or '') for s in (t.get('stops') or [])]
    sig='BER_TGV_LGV_EST_CANONICAL_V11|'+'|'.join(b.norm(x) for x in names)
    item=cache.get(sig)
    if item is None:
        built=build(t)
        if not built:raise SystemExit(f'échec recalcul {tid}')
        coords,cumulative,length,offsets,canon=built
        pid='p-ber11-'+hashlib.sha1(sig.encode()).hexdigest()[:16]
        paths[pid]={'coordinates':coords,'cumulative':cumulative,'length':length,'stopOffsets':offsets,'profile':'tgv','pathSource':'BER_TGV_LGV_EST_CANONICAL_V11','corridor':['001000','070000','005000','005341','090000','089000'],'microStitchMaxM':1.0}
        item=(pid,offsets,length);cache[sig]=item
    pid,offsets,length=item
    old=t.get('pathId');old_len=(paths.get(old) or {}).get('length')
    if old_len is not None and length>float(old_len)+30000:raise SystemExit(f'chemin V11 anormalement long {tid}: {old_len} -> {length}')
    t['pathId']=pid;t['offsets']=offsets;t['pathSource']='BER_TGV_LGV_EST_CANONICAL_V11'
    changed+=1
    if str(t.get('number') or '')=='2807':n2807+=1
if changed<1:raise SystemExit('aucun TGV recalculé V11')
if n2807<1:raise SystemExit('2807 non recalculé V11')
print('TGV recalculés V11:',changed,'variantes 2807:',n2807)
json.dump(trips,open(out_trips,'w',encoding='utf-8'),ensure_ascii=False,separators=(',',':'))
json.dump(paths,open(out_paths,'w',encoding='utf-8'),ensure_ascii=False,separators=(',',':'))
PY

python3 - "$TMP/trips.json" "$TMP/paths.json" <<'PY'
import json,sys
trips=json.load(open(sys.argv[1],encoding='utf-8'));paths=json.load(open(sys.argv[2],encoding='utf-8'))
rows=[t for t in trips.values() if str(t.get('number') or '')=='2807' and t.get('pathSource')=='BER_TGV_LGV_EST_CANONICAL_V11']
if not rows:raise SystemExit('ERREUR contrôle final: aucune variante 2807 V11')
for t in rows[:8]:
 p=paths.get(t.get('pathId')) or {};print('2807 V11 OK:',[s.get('name') for s in t.get('stops',[])],round(float(p.get('length') or 0)/1000,2),'km')
PY

cp -a "$TMP/trips.json" "$TRIPS"
cp -a "$TMP/paths.json" "$PATHS"
systemctl restart "$SERVICE"
RESTARTED=1
sleep 1
curl -fsS http://127.0.0.1:3111/api/map-v2/health
printf '\n'
SUCCESS=1

echo "============================================================"
echo "V11 INSTALLÉE — corridor LGV Est canonique actif"
echo "001000 -> 070000 -> 005000 -> 005341 -> 090000 -> 089000"
echo "Backup : $BACKUP"
echo "============================================================"
