#!/usr/bin/env bash
set -euo pipefail

ROOT="/opt/labetaillere-map-v2-src/map-v2"
BUILDER="$ROOT/scripts/build_dataset.py"
TRIPS="$ROOT/data/generated/trips.json"
SRC="$ROOT/data/sources"
NETWORK="$SRC/lignes-par-statut.geojson"
SPEED="$SRC/vitesses.geojson"
CONNECTIONS="$SRC/lignes-par-type.geojson"
EXTRA="$SRC/lux-network.geojson"

echo "============================================================"
echo "AUDIT V10 — SEGMENT EXACT QUI CASSE LE CORRIDOR TGV LGV EST"
echo "AUCUNE MODIFICATION DU VPS / LIVE"
echo "============================================================"

python3 - "$BUILDER" "$TRIPS" "$NETWORK" "$SPEED" "$CONNECTIONS" "$EXTRA" <<'PY'
import importlib.util,json,sys,heapq,math
from pathlib import Path
builder,trips_file,network_file,speed_file,connections_file,extra_file=map(Path,sys.argv[1:])
spec=importlib.util.spec_from_file_location('lb',builder)
b=importlib.util.module_from_spec(spec); spec.loader.exec_module(b)
trips=json.load(open(trips_file,encoding='utf-8'))
network=b.load_geojson(network_file); speed_data=b.load_geojson(speed_file)
speed_by_line=b.metadata_by_line(speed_data,lambda props:b.parse_speed(props)); max_speeds={code:max(values) for code,values in speed_by_line.items() if values}
graph=b.RailGraph()
for feature in network.get('features',[]):
    props=feature.get('properties') or {}; code=b.line_code(props); status=str(b.pick(props,b.STATUS_KEYS,'EXPLOITE'))
    vmax=max_speeds.get(code,120.0)
    for coords in b.iter_lines(feature.get('geometry')):
        graph.add_line(coords,speed=vmax,is_lgv=(b.ber_line_key(code)==b.ber_line_key('005000')),status=status,code=code)
if extra_file.exists():
    for feature in b.load_geojson(extra_file).get('features',[]):
        props=feature.get('properties') or {}; code=b.line_code(props) or 'CFL'
        for coords in b.iter_lines(feature.get('geometry')):
            graph.add_line(coords,speed=120.0,is_lgv=False,status='EXPLOITE',code=code)
for feature in b.load_geojson(connections_file).get('features',[]):
    props=feature.get('properties') or {}
    if not b.is_connector_properties(props): continue
    code=b.line_code(props); vmax=max_speeds.get(code,100.0)
    for coords in b.iter_lines(feature.get('geometry')):
        graph.add_line(coords,speed=vmax,is_lgv=(b.ber_line_key(code)==b.ber_line_key('005000')),status='EXPLOITE',code=code)
graph.connect_nearby_endpoints()

codes=('070000','005000','005341','090000','089000')
connector=b.ber_line_key('connector')

def nodes_for(code):
    key=b.ber_line_key(code); out=set()
    for u,edges in graph.edges.items():
        for v,a in edges:
            if b.ber_line_key((a or {}).get('line'))==key:
                out.add(u); out.add(v)
    return out
ns={c:nodes_for(c) for c in codes}
print('NOEUDS PAR LIGNE:',{c:len(ns[c]) for c in codes})

def nearest_node(coord,nodes):
    best=None
    for n in nodes:
        d=b.haversine(coord,graph.coords[n])
        if best is None or d<best[0]: best=(d,n)
    return best

def nearest_pair(A,B):
    # audit dataset assez petit ici : grille pour rester rapide
    cell=.01; grid={}
    for n in B:
        lon,lat=graph.coords[n]; grid.setdefault((int(lon/cell),int(lat/cell)),[]).append(n)
    best=None
    for a in A:
        lon,lat=graph.coords[a]; ix=int(lon/cell); iy=int(lat/cell)
        for r in range(12):
            seen=False
            for x in range(ix-r,ix+r+1):
                for y in range(iy-r,iy+r+1):
                    if r and ix-r<x<ix+r and iy-r<y<iy+r: continue
                    for z in grid.get((x,y),()):
                        seen=True; d=b.haversine(graph.coords[a],graph.coords[z])
                        if best is None or d<best[0]: best=(d,a,z)
            if seen and best is not None and best[0]<(r+1)*1200: break
    return best

j70=nearest_pair(ns['070000'],ns['005000'])
j05=nearest_pair(ns['005000'],ns['005341'])
j59=nearest_pair(ns['005341'],ns['090000'])
j98=nearest_pair(ns['090000'],ns['089000'])
for label,p in [('070000/005000',j70),('005000/005341',j05),('005341/090000',j59),('090000/089000',j98)]:
    print(f'JONCTION {label}: {p[0]:.1f} m  A={graph.coords[p[1]]} B={graph.coords[p[2]]}')

# prend une variante 2807 contenant Champagne, donc toutes les coordonnées utiles
sel=None
for t in trips.values():
    if str(t.get('number') or '')!='2807': continue
    names=[str(s.get('name') or '') for s in (t.get('stops') or [])]
    if any('Paris' in x for x in names) and any('Champagne' in x for x in names) and any('Metz' in x for x in names):
        sel=t; break
