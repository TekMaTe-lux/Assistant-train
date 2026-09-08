#!/usr/bin/env bash
set -euo pipefail

ROOT="${MOORAIL_ROOT:-/opt/labetaillere-map-v2-src/map-v2}"
BUILDER="$ROOT/scripts/build_dataset.py"
TRIPS="$ROOT/data/generated/trips.json"
PATHS="$ROOT/data/generated/paths.json"
NETWORK="$ROOT/data/sources/lignes-par-statut.geojson"
SPEED="$ROOT/data/sources/vitesses.geojson"
CONNECTIONS="$ROOT/data/sources/lignes-par-type.geojson"
EDITOR="$ROOT/public/moorail-route-editor.html"
AXIS_PUBLIC="$ROOT/public/data/moorail-axis-nancy-pagny-lgv-v1.geojson"
SERVICE="labetaillere-map-v2.service"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$ROOT/backups/nancy-pagny-axis-v1-$STAMP"
TMP="$(mktemp -d /tmp/lb-nancy-pagny-axis.XXXXXX)"
SUCCESS=0
RESTARTED=0

cleanup(){ rm -rf "$TMP"; }
rollback(){
  rc=$?
  trap - EXIT
  if [[ "$SUCCESS" != "1" ]]; then
    echo >&2
    echo "ERREUR : rollback Nancy -> Pagny -> LGV..." >&2
    [[ -f "$BACKUP/trips.json" ]] && cp -a "$BACKUP/trips.json" "$TRIPS" || true
    [[ -f "$BACKUP/paths.json" ]] && cp -a "$BACKUP/paths.json" "$PATHS" || true
    if [[ -f "$BACKUP/moorail-route-editor.html" ]]; then cp -a "$BACKUP/moorail-route-editor.html" "$EDITOR" || true; fi
    if [[ -f "$BACKUP/moorail-axis-nancy-pagny-lgv-v1.geojson" ]]; then
      mkdir -p "$(dirname "$AXIS_PUBLIC")"; cp -a "$BACKUP/moorail-axis-nancy-pagny-lgv-v1.geojson" "$AXIS_PUBLIC" || true
    elif [[ -f "$AXIS_PUBLIC" ]]; then
      rm -f "$AXIS_PUBLIC" || true
    fi
    if [[ "$RESTARTED" == "1" ]]; then systemctl restart "$SERVICE" >/dev/null 2>&1 || true; fi
  fi
  cleanup
  exit "$rc"
}
trap rollback EXIT

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  echo "ERREUR : lancer avec sudo/root" >&2
  exit 2
fi

for f in "$BUILDER" "$TRIPS" "$PATHS" "$NETWORK" "$SPEED" "$CONNECTIONS" "$EDITOR"; do
  [[ -f "$f" ]] || { echo "ERREUR : fichier absent: $f" >&2; exit 3; }
done

mkdir -p "$BACKUP" "$(dirname "$AXIS_PUBLIC")"
cp -a "$TRIPS" "$BACKUP/trips.json"
cp -a "$PATHS" "$BACKUP/paths.json"
cp -a "$EDITOR" "$BACKUP/moorail-route-editor.html"
[[ ! -f "$AXIS_PUBLIC" ]] || cp -a "$AXIS_PUBLIC" "$BACKUP/moorail-axis-nancy-pagny-lgv-v1.geojson"

echo "============================================================"
echo " MOO RAIL — AXE NANCY -> PAGNY -> LGV EST"
echo " Réutilise le raccord Pagny déjà correct sur la carte live"
echo " Axe RFN : 070000 -> 090000 -> 005341 -> LGV 005000"
echo "============================================================"
echo "Backup : $BACKUP"
echo

python3 - "$BUILDER" "$TRIPS" "$PATHS" "$NETWORK" "$SPEED" "$CONNECTIONS" "$TMP/trips.json" "$TMP/paths.json" "$TMP/axis.geojson" <<'PY'
import hashlib, importlib.util, json, math, sys
from pathlib import Path

builder_file,trips_file,paths_file,network_file,speed_file,connections_file,out_trips,out_paths,out_axis=map(Path,sys.argv[1:])
spec=importlib.util.spec_from_file_location('lb_builder',builder_file)
b=importlib.util.module_from_spec(spec); spec.loader.exec_module(b)

