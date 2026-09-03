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

for f in "$BUILDER" "$TRIPS" "$PATHS" "$NETWORK" "$LGV" "$SPEED" "$CONNECTIONS"; do
  [[ -f "$f" ]] || { echo "ERREUR : fichier absent: $f" >&2; exit 2; }
done

echo "============================================================"
echo "AUDIT SEUL — TGV 2807 / LGV EST / RACCORDEMENTS LORRAINE"
echo "AUCUN FICHIER N'EST MODIFIE"
echo "============================================================"

python3 - "$BUILDER" "$TRIPS" "$PATHS" "$NETWORK" "$LGV" "$SPEED" "$CONNECTIONS" "$EXTRA" <<'PY'
import importlib.util,json,math,sys
from pathlib import Path

builder,trips_file,paths_file,network_file,lgv_file,speed_file,connections_file,extra_file=map(Path,sys.argv[1:])
spec=importlib.util.spec_from_file_location('lb_builder',builder)
b=importlib.util.module_from_spec(spec); spec.loader.exec_module(b)

def props_code(p):
    for k in ('CODE_LIGNE','code_ligne','code','NUM_LIGNE','num_ligne','ligne'):
        if p.get(k) not in (None,''):
            s=''.join(ch for ch in str(p.get(k)) if ch.isdigit())
            if s:
                return s.zfill(6)[-6:]
    try:
        return str(b.line_code(p) or '').zfill(6)[-6:]
    except Exception:
        return ''

def prop_name(p):
    vals=[]
    for k in ('LIB_LIGNE','lib_ligne','LIBELLE','libelle','NOM','nom','TYPE','type','STATUT','statut'):
        v=p.get(k)
        if v not in (None,'') and str(v) not in vals: vals.append(str(v))
    return ' | '.join(vals[:4])

def lines_of_geom(g):
    if not g:return []
    t=g.get('type'); c=g.get('coordinates') or []
    if t=='LineString': return [c]
    if t=='MultiLineString': return c
    return []

def bounds(coords):
    pts=[p for line in coords for p in line if len(p)>=2]
    if not pts:return None
    xs=[p[0] for p in pts]; ys=[p[1] for p in pts]
    return (min(xs),min(ys),max(xs),max(ys))

def endpoints(coords):
    out=[]
    for line in coords:
        if line: out.extend([line[0],line[-1]])
    return out

print('\n=== A. IDENTITE DES LIGNES OFFICIELLES DANS LES SOURCES RFN ===')
target={'005000','005340','005341','089000','090000','180000'}
for label,path in [('lignes-par-type',connections_file),('lignes-par-statut',network_file),('lignes-lgv',lgv_file)]:
    data=json.load(open(path,encoding='utf-8'))
    print(f'\n[{label}]')
    found=0
    for f in data.get('features',[]):
        p=f.get('properties') or {}; code=props_code(p)
        if code not in target: continue
        ls=lines_of_geom(f.get('geometry')); bb=bounds(ls); ep=endpoints(ls)
        print(' code=',code,' name=',prop_name(p))
        print('   bounds=',bb)
        print('   endpoints=',ep[:6])
        found+=1
    if not found: print('  (aucun des codes cibles trouvé)')

print('\n=== B. TOUS LES RACCORDEMENTS RFN AUTOUR DE PAGNY/VANDIERES/JAULNY ===')
data=json.load(open(connections_file,encoding='utf-8'))
# BBox volontairement large : Lorraine TGV / Jaulny / Pagny / Metz sud.
bbox=(5.65,48.72,6.28,49.10)
rows=[]
for f in data.get('features',[]):
    p=f.get('properties') or {}
    try:
        is_conn=b.is_connector_properties(p)
    except Exception:
        is_conn='RACC' in prop_name(p).upper()
    if not is_conn: continue
    ls=lines_of_geom(f.get('geometry')); bb=bounds(ls)
    if not bb: continue
    if bb[2]<bbox[0] or bb[0]>bbox[2] or bb[3]<bbox[1] or bb[1]>bbox[3]: continue
    rows.append((props_code(p),prop_name(p),bb,endpoints(ls)))
for r in sorted(rows):
    print(' ',r[0],r[1])
    print('    bounds=',r[2],' endpoints=',r[3][:4])
if not rows: print('  aucun raccordement dans la bbox')

print('\n=== C. CONSTRUCTION DU GRAPHE EXACTEMENT COMME LE MOTEUR ===')
network=b.load_geojson(network_file); lgv=b.load_geojson(lgv_file); speed_data=b.load_geojson(speed_file)
lgv_by_line=b.metadata_by_line(lgv,b.is_lgv_properties)
speed_by_line=b.metadata_by_line(speed_data,lambda props:b.parse_speed(props))
lgv_codes={code for code,values in lgv_by_line.items() if any(values)}
max_speeds={code:max(values) for code,values in speed_by_line.items() if values}
graph=b.RailGraph()
for feature in network.get('features',[]):
    p=feature.get('properties') or {}; code=b.line_code(p); status=str(b.pick(p,b.STATUS_KEYS,'EXPLOITE'))
    is_lgv=code in lgv_codes; vmax=max_speeds.get(code,300.0 if is_lgv else 120.0)
    for coords in b.iter_lines(feature.get('geometry')): graph.add_line(coords,speed=vmax,is_lgv=is_lgv,status=status,code=code)