if not sel: raise SystemExit('2807 Paris/Champagne/Metz introuvable dans trips.json')
stop={str(s.get('name') or ''):s for s in (sel.get('stops') or [])}
def coord_like(token):
    for name,s in stop.items():
        if token.lower() in name.lower(): return (float(s['lon']),float(s['lat']))
    raise RuntimeError(token)
paris=coord_like('Paris'); champ=coord_like('Champagne'); metz=coord_like('Metz')
print('\nCOORDONNEES 2807:')
print(' Paris=',paris,'Champagne=',champ,'Metz=',metz)
for label,coord,code in [('Paris',paris,'070000'),('Champagne',champ,'005000'),('Metz',metz,'089000')]:
    q=nearest_node(coord,ns[code]); print(f'SNAP {label}->{code}: {q[0]:.1f} m node={q[1]} coord={graph.coords[q[1]]}')

# même Dijkstra que V10, mais avec diagnostic du motif d'échec
def line_route(start,end,code,max_connector=300.0):
    key=b.ber_line_key(code); line_nodes=ns[code]
    if start not in line_nodes or end not in line_nodes: return None,0
    dist={start:0.0}; prev={}; heap=[(0.0,start)]; visited=0
    while heap:
        cost,u=heapq.heappop(heap)
        if cost!=dist.get(u): continue
        visited+=1
        if u==end: break
        for v,a in graph.edges.get(u,()):
            line=b.ber_line_key((a or {}).get('line'))
            ok=(line==key)
            if not ok and line==connector and u in line_nodes and v in line_nodes:
                ok=b.haversine(graph.coords[u],graph.coords[v])<=max_connector
            if not ok: continue
            nd=cost+b.haversine(graph.coords[u],graph.coords[v])
            if nd<dist.get(v,float('inf')):
                dist[v]=nd; prev[v]=u; heapq.heappush(heap,(nd,v))
    if end not in dist: return None,visited
    out=[end]
    while out[-1]!=start: out.append(prev[out[-1]])
    out.reverse(); return out,visited

def pathlen(nodes):
    return sum(b.haversine(graph.coords[nodes[i-1]],graph.coords[nodes[i]]) for i in range(1,len(nodes))) if nodes else 0

p_par=nearest_node(paris,ns['070000'])[1]
p_ch=nearest_node(champ,ns['005000'])[1]
p_m=nearest_node(metz,ns['089000'])[1]
tests=[
 ('070000 Paris -> Vaires',p_par,j70[1],'070000'),
 ('005000 Vaires -> Pagny',j70[2],j05[1],'005000'),
 ('005000 Champagne -> Pagny',p_ch,j05[1],'005000'),
 ('005341 raccord Pagny',j05[2],j59[1],'005341'),
 ('090000 Pagny -> jonction 089000',j59[2],j98[1],'090000'),
 ('089000 jonction -> Metz',j98[2],p_m,'089000'),
]
print('\nTESTS SEGMENTS V10 (connecteurs internes <=300m):')
failed=[]
for label,a,z,code in tests:
    r,v=line_route(a,z,code,300.0)
    if r:
        print(f' OK   {label}: {len(r)} noeuds, {pathlen(r)/1000:.2f} km, visited={v}')
    else:
        print(f' FAIL {label}: aucun chemin, visited={v}')
        failed.append((label,a,z,code))

# Si échec, calcule les composantes de la ligne stricte + micro-connecteurs et la plus petite cassure entre composantes.
def component(start,code,max_connector=300.0):
    key=b.ber_line_key(code); line_nodes=ns[code]; seen={start}; stack=[start]
    while stack:
        u=stack.pop()
        for v,a in graph.edges.get(u,()):
            line=b.ber_line_key((a or {}).get('line'))
            ok=(line==key)
            if not ok and line==connector and u in line_nodes and v in line_nodes:
                ok=b.haversine(graph.coords[u],graph.coords[v])<=max_connector
            if ok and v not in seen:
                seen.add(v); stack.append(v)
    return seen

for label,a,z,code in failed:
    ca=component(a,code); cz=component(z,code)
    print(f'\nDIAGNOSTIC {label}: composante départ={len(ca)} / arrivée={len(cz)} / total ligne={len(ns[code])}')
    # trouve la distance géographique minimale entre les deux composantes
    pair=nearest_pair(ca,cz)
    if pair:
        print(f' cassure minimale entre composantes: {pair[0]:.1f} m')
        print('  départ cassure:',graph.coords[pair[1]])
        print('  arrivée cassure:',graph.coords[pair[2]])
        # inspecte les arêtes autour des deux bords
        for side,n in [('A',pair[1]),('B',pair[2])]:
            neigh=[]
            for v,attrs in graph.edges.get(n,()):
                neigh.append((b.ber_line_key((attrs or {}).get('line')),round(b.haversine(graph.coords[n],graph.coords[v]),1),graph.coords[v]))
            print(' ',side,'voisins:',neigh[:12])

print('\nFIN AUDIT — aucune modification.')
PY