needed=['ber_line_key','ber_v7_nodes_for_code','ber_v7_nearest_node','ber_v7_filtered_route','ber_v7_cache']
missing=[x for x in needed if not hasattr(b,x)]
if missing:
    raise SystemExit('ERREUR : moteur canonique Pagny V7 absent/incomplet: '+', '.join(missing))

trips=json.load(open(trips_file,encoding='utf-8'))
paths=json.load(open(paths_file,encoding='utf-8'))
network=b.load_geojson(network_file)
speed_data=b.load_geojson(speed_file)
speed_by_line=b.metadata_by_line(speed_data,lambda props:b.parse_speed(props))
max_speeds={code:max(values) for code,values in speed_by_line.items() if values}

def key(v): return b.ber_line_key(v)

graph=b.RailGraph()
for feature in network.get('features',[]):
    props=feature.get('properties') or {}
    code=b.line_code(props)
    status=str(b.pick(props,b.STATUS_KEYS,'EXPLOITE'))
    vmax=max_speeds.get(code,300.0 if key(code)==key('005000') else 120.0)
    for coords in b.iter_lines(feature.get('geometry')):
        graph.add_line(coords,speed=vmax,is_lgv=(key(code)==key('005000')),status=status,code=code)
for feature in b.load_geojson(connections_file).get('features',[]):
    props=feature.get('properties') or {}
    if not b.is_connector_properties(props): continue
    code=b.line_code(props)
    vmax=max_speeds.get(code,220.0 if key(code) in (key('005000'),key('005341')) else 100.0)
    for coords in b.iter_lines(feature.get('geometry')):
        graph.add_line(coords,speed=vmax,is_lgv=(key(code)==key('005000')),status='EXPLOITE',code=code)
# IMPORTANT : pas de connect_nearby_endpoints ici. On assemble seulement les lignes RFN voulues.

c=b.ber_v7_cache(graph)
n70=b.ber_v7_nodes_for_code(graph,'070000')
n90=c['n90000']
if not n70 or not n90:
    raise SystemExit(f'ERREUR : lignes axe absentes: 070000={len(n70)} 090000={len(n90)}')

# Coordonnées de Nancy prises dans le dataset actif.
nancy=None
paris=None
for t in trips.values():
    for s in t.get('stops') or []:
        name=b.norm(str(s.get('name') or ''))
        if nancy is None and name=='NANCY': nancy=(float(s['lon']),float(s['lat']))
        if paris is None and 'PARIS EST' in name: paris=(float(s['lon']),float(s['lat']))
    if nancy and paris: break
if not nancy or not paris:
    raise SystemExit('ERREUR : coordonnées Nancy/Paris introuvables')

# Cherche la jonction 070000/090000 réellement atteignable depuis Nancy sur 070000.
nancy_anchor=b.ber_v7_nearest_node(graph,nancy,n70)
if not nancy_anchor or nancy_anchor[0] > 1000:
    raise SystemExit(f'ERREUR : Nancy trop loin de 070000: {None if not nancy_anchor else nancy_anchor[0]:.1f} m')

def route_len(nodes):
    return sum(b.haversine(graph.coords[nodes[i-1]],graph.coords[nodes[i]]) for i in range(1,len(nodes)))

# Candidats 070000 à moins de 150 m de 090000, puis garde celui accessible par le plus court trajet depuis Nancy.
cands=[]
# grille grossière pour les noeuds 090000
grid={}; cell=.004
for n in n90:
    lon,lat=graph.coords[n]; grid.setdefault((int(lon/cell),int(lat/cell)),[]).append(n)
for a in n70:
    lon,lat=graph.coords[a]; ix=int(lon/cell); iy=int(lat/cell)
    best90=None
    for x in range(ix-1,ix+2):
        for y in range(iy-1,iy+2):
            for z in grid.get((x,y),()):
                d=b.haversine(graph.coords[a],graph.coords[z])
                if d<=150 and (best90 is None or d<best90[0]): best90=(d,z)
    if not best90: continue
    p70=b.ber_v7_filtered_route(graph,nancy_anchor[1],a,('070000',))
    if not p70: continue
    plen=route_len(p70)
    if plen<=40000:
        cands.append((plen+best90[0],best90[0],a,best90[1],p70))
if not cands:
    raise SystemExit('ERREUR : aucune jonction 070000/090000 atteignable depuis Nancy')
