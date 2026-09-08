#!/usr/bin/env bash
set -euo pipefail

ROOT="/opt/labetaillere-map-v2-src/map-v2"
BUILDER="$ROOT/scripts/build_dataset.py"
TRIPS="$ROOT/data/generated/trips.json"
SRC="$ROOT/data/sources"
NETWORK="$SRC/lignes-par-statut.geojson"
CONNECTIONS="$SRC/lignes-par-type.geojson"
OUT="/tmp/moorail-axis-nancy-vandieres-canonical-v2.geojson"

for f in "$BUILDER" "$TRIPS" "$NETWORK" "$CONNECTIONS"; do
  [[ -f "$f" ]] || { echo "ERREUR : fichier absent: $f" >&2; exit 2; }
done

echo "============================================================"
echo " AUDIT SEUL — AXE CANONIQUE NANCY ↔ VANDIERES ↔ LGV EST"
echo " RFN 090000 -> 005340 -> 005000"
echo " AUCUN FICHIER DE PRODUCTION N'EST MODIFIE"
echo "============================================================"

python3 - "$BUILDER" "$TRIPS" "$NETWORK" "$CONNECTIONS" "$OUT" <<'PY'
import importlib.util,json,math,sys,heapq
from pathlib import Path

builder_file,trips_file,network_file,connections_file,out_file=map(Path,sys.argv[1:])
spec=importlib.util.spec_from_file_location('lb_builder',builder_file)
b=importlib.util.module_from_spec(spec); spec.loader.exec_module(b)

def line_key(v):
    if hasattr(b,'ber_line_key'):
        return b.ber_line_key(v)
    digits=''.join(ch for ch in str(v or '') if ch.isdigit())
    return str(int(digits)) if digits else str(v or '').upper()

def nodes_for_code(graph,code):
    k=line_key(code); out=set()
    for u,edges in graph.edges.items():
        for v,attrs in edges:
            if line_key((attrs or {}).get('line'))==k:
                out.add(u); out.add(v)
    return out

def nearest_node(graph,coord,nodes):
    best=None
    for n in nodes:
        d=b.haversine(coord,graph.coords[n])
        if best is None or d<best[0]: best=(d,n)
    return best

def filtered_route(graph,start,end,allowed_codes):
    allowed={line_key(x) for x in allowed_codes}
    if start==end:return [start]
    dist={start:0.0}; prev={}; heap=[(0.0,start)]
    while heap:
        cost,u=heapq.heappop(heap)
        if cost!=dist.get(u):continue
        if u==end:break
        for v,attrs in graph.edges.get(u,()):
            if line_key((attrs or {}).get('line')) not in allowed:continue
            nd=cost+b.haversine(graph.coords[u],graph.coords[v])
            if nd<dist.get(v,float('inf')):
                dist[v]=nd; prev[v]=u; heapq.heappush(heap,(nd,v))
    if end not in dist:return None
    out=[end]
    while out[-1]!=start:out.append(prev[out[-1]])
    out.reverse();return out

def dedupe_coords(coords):
    out=[]
    for c in coords:
        c=[float(c[0]),float(c[1])]
        if not out or out[-1]!=c:out.append(c)
    return out

def coords_len(coords):
    return sum(b.haversine(coords[i-1],coords[i]) for i in range(1,len(coords)))

# Graphe FR uniquement : PAS de lux-network.geojson, PAS de connect_nearby_endpoints().
# Les petits écarts entre lignes officielles sont pontés explicitement, comme le corridor canonique Pagny V7.
graph=b.RailGraph()
network=b.load_geojson(network_file)
for feature in network.get('features',[]):
    props=feature.get('properties') or {}
    code=b.line_code(props)
    status=str(b.pick(props,b.STATUS_KEYS,'EXPLOITE'))
    is_lgv=(line_key(code)==line_key('005000'))
    for coords in b.iter_lines(feature.get('geometry')):
        graph.add_line(coords,speed=300.0 if is_lgv else 140.0,is_lgv=is_lgv,status=status,code=code)

connections=b.load_geojson(connections_file)
for feature in connections.get('features',[]):
    props=feature.get('properties') or {}
    if not b.is_connector_properties(props):continue
    code=b.line_code(props)
    for coords in b.iter_lines(feature.get('geometry')):
        graph.add_line(coords,speed=160.0,is_lgv=False,status='EXPLOITE',code=code)

n90=nodes_for_code(graph,'090000')
n5340=nodes_for_code(graph,'005340')
n5000=nodes_for_code(graph,'005000')
print(f'noeuds lignes : 090000={len(n90)} ; 005340={len(n5340)} ; 005000={len(n5000)}')
if not all((n90,n5340,n5000)):
    raise SystemExit('ERREUR : une ligne canonique est absente du graphe FR')

# Trouve un trip réel pour les coordonnées Nancy / Champagne-Ardenne TGV.
trips=json.load(open(trips_file,encoding='utf-8'))
nancy=None; champagne=None; trip_id=None; train=None
for tid,t in trips.items():
    stops=t.get('stops') or []
    by={str(s.get('name') or ''):s for s in stops}
    if 'Nancy' in by and 'Champagne-Ardenne TGV' in by:
        n=by['Nancy']; c=by['Champagne-Ardenne TGV']
        if None not in (n.get('lon'),n.get('lat'),c.get('lon'),c.get('lat')):
            nancy=(float(n['lon']),float(n['lat']))
            champagne=(float(c['lon']),float(c['lat']))
            trip_id=tid; train=t.get('number'); break
