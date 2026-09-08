#!/usr/bin/env bash
set -euo pipefail

ROOT="/opt/labetaillere-map-v2-src/map-v2"
BUILDER="$ROOT/scripts/build_dataset.py"
TRIPS="$ROOT/data/generated/trips.json"
SRC="$ROOT/data/sources"
NETWORK="$SRC/lignes-par-statut.geojson"
LGV="$SRC/lignes-lgv.geojson"
SPEED="$SRC/vitesses.geojson"
CONNECTIONS="$SRC/lignes-par-type.geojson"
EXTRA="$SRC/lux-network.geojson"
OUT="/tmp/moorail-axis-nancy-vandieres-005340.geojson"

for f in "$BUILDER" "$TRIPS" "$NETWORK" "$LGV" "$SPEED" "$CONNECTIONS"; do
  [[ -f "$f" ]] || { echo "ERREUR fichier absent: $f" >&2; exit 2; }
done

echo "============================================================"
echo " AUDIT SEUL — AXE NANCY ↔ VANDIERES / RACCORD RFN 005340"
echo " AUCUN FICHIER MOO RAIL N'EST MODIFIE"
echo "============================================================"

python3 - "$BUILDER" "$TRIPS" "$NETWORK" "$LGV" "$SPEED" "$CONNECTIONS" "$EXTRA" "$OUT" <<'PY'
import importlib.util,json,math,sys
from pathlib import Path

builder,trips_file,network_file,lgv_file,speed_file,connections_file,extra_file,out_file=map(Path,sys.argv[1:])
spec=importlib.util.spec_from_file_location('lb_builder',builder)
b=importlib.util.module_from_spec(spec); spec.loader.exec_module(b)

required_fn=getattr(b,'ber_route_via_required_line',None)
if not callable(required_fn):
    raise SystemExit('ERREUR: ber_route_via_required_line absent du builder actuel')

line_key=getattr(b,'ber_line_key',None)
def lk(v):
    if callable(line_key): return line_key(v)
    s=''.join(ch for ch in str(v or '') if ch.isdigit())
    return str(int(s)) if s else str(v or '')

def edge_attrs(graph,u,v):
    for z,a in graph.edges.get(u,()):
        if z==v:return a
    return {}

def line_sequence(graph,nodes):
    out=[]
    for i in range(1,len(nodes or [])):
        a=edge_attrs(graph,nodes[i-1],nodes[i])
        k=lk(a.get('line'))
        if not out or out[-1]!=k: out.append(k)
    return out

def edge_count(graph,code):
    key=lk(code); n=0
    for u,edges in graph.edges.items():
        for v,a in edges:
            if lk(a.get('line'))==key:n+=1
    return n//2

def build_graph():
    network=b.load_geojson(network_file); lgv=b.load_geojson(lgv_file); speed_data=b.load_geojson(speed_file)
    lgv_by_line=b.metadata_by_line(lgv,b.is_lgv_properties)
    speed_by_line=b.metadata_by_line(speed_data,lambda props:b.parse_speed(props))
    lgv_codes={code for code,values in lgv_by_line.items() if any(values)}
    max_speeds={code:max(values) for code,values in speed_by_line.items() if values}
    graph=b.RailGraph()
    for feature in network.get('features',[]):
        p=feature.get('properties') or {}; code=b.line_code(p); status=str(b.pick(p,b.STATUS_KEYS,'EXPLOITE'))
        is_lgv=code in lgv_codes; vmax=max_speeds.get(code,300.0 if is_lgv else 120.0)
        for coords in b.iter_lines(feature.get('geometry')):
            graph.add_line(coords,speed=vmax,is_lgv=is_lgv,status=status,code=code)
    if extra_file.exists():
        for feature in b.load_geojson(extra_file).get('features',[]):
            p=feature.get('properties') or {}; code=b.line_code(p) or 'CFL'
            for coords in b.iter_lines(feature.get('geometry')):
                graph.add_line(coords,speed=120.0,is_lgv=False,status='EXPLOITE',code=code)
    for feature in b.load_geojson(connections_file).get('features',[]):
        p=feature.get('properties') or {}
        if not b.is_connector_properties(p): continue
        code=b.line_code(p); is_lgv=code in lgv_codes or b.is_lgv_properties(p)
        vmax=max_speeds.get(code,220.0 if is_lgv else 100.0)
        for coords in b.iter_lines(feature.get('geometry')):
            graph.add_line(coords,speed=vmax,is_lgv=is_lgv,status='EXPLOITE',code=code)
    graph.connect_nearby_endpoints()
    return graph

