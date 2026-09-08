#!/usr/bin/env bash
set -euo pipefail

ROOT="/opt/labetaillere-map-v2-src/map-v2"
BUILDER="$ROOT/scripts/build_dataset.py"
TRIPS="$ROOT/data/generated/trips.json"
SRC="$ROOT/data/sources"
NETWORK="$SRC/lignes-par-statut.geojson"
CONNECTIONS="$SRC/lignes-par-type.geojson"
OUT="/tmp/moorail-axis-nancy-vandieres-canonical-v3.geojson"

for f in "$BUILDER" "$TRIPS" "$NETWORK" "$CONNECTIONS"; do
  [[ -f "$f" ]] || { echo "ERREUR : fichier absent: $f" >&2; exit 2; }
done

echo "============================================================"
echo " AUDIT SEUL — AXE NANCY ↔ VANDIERES ↔ LGV EST — V3"
echo " détection ligne Nancy + chaîne RFN stricte jusqu'à 005000"
echo " AUCUN FICHIER DE PRODUCTION N'EST MODIFIE"
echo "============================================================"

python3 - "$BUILDER" "$TRIPS" "$NETWORK" "$CONNECTIONS" "$OUT" <<'PY'
import importlib.util, json, math, sys, heapq
from pathlib import Path

builder,trips_file,network_file,connections_file,out_file=map(Path,sys.argv[1:])
spec=importlib.util.spec_from_file_location('lb_builder',builder)
b=importlib.util.module_from_spec(spec); spec.loader.exec_module(b)

NANCY=(6.174579,48.689857)
CHAMP=(3.994523,49.214769)
TARGETS=['090000','005340','005000']

def lk(v):
    s=''.join(ch for ch in str(v or '') if ch.isdigit())
    if s:
        return str(int(s))
    try:
        return b.ber_line_key(v)
    except Exception:
        return str(v or '').upper()

def hav(a,z):
    return b.haversine(a,z)

graph=b.RailGraph()
network=b.load_geojson(network_file)
for feature in network.get('features',[]):
    p=feature.get('properties') or {}
    code=b.line_code(p)
    status=str(b.pick(p,b.STATUS_KEYS,'EXPLOITE'))
    for coords in b.iter_lines(feature.get('geometry')):
        graph.add_line(coords,speed=120.0,is_lgv=(lk(code)==lk('005000')),status=status,code=code)

# Ajoute uniquement les raccordements OFFICIELS RFN. Aucun CFL. Aucun connect_nearby_endpoints().
for feature in b.load_geojson(connections_file).get('features',[]):
    p=feature.get('properties') or {}
    if not b.is_connector_properties(p):
        continue
    code=b.line_code(p)
    for coords in b.iter_lines(feature.get('geometry')):
        graph.add_line(coords,speed=100.0,is_lgv=(lk(code)==lk('005000')),status='EXPLOITE',code=code)

print(f'graphe strict: nodes={len(graph.coords)} edge-buckets={len(graph.edges)}')

nodes_by_code={}
for u,edges in graph.edges.items():
    for v,a in edges:
        code=lk((a or {}).get('line'))
        if not code:
            continue
        nodes_by_code.setdefault(code,set()).add(u)
        nodes_by_code.setdefault(code,set()).add(v)

for code in TARGETS:
    k=lk(code)
    print(f'ligne {code}: {len(nodes_by_code.get(k,set()))} noeuds')
    if not nodes_by_code.get(k):
        raise SystemExit(f'ERREUR : ligne {code} absente du graphe strict')

def nearest_node(coord,nodes):
    best=None
    for n in nodes:
        d=hav(coord,graph.coords[n])
        if best is None or d<best[0]: best=(d,n)
    return best