cands.sort(key=lambda x:x[0])
_,gap70,a70,a90,p70=cands[0]

p90=b.ber_v7_filtered_route(graph,a90,c['j_90'],('090000',))
if not p90:
    p90=b.ber_v7_filtered_route(graph,c['j_90'],a90,('090000',))
    if p90: p90=list(reversed(p90))
if not p90:
    raise SystemExit('ERREUR : impossible de parcourir 090000 jusqu’au raccord Pagny')

req_rev=list(reversed(c['req_path'])) # côté classique -> côté LGV

# Assemble des coordonnées Nancy -> 070000 -> 090000 -> 005341 -> 005000.
def append_coords(out, coords):
    for q in coords:
        q=[float(q[0]),float(q[1])]
        if not out or b.haversine(tuple(out[-1]),tuple(q))>0.05: out.append(q)

axis=[]
append_coords(axis,[nancy])
append_coords(axis,[graph.coords[nancy_anchor[1]]])
append_coords(axis,[graph.coords[n] for n in p70])
append_coords(axis,[graph.coords[a90]])
append_coords(axis,[graph.coords[n] for n in p90])
append_coords(axis,[graph.coords[c['req_classic']]])
append_coords(axis,[graph.coords[n] for n in req_rev])
append_coords(axis,[graph.coords[c['j_lgv']]])
axis_len=sum(b.haversine(tuple(axis[i-1]),tuple(axis[i])) for i in range(1,len(axis)))
if not (20000 <= axis_len <= 90000):
    raise SystemExit(f'ERREUR : longueur axe Nancy/Pagny anormale: {axis_len/1000:.1f} km')

print(f'Nancy -> 070000 : {nancy_anchor[0]:.1f} m')
print(f'jonction 070000/090000 : {gap70:.1f} m')
print(f'jonction 090000/005341 : {b.haversine(graph.coords[c["j_90"]],graph.coords[c["req_classic"]]):.1f} m')
print(f'jonction 005341/005000 : {b.haversine(graph.coords[c["req_lgv"]],graph.coords[c["j_lgv"]]):.1f} m')
print(f'AXE Nancy -> Pagny -> LGV : {axis_len/1000:.2f} km ; {len(axis)} points')

# Trouve un tracé DONNEUR déjà correct sur la carte live : Paris -> Metz/Lux via 005341.
jlgv=graph.coords[c['j_lgv']]
def dist(a,z): return b.haversine((float(a[0]),float(a[1])),(float(z[0]),float(z[1])))
def tgv(t): return str(t.get('category') or '').lower()=='tgv' or 'TGV' in str(t.get('category') or '').upper()

donors=[]
for tid,t in trips.items():
    if not tgv(t): continue
    stops=t.get('stops') or []
    if len(stops)<2 or 'PARIS EST' not in b.norm(str(stops[0].get('name') or '')): continue
    names=' | '.join(b.norm(str(s.get('name') or '')) for s in stops)
    if not any(x in names for x in ('METZ','THIONVILLE','LUXEMBOURG')): continue
    pid=t.get('pathId'); p=paths.get(pid) or {}; coords=p.get('coordinates') or []
    if len(coords)<10: continue
    meta_ok=(key(p.get('requiredConnector'))==key('005341') or '005341' in [str(x).zfill(6) for x in (p.get('canonicalLines') or [])] or 'PAGNY' in str(p.get('pathSource') or '').upper())
    if not meta_ok: continue
    ds=[dist(q,jlgv) for q in coords]
    idx=min(range(len(ds)),key=ds.__getitem__)
    if ds[idx] <= 1500:
        donors.append((ds[idx],tid,pid,idx,coords,stops,p))
if not donors:
    raise SystemExit('ERREUR : aucun TGV donneur Paris -> Metz/Lux déjà correct trouvé')
donors.sort(key=lambda x:x[0])
donor=donors[0]
_,donor_tid,donor_pid,donor_idx,donor_coords,donor_stops,donor_path=donor
west=[list(map(float,q[:2])) for q in donor_coords[:donor_idx+1]]
if dist(west[-1],jlgv)>1500:
    raise SystemExit('ERREUR : donneur trop loin du point LGV de Pagny')