graph=build_graph()
print(f'graphe nodes={len(graph.coords)}')
print(f'arêtes 005340={edge_count(graph,"005340")} ; 005341={edge_count(graph,"005341")}')
if edge_count(graph,'005340')<1:
    raise SystemExit('ERREUR: aucune arête RFN 005340 dans le graphe de production')

trips=json.load(open(trips_file,encoding='utf-8'))

def N(s): return b.norm(str(s or ''))

def coord(stop): return (float(stop['lon']),float(stop['lat']))

pairs=[]
for tid,t in trips.items():
    if N(t.get('category'))!='TGV': continue
    stops=t.get('stops') or []
    for i in range(len(stops)-1):
        a,z=stops[i],stops[i+1]
        pa=N(a.get('name')); pz=N(z.get('name'))
        if ('NANCY' in pa and ('CHAMPAGNE' in pz or 'PARIS' in pz)) or ('NANCY' in pz and ('CHAMPAGNE' in pa or 'PARIS' in pa)):
            pairs.append((tid,t,i,a,z))

if not pairs:
    # fallback: any TGV with Nancy and Paris/Champagne non-consecutive, test first relevant pair endpoints
    for tid,t in trips.items():
        if N(t.get('category'))!='TGV': continue
        stops=t.get('stops') or []
        ni=[s for s in stops if 'NANCY' in N(s.get('name'))]
        wi=[s for s in stops if 'CHAMPAGNE' in N(s.get('name')) or 'PARIS' in N(s.get('name'))]
        if ni and wi:
            pairs.append((tid,t,None,ni[0],wi[0])); break

if not pairs: raise SystemExit('ERREUR: aucun TGV Nancy ↔ Champagne/Paris trouvé dans trips.json')

# Prefer Nancy <-> Champagne because it isolates exactly the Vandières/LGV transition.
pairs.sort(key=lambda x:(0 if 'CHAMPAGNE' in N(x[4].get('name')) or 'CHAMPAGNE' in N(x[3].get('name')) else 1, str(x[1].get('number') or '')))
tid,t,idx,a,z=pairs[0]
print('\nTEST:')
print(' trip=',tid,' train=',t.get('number'))
print(' pair=',a.get('name'),'->',z.get('name'))

nodes=required_fn(graph,coord(a),coord(z),'tgv','005340','005341')
if not nodes:
    raise SystemExit('RESULTAT: AUCUN AXE FORCE 005340 TROUVE')
seq=line_sequence(graph,nodes)
print('nodes=',len(nodes))
print('sequence lignes=', ' -> '.join(seq))
req=lk('005340'); forb=lk('005341')
if req not in seq:
    raise SystemExit('ERREUR: route trouvée mais 005340 absent')
if forb in seq:
    raise SystemExit('ERREUR: route 005340 utilise aussi 005341')

coords=[graph.coords[n] for n in nodes]
length=sum(b.haversine(coords[i-1],coords[i]) for i in range(1,len(coords)))
print(f'longueur={length/1000:.2f} km' if length>1000 else f'longueur={length:.2f} m')

geo={
  'type':'FeatureCollection',
  'features':[{
    'type':'Feature',
    'properties':{
      'id':'axis-nancy-vandieres-005340',
      'label':'Nancy ↔ Vandières / raccord sud 005340',
      'requiredLine':'005340',
      'forbiddenLine':'005341',
      'train':str(t.get('number') or ''),
      'from':a.get('name'),'to':z.get('name'),
      'lineSequence':seq
    },
    'geometry':{'type':'LineString','coordinates':coords}
  }]
}
json.dump(geo,open(out_file,'w',encoding='utf-8'),ensure_ascii=False,indent=2)
print('\n============================================================')
print('AXE 005340 TROUVE ET VALIDE')
print('============================================================')
print('GeoJSON test:',out_file)
print('Aucun fichier de production modifié.')
PY