if extra_file.exists():
    for feature in b.load_geojson(extra_file).get('features',[]):
        p=feature.get('properties') or {}; code=b.line_code(p) or 'CFL'
        for coords in b.iter_lines(feature.get('geometry')): graph.add_line(coords,speed=120.0,is_lgv=False,status='EXPLOITE',code=code)
for feature in b.load_geojson(connections_file).get('features',[]):
    p=feature.get('properties') or {}
    if not b.is_connector_properties(p): continue
    code=b.line_code(p); is_lgv=code in lgv_codes or b.is_lgv_properties(p); vmax=max_speeds.get(code,220.0 if is_lgv else 100.0)
    for coords in b.iter_lines(feature.get('geometry')): graph.add_line(coords,speed=vmax,is_lgv=is_lgv,status='EXPLOITE',code=code)
graph.connect_nearby_endpoints()
print('nodes=',len(graph.coords),' edge-buckets=',len(graph.edges))

def edge_attrs(u,v):
    for z,a in graph.edges.get(u,()):
        if z==v:return a
    return {}

def line_key(v):
    try:return b.ber_line_key(v)
    except Exception:
        s=''.join(ch for ch in str(v or '') if ch.isdigit())
        return str(int(s)) if s else str(v or '')

def compress(nodes):
    seq=[]
    for i in range(1,len(nodes or [])):
        a=edge_attrs(nodes[i-1],nodes[i]); k=line_key(a.get('line')); lgv=bool(a.get('lgv'))
        item=(k,lgv)
        if seq and seq[-1][0:2]==item:
            seq[-1]=(k,lgv,seq[-1][2]+1)
        else: seq.append((k,lgv,1))
    return seq

trips=json.load(open(trips_file,encoding='utf-8')); paths=json.load(open(paths_file,encoding='utf-8'))
cands=[]
for tid,t in trips.items():
    if str(t.get('number') or '')!='2807': continue
    names=[str(s.get('name') or '') for s in (t.get('stops') or [])]
    if any('CHAMPAGNE' in b.norm(n) for n in names) and any('METZ' in b.norm(n) for n in names): cands.append((tid,t))
print('\n=== D. 2807 DANS LE DATASET ===')
print('variantes 2807 Champagne->Metz:',len(cands))
for tid,t in cands[:8]:
    print(' trip=',tid,'pathId=',t.get('pathId'),'pathSource=',t.get('pathSource'))
    print(' stops=',[s.get('name') for s in (t.get('stops') or [])])
    p=paths.get(t.get('pathId')) or {}
    print(' path meta=',{k:p.get(k) for k in ('length','profile','pathSource','requiredConnector','forbiddenConnector')})

if not cands: raise SystemExit('Aucune variante 2807 Champagne-Ardenne TGV -> Metz')
t=cands[0][1]; stops=t.get('stops') or []
idx=None
for i in range(len(stops)-1):
    pair=b.norm(f"{stops[i].get('name','')}|{stops[i+1].get('name','')}")
    if 'CHAMPAGNE' in pair and 'METZ' in pair:
        idx=i; break
if idx is None: raise SystemExit('segment Champagne/Metz introuvable')
a,z=stops[idx],stops[idx+1]
ac=(float(a['lon']),float(a['lat'])); zc=(float(z['lon']),float(z['lat']))
print('\n=== E. ROUTE CALCULEE SANS CONTRAINTE :',a.get('name'),'->',z.get('name'),'===')
nodes=graph.route_between_coords(ac,zc,'tgv')
print('nodes=',len(nodes or []))
print('sequence lignes (code,LGV,nb_edges)=')
for x in compress(nodes): print(' ',x)

print('\n=== F. CONNECTIVITE PHYSIQUE DE 005341 DANS LE GRAPHE ===')
req=line_key('005341')
if hasattr(b,'ber_required_line_components'):
    comps=b.ber_required_line_components(graph,'005341')
else: comps=[]
print('components=',len(comps))
for ci,(comp,adj) in enumerate(comps):
    ends=[n for n in comp if len([q for q in adj.get(n,()) if q in comp])==1]
    print(' component',ci,'nodes=',len(comp),'endpoints=',len(ends))
    for n in ends:
        print('  endpoint node=',n,'coord=',graph.coords[n])
        neigh=[]
        for q,attrs in graph.edges.get(n,()):
            neigh.append((line_key(attrs.get('line')),bool(attrs.get('lgv')),graph.coords[q]))
        print('   adjacent=',neigh[:12])

print('\n=== G. TENTATIVE FORCEE 005341 AVEC LE MOTEUR V4 ACTUEL ===')
try:
    forced=b.ber_route_via_required_line(graph,ac,zc,'tgv','005341','005340')
except Exception as e:
    forced=None; print('exception=',repr(e))
if forced:
    print('nodes=',len(forced),'sequence=')
    for x in compress(forced): print(' ',x)
else:
    print('AUCUNE ROUTE FORCEE TROUVEE')

print('\n============================================================')
print('FIN AUDIT — aucune modification effectuee')
print('============================================================')
PY