def nearest_pair(a_nodes,z_nodes):
    # Dataset gérable ici : filtre grossier grille pour éviter O(N²) national.
    cell=.01; grid={}
    for n in z_nodes:
        lon,lat=graph.coords[n]; grid.setdefault((int(lon/cell),int(lat/cell)),[]).append(n)
    best=None
    for a in a_nodes:
        lon,lat=graph.coords[a]; ix=int(lon/cell); iy=int(lat/cell)
        for r in range(0,12):
            found=False
            for x in range(ix-r,ix+r+1):
                for y in range(iy-r,iy+r+1):
                    if r and ix-r<x<ix+r and iy-r<y<iy+r: continue
                    for z in grid.get((x,y),()):
                        d=hav(graph.coords[a],graph.coords[z]); found=True
                        if best is None or d<best[0]: best=(d,a,z)
            if found and best and best[0] < (r+1)*1100:
                break
    return best

def filtered_route(start,end,allowed):
    allowed={lk(x) for x in allowed}
    dist={start:0.0}; prev={}; heap=[(0.0,start)]
    while heap:
        cost,u=heapq.heappop(heap)
        if cost!=dist.get(u): continue
        if u==end: break
        for v,a in graph.edges.get(u,()):
            if lk((a or {}).get('line')) not in allowed: continue
            nd=cost+hav(graph.coords[u],graph.coords[v])
            if nd < dist.get(v,float('inf')):
                dist[v]=nd; prev[v]=u; heapq.heappush(heap,(nd,v))
    if end not in dist: return None
    out=[end]
    while out[-1]!=start: out.append(prev[out[-1]])
    out.reverse(); return out

def path_len(nodes):
    return sum(hav(graph.coords[nodes[i-1]],graph.coords[nodes[i]]) for i in range(1,len(nodes)))

def dedupe(seq):
    out=[]
    for n in seq:
        if not out or out[-1]!=n: out.append(n)
    return out

# 1) Détecte les lignes réellement proches de Nancy.
candidates=[]
for code,nodes in nodes_by_code.items():
    if code in {'CFL','CONNECTOR',''}: continue
    n=nearest_node(NANCY,nodes)
    if n and n[0] <= 1200:
        j=nearest_pair(nodes,nodes_by_code[lk('090000')])
        candidates.append((n[0],999999 if not j else j[0],code,n,j))
candidates.sort()
print('\nLIGNES RFN PROCHES DE NANCY :')
for d,jd,code,_,_ in candidates[:15]:
    print(f'  {code:>8}  Nancy={d:7.1f} m  vers 090000={jd:7.1f} m')

# Favorise une ligne à <=300m de Nancy ET jointe à 090000 à <=300m.
valid=[x for x in candidates if x[0] <= 300 and x[1] <= 300]
if not valid:
    raise SystemExit('ERREUR : aucune ligne RFN proche de Nancy ne rejoint proprement 090000')
# 001000 est attendu, mais on ne le force pas si le dataset dit autre chose.
valid.sort(key=lambda x: ((0 if x[2]==lk('001000') else 1), x[0]+x[1]))
ndist,jdist,nancy_code,nancy_near,nancy_to_90=valid[0]
print(f'\nLIGNE NANCY RETENUE : {nancy_code} (gare {ndist:.1f} m ; jonction 090000 {jdist:.1f} m)')

# 2) Calcule toutes les jonctions de chaîne.
n90=nodes_by_code[lk('090000')]; n5340=nodes_by_code[lk('005340')]; n5000=nodes_by_code[lk('005000')]
j_n_90=nancy_to_90
j_90_5340=nearest_pair(n90,n5340)
j_5340_5000=nearest_pair(n5340,n5000)
west=nearest_node(CHAMP,n5000)
if not all((j_n_90,j_90_5340,j_5340_5000,west)):
    raise SystemExit('ERREUR : jonction canonique manquante')

print('\nJONCTIONS :')
print(f'  {nancy_code} ↔ 090000 : {j_n_90[0]:.1f} m')
print(f'  090000 ↔ 005340 : {j_90_5340[0]:.1f} m')
print(f'  005340 ↔ 005000 : {j_5340_5000[0]:.1f} m')
print(f'  Champagne ↔ 005000 : {west[0]:.1f} m')