# Remplace le dernier point donneur par la jonction RFN canonique pour éviter un petit zig-zag.
west[-1]=[float(jlgv[0]),float(jlgv[1])]
axis_rev=list(reversed(axis)) # LGV -> Nancy
base=[]; append_coords(base,west); append_coords(base,axis_rev)
base_len=sum(b.haversine(tuple(base[i-1]),tuple(base[i])) for i in range(1,len(base)))
if not (250000 <= base_len <= 500000):
    raise SystemExit(f'ERREUR : Paris -> Nancy assemblé anormal: {base_len/1000:.1f} km')
print(f'DONNEUR : train {donor_stops[0].get("name")} -> {donor_stops[-1].get("name")} · trip {donor_tid} · path {donor_pid}')
print(f'Paris -> jonction LGV donneur : {len(west)} points')
print(f'Paris -> Nancy assemblé : {base_len/1000:.2f} km')

# Outils métriques indépendants pour recalculer cumulative + stopOffsets.
R=6371000.0
def hav(a,z):
    lon1,lat1=map(math.radians,a); lon2,lat2=map(math.radians,z)
    h=math.sin((lat2-lat1)/2)**2+math.cos(lat1)*math.cos(lat2)*math.sin((lon2-lon1)/2)**2
    return 2*R*math.asin(min(1,math.sqrt(h)))

def cumulative(coords):
    out=[0.0]
    for i in range(1,len(coords)): out.append(out[-1]+hav(coords[i-1],coords[i]))
    return out

def project_offset(coords,cum,p,minimum=0.0):
    lon0,lat0=p; latr=math.radians(lat0); coslat=max(.2,math.cos(latr))
    best=None
    for i in range(len(coords)-1):
        if cum[i+1] < minimum-500: continue
        a=coords[i]; z=coords[i+1]
        ax=(a[0]-lon0)*111320*coslat; ay=(a[1]-lat0)*110540
        bx=(z[0]-lon0)*111320*coslat; by=(z[1]-lat0)*110540
        vx=bx-ax; vy=by-ay; den=vx*vx+vy*vy
        t=0.0 if den<=1e-9 else max(0.0,min(1.0,- (ax*vx+ay*vy)/den))
        qx=ax+t*vx; qy=ay+t*vy; d=(qx*qx+qy*qy)**.5
        off=cum[i]+t*(cum[i+1]-cum[i])
        if off+100 < minimum: continue
        item=(d,off)
        if best is None or item<best: best=item
    if best is None: return minimum
    return max(minimum,best[1])

def nearest_index(coords,p):
    return min(range(len(coords)),key=lambda i: hav(coords[i],p))

def dedupe(coords):
    out=[]
    for q in coords:
        q=[float(q[0]),float(q[1])]
        if not out or hav(out[-1],q)>.05: out.append(q)
    return out

# Corrige tous les TGV dont la desserte contient Paris Est ET Nancy.
changed=0; numbers=set(); cache={}; reports=[]
for tid,t in trips.items():
    if not tgv(t): continue
    stops=t.get('stops') or []
    names=[b.norm(str(s.get('name') or '')) for s in stops]
    try: ip=next(i for i,n in enumerate(names) if 'PARIS EST' in n)
    except StopIteration: continue
    try: inn=next(i for i,n in enumerate(names) if n=='NANCY')
    except StopIteration: continue
    if ip==inn: continue
    old_pid=t.get('pathId'); old=paths.get(old_pid) or {}; oldc=old.get('coordinates') or []
    if len(oldc)<2: continue
    ncoord=(float(stops[inn]['lon']),float(stops[inn]['lat']))
    oldc=[list(map(float,q[:2])) for q in oldc]
    ni=nearest_index(oldc,ncoord)

    if ip==0 and ip<inn:
        # Paris -> Nancy [-> suite éventuelle]
        new=list(base)
        if inn < len(stops)-1:
            append_coords(new,oldc[ni+1:])
        direction='P-N'
    elif ip==len(stops)-1 and inn<ip:
        # [origine sud ->] Nancy -> Paris
        new=[]
        if inn>0: append_coords(new,oldc[:ni+1])
        append_coords(new,list(reversed(base)))
        direction='N-P'
    else:
        # Cas atypique : Paris n'est pas une extrémité, ne rien risquer.
        continue
    new=dedupe(new)
    cum=cumulative(new); length=cum[-1]
    if length<=100000 or length>900000:
        raise SystemExit(f'ERREUR longueur nouveau path {tid}: {length/1000:.1f} km')
    prev=0.0; offsets=[]
    for s in stops:
        sc=(float(s['lon']),float(s['lat']))
        off=project_offset(new,cum,sc,prev)
        offsets.append(off); prev=off
    if offsets[-1] > length+1:
        raise SystemExit(f'ERREUR offsets > longueur pour {tid}')

    sig='BER_NANCY_PAGNY_AXIS_V1|'+direction+'|'+old_pid+'|'+'|'.join(names)
    pid='p-ber-np1-'+hashlib.sha1(sig.encode()).hexdigest()[:16]
    paths[pid]={
      'coordinates':new,
      'cumulative':cum,
      'length':length,
      'stopOffsets':offsets,
      'profile':'tgv',
      'pathSource':'BER_NANCY_PAGNY_AXIS_V1',
      'canonicalAxis':'Nancy-Pagny-LGV',
      'canonicalLines':['070000','090000','005341','005000'],
      'requiredConnector':'005341',
      'donorPathId':donor_pid,
      'donorTripId':donor_tid,
    }
    t['pathId']=pid; t['offsets']=offsets; t['pathSource']='BER_NANCY_PAGNY_AXIS_V1'
    changed+=1; numbers.add(str(t.get('number') or '')); reports.append((tid,str(t.get('number') or ''),old_pid,pid,length))