if not nancy or not champagne:
    raise SystemExit('ERREUR : aucune variante Nancy / Champagne-Ardenne TGV avec coordonnées')
print(f'trip repère={trip_id} train={train}')
print('Nancy=',nancy,' Champagne-Ardenne TGV=',champagne)

# Extrémité 005340 côté Nancy/classique = point du 005340 le plus proche de 090000.
req_classic=min(n5340,key=lambda n: nearest_node(graph,graph.coords[n],n90)[0])
j90=nearest_node(graph,graph.coords[req_classic],n90)
# Extrémité 005340 côté LGV = point du 005340 le plus proche de 005000.
req_lgv=min(n5340,key=lambda n: nearest_node(graph,graph.coords[n],n5000)[0])
j5000=nearest_node(graph,graph.coords[req_lgv],n5000)

if req_classic==req_lgv:
    raise SystemExit('ERREUR : même nœud choisi aux deux extrémités de 005340')

gap90=j90[0]; gap5000=j5000[0]
print(f'jonction 090000 ↔ 005340 : {gap90:.1f} m')
print(f'jonction 005340 ↔ 005000 : {gap5000:.1f} m')
print('005340 côté Nancy=',graph.coords[req_classic])
print('005340 côté LGV  =',graph.coords[req_lgv])
if gap90>1500 or gap5000>1500:
    raise SystemExit(f'ERREUR : écart de topologie trop grand (090000={gap90:.0f}m, 005000={gap5000:.0f}m)')

# Axe Nancy sur 090000 seulement.
nancy_anchor=nearest_node(graph,nancy,n90)
champ_anchor=nearest_node(graph,champagne,n5000)
print(f'Nancy -> 090000 : {nancy_anchor[0]:.1f} m')
print(f'Champagne -> 005000 : {champ_anchor[0]:.1f} m')
if nancy_anchor[0]>5000 or champ_anchor[0]>5000:
    raise SystemExit('ERREUR : gare trop éloignée de sa ligne canonique')

p90=filtered_route(graph,nancy_anchor[1],j90[1],('090000',))
p5340=filtered_route(graph,req_classic,req_lgv,('005340',))
if not p5340:
    # Essai sens inverse, puis remise dans le sens Nancy -> LGV.
    rev=filtered_route(graph,req_lgv,req_classic,('005340',))
    p5340=list(reversed(rev)) if rev else None
p5000=filtered_route(graph,j5000[1],champ_anchor[1],('005000',))
if not p90: raise SystemExit('ERREUR : impossible de suivre 090000 entre Nancy et Vandières')
if not p5340: raise SystemExit('ERREUR : impossible de parcourir 005340 de bout en bout')
if not p5000: raise SystemExit('ERREUR : impossible de suivre 005000 entre Vandières et Champagne')

c90=[graph.coords[n] for n in p90]
c5340=[graph.coords[n] for n in p5340]
c5000=[graph.coords[n] for n in p5000]
# Ponts explicites des petits écarts RFN : j90 -> entrée 005340 puis sortie 005340 -> j5000.
coords=dedupe_coords(c90+[graph.coords[req_classic]]+c5340+[graph.coords[j5000[1]]]+c5000)
length=coords_len(coords)
print(f'longueur axe canonique Nancy -> Champagne = {length/1000:.2f} km')
print('séquence CANONIQUE = 090000 -> 005340 -> 005000')

# Garde-fous : pas de détour national, pas de CFL, pas de CONNECTOR synthétique puisque seuls trois codes sont assemblés.
if not (100000 <= length <= 220000):
    raise SystemExit(f'ERREUR : longueur canonique anormale {length/1000:.1f} km')
if max(c[1] for c in coords)>50.0 or min(c[1] for c in coords)<48.0:
    raise SystemExit('ERREUR : détour géographique nord/sud anormal')

geo={
  'type':'FeatureCollection',
  'features':[{
    'type':'Feature',
    'properties':{
      'id':'axis-nancy-vandieres-005340-v2',
      'name':'Nancy → Vandières → LGV Est',
      'canonicalLines':['090000','005340','005000'],
      'requiredConnector':'005340',
      'forbiddenConnector':'005341',
      'gap090000_005340_m':round(gap90,2),
      'gap005340_005000_m':round(gap5000,2),
      'length_m':round(length,2),
      'sourceTrip':trip_id,
      'sourceTrain':str(train or '')
    },
    'geometry':{'type':'LineString','coordinates':coords}
  }]
}
json.dump(geo,open(out_file,'w',encoding='utf-8'),ensure_ascii=False,indent=2)
print()
print('============================================================')
print(' AXE CANONIQUE NANCY ↔ VANDIERES TROUVE')
print(' 090000 -> 005340 -> 005000')
print(' Aucun CFL. Aucun CONNECTOR synthétique dans la séquence.')
print('============================================================')
print('GeoJSON test:',out_file)
print('Aucun fichier de production modifié.')
PY