if ndist>300 or west[0]>500 or j_n_90[0]>300 or j_90_5340[0]>150 or j_5340_5000[0]>100:
    raise SystemExit('ERREUR : une jonction dépasse le seuil de sécurité')

# 3) Construit le corridor physique ligne par ligne.
start=nancy_near[1]
# nearest_pair = (distance, node_ligne_A, node_ligne_B)
a_n90=j_n_90[1]; z_n90=j_n_90[2]
a_90=j_90_5340[1]; z_5340=j_90_5340[2]
a_5340=j_5340_5000[1]; z_5000=j_5340_5000[2]
end=west[1]

p_nancy=filtered_route(start,a_n90,(nancy_code,))
p_90=filtered_route(z_n90,a_90,('090000',))
p_5340=filtered_route(z_5340,a_5340,('005340',))
p_5000=filtered_route(z_5000,end,('005000',))
for label,pth in [('Nancy',p_nancy),('090000',p_90),('005340',p_5340),('005000',p_5000)]:
    if not pth:
        raise SystemExit(f'ERREUR : impossible de parcourir la section {label} uniquement sur sa ligne RFN')

print('\nLONGUEURS PHYSIQUES :')
print(f'  Nancy/{nancy_code}: {path_len(p_nancy)/1000:.2f} km')
print(f'  090000: {path_len(p_90)/1000:.2f} km')
print(f'  005340: {path_len(p_5340)/1000:.2f} km')
print(f'  005000 jusqu\'à Champagne: {path_len(p_5000)/1000:.2f} km')

# Assemble avec ponts explicites des jonctions RFN (pas des arêtes CONNECTOR synthétiques).
coords=[]
def add_nodes(nodes):
    global coords
    for n in nodes:
        c=list(graph.coords[n])
        if not coords or coords[-1]!=c: coords.append(c)
def bridge(a,b):
    global coords
    ca=list(graph.coords[a]); cb=list(graph.coords[b])
    if not coords or coords[-1]!=ca: coords.append(ca)
    if coords[-1]!=cb: coords.append(cb)

add_nodes(p_nancy); bridge(a_n90,z_n90)
add_nodes(p_90); bridge(a_90,z_5340)
add_nodes(p_5340); bridge(a_5340,z_5000)
add_nodes(p_5000)

# Contrôle géographique sommaire.
length=sum(hav(coords[i-1],coords[i]) for i in range(1,len(coords)))
print(f'\nLONGUEUR AXE Nancy -> Champagne: {length/1000:.2f} km')
if not (120000 <= length <= 220000):
    raise SystemExit(f'ERREUR : longueur axe anormale {length/1000:.2f} km')

fc={
  'type':'FeatureCollection',
  'properties':{
    'name':'MooRail axe canonique Nancy-Vandieres-LGV V3',
    'canonicalLines':[nancy_code,'090000','005340','005000'],
    'syntheticConnectors':False,
    'lengthM':length,
    'gapsM':{
      f'{nancy_code}-090000':j_n_90[0],
      '090000-005340':j_90_5340[0],
      '005340-005000':j_5340_5000[0]
    }
  },
  'features':[{
    'type':'Feature',
    'properties':{'kind':'canonical-axis','axis':'Nancy-Vandieres-LGV','lines':[nancy_code,'090000','005340','005000']},
    'geometry':{'type':'LineString','coordinates':coords}
  }]
}
out_file.write_text(json.dumps(fc,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')

print('\n============================================================')
print('AXE CANONIQUE NANCY ↔ VANDIERES TROUVE')
print(f'{nancy_code} -> 090000 -> 005340 -> 005000')
print('Aucun CFL. Aucun connect_nearby_endpoints().')
print('Les seules coupures RFN sont pontées explicitement aux jonctions mesurées ci-dessus.')
print('============================================================')
print('GeoJSON test:',out_file)
PY