if changed<1:
    raise SystemExit('ERREUR : aucun TGV Paris/Nancy corrigé')
print(f'TGV corrigés: {changed} ; numéros distincts: {len(numbers)}')
print('numéros:',', '.join(sorted(x for x in numbers if x)[:80]))
for r in reports[:20]: print(' - trip=%s train=%s %s -> %s %.1f km' % (r[0],r[1],r[2],r[3],r[4]/1000))

json.dump(trips,open(out_trips,'w',encoding='utf-8'),ensure_ascii=False,separators=(',',':'))
json.dump(paths,open(out_paths,'w',encoding='utf-8'),ensure_ascii=False,separators=(',',':'))
axis_geo={
  'type':'FeatureCollection',
  'features':[{
    'type':'Feature',
    'properties':{
      'id':'axis-nancy-pagny-lgv-v1',
      'name':'Nancy → Pagny → LGV Est',
      'pathSource':'BER_NANCY_PAGNY_AXIS_V1',
      'lines':['070000','090000','005341','005000'],
      'length_m':axis_len,
      'note':'Axe canonique. 005341 est le raccord Pagny déjà utilisé par les TGV Metz/Lux → LGV.'
    },
    'geometry':{'type':'LineString','coordinates':axis}
  }]
}
json.dump(axis_geo,open(out_axis,'w',encoding='utf-8'),ensure_ascii=False,indent=2)
PY

python3 -m json.tool "$TMP/trips.json" >/dev/null
python3 -m json.tool "$TMP/paths.json" >/dev/null
python3 -m json.tool "$TMP/axis.geojson" >/dev/null

# Prévisualisation / contrôle avant installation.
echo
echo "=== CONTRÔLE DES PATHS CRÉÉS ==="
python3 - "$TMP/trips.json" "$TMP/paths.json" <<'PY'
import json,sys
trips=json.load(open(sys.argv[1],encoding='utf-8')); paths=json.load(open(sys.argv[2],encoding='utf-8'))
rows=[t for t in trips.values() if t.get('pathSource')=='BER_NANCY_PAGNY_AXIS_V1']
assert rows, 'aucun trip BER_NANCY_PAGNY_AXIS_V1'
ids={t['pathId'] for t in rows}
for pid in ids:
    p=paths[pid]
    assert p.get('requiredConnector')=='005341',pid
    assert p.get('canonicalLines')==['070000','090000','005341','005000'],pid
    assert 100000 < p.get('length',0) < 900000,pid
print(f'OK: {len(rows)} trips ; {len(ids)} paths uniques ; raccord 005341 imposé')
PY

# Ajoute au route editor : couche détaillée OpenRailwayMap + axe canonique, sans toucher au moteur d'édition.
python3 - "$EDITOR" "$TMP/editor.html" <<'PY'
from pathlib import Path
import sys
src=Path(sys.argv[1]).read_text(encoding='utf-8')
marker='MOORAIL_NANCY_PAGNY_AXIS_LAYER_V1'
if marker in src:
    Path(sys.argv[2]).write_text(src,encoding='utf-8'); print('éditeur déjà équipé axe/détail'); raise SystemExit(0)
insert=r'''
<script>
// MOORAIL_NANCY_PAGNY_AXIS_LAYER_V1
(()=>{
  try{
    const orm=L.tileLayer('https://{s}.tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png',{
      maxZoom:19,opacity:.82,attribution:'© OpenStreetMap contributors · OpenRailwayMap'
    });
    let axisLayer=null;
    fetch('/map-v2/data/moorail-axis-nancy-pagny-lgv-v1.geojson?'+Date.now())
      .then(r=>r.json()).then(g=>{
        axisLayer=L.geoJSON(g,{style:{color:'#53ff9d',weight:7,opacity:.95,dashArray:'10 6'}});
        axisLayer.bindTooltip('AXE CANONIQUE · Nancy → Pagny → LGV Est · RFN 070000 → 090000 → 005341 → 005000',{sticky:true});
        const overlays={'Voies détaillées · OpenRailwayMap':orm,'AXE Nancy → Pagny → LGV':axisLayer};
        L.control.layers({},overlays,{position:'topright',collapsed:true}).addTo(map);
        axisLayer.addTo(map);
      }).catch(err=>console.warn('axe Nancy/Pagny indisponible',err));
  }catch(err){console.warn('couche détaillée indisponible',err)}
})();
</script>
'''
if '</body>' not in src: raise SystemExit('ERREUR: </body> introuvable dans éditeur')
src=src.replace('</body>',insert+'\n</body>',1)
Path(sys.argv[2]).write_text(src,encoding='utf-8')
print('éditeur: couche détaillée + axe Nancy/Pagny ajoutés')
PY

# Installation atomique des données + axe + éditeur.
install -o root -g root -m 0644 "$TMP/trips.json" "$TRIPS"
install -o root -g root -m 0644 "$TMP/paths.json" "$PATHS"
install -o root -g root -m 0644 "$TMP/axis.geojson" "$AXIS_PUBLIC"
install -o root -g root -m 0644 "$TMP/editor.html" "$EDITOR"

RESTARTED=1
systemctl restart "$SERVICE"
READY=0
for i in $(seq 1 30); do
  if systemctl is-active --quiet "$SERVICE" && curl -fsS --max-time 2 http://127.0.0.1:3111/api/map-v2/health >"$TMP/health.json" 2>/dev/null; then
    READY=1; echo "Service prêt après ${i}s"; break
  fi
  sleep 1
done
[[ "$READY" == "1" ]] || { echo "ERREUR : service Map V2 non prêt après 30 s" >&2; exit 20; }
python3 - "$TMP/health.json" <<'PY'
import json,sys
d=json.load(open(sys.argv[1],encoding='utf-8')); assert d.get('ok') is True,d
print('Map V2 health:',d)
PY

curl -fsS --max-time 5 "http://127.0.0.1:3111/moorail-route-editor.html?t=$(date +%s)" -o "$TMP/served.html"
grep -q 'MOORAIL_NANCY_PAGNY_AXIS_LAYER_V1' "$TMP/served.html"
curl -fsS --max-time 5 "http://127.0.0.1:3111/data/moorail-axis-nancy-pagny-lgv-v1.geojson?t=$(date +%s)" -o "$TMP/served-axis.json"
python3 -m json.tool "$TMP/served-axis.json" >/dev/null

SUCCESS=1

echo
echo "============================================================"
echo " NANCY -> PAGNY -> LGV EST : INSTALLE"
echo "============================================================"
echo "Raccord utilisé : RFN 005341 (même raccord Pagny que Metz/Lux -> LGV)"
echo "Axe côté Nancy  : 070000 -> 090000 -> 005341 -> 005000"
echo "GeoJSON         : /map-v2/data/moorail-axis-nancy-pagny-lgv-v1.geojson"
echo "Editor          : https://vps.labetaillere.fr/map-v2/moorail-route-editor.html"
echo "Carte détaillée : menu couches -> Voies détaillées · OpenRailwayMap"
echo "Backup          : $BACKUP"
echo

echo "Les TGV contenant Paris Est + Nancy utilisent maintenant cet axe canonique."
