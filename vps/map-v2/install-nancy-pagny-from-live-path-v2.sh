#!/usr/bin/env bash
set -euo pipefail

ROOT="${MOORAIL_ROOT:-/opt/labetaillere-map-v2-src/map-v2}"
TRIPS="$ROOT/data/generated/trips.json"
PATHS="$ROOT/data/generated/paths.json"
PUBLIC="$ROOT/public"
AXIS="$PUBLIC/data/moorail-axis-nancy-pagny-lgv-v2.geojson"
PREVIEW="$PUBLIC/nancy-pagny-axis-preview.html"
SERVICE="labetaillere-map-v2.service"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$ROOT/backups/nancy-pagny-live-v2-$STAMP"
TMP="$(mktemp -d /tmp/lb-nancy-pagny-live-v2.XXXXXX)"
SUCCESS=0
RESTARTED=0

cleanup(){ rm -rf "$TMP"; }
rollback(){
  if [[ "$SUCCESS" -eq 1 ]]; then return; fi
  echo >&2
  echo "ERREUR : rollback Nancy -> Pagny -> LGV V2..." >&2
  [[ -f "$BACKUP/trips.json" ]] && cp -a "$BACKUP/trips.json" "$TRIPS"
  [[ -f "$BACKUP/paths.json" ]] && cp -a "$BACKUP/paths.json" "$PATHS"
  if [[ -f "$BACKUP/axis.geojson" ]]; then cp -a "$BACKUP/axis.geojson" "$AXIS"; else rm -f "$AXIS"; fi
  if [[ -f "$BACKUP/preview.html" ]]; then cp -a "$BACKUP/preview.html" "$PREVIEW"; else rm -f "$PREVIEW"; fi
  if [[ "$RESTARTED" -eq 1 ]]; then systemctl restart "$SERVICE" >/dev/null 2>&1 || true; fi
}
trap 'rollback; cleanup' EXIT

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  echo "ERREUR : lancer avec sudo/root" >&2
  exit 2
fi
for f in "$TRIPS" "$PATHS"; do
  [[ -f "$f" ]] || { echo "ERREUR : fichier absent: $f" >&2; exit 3; }
done
mkdir -p "$BACKUP" "$PUBLIC/data"
cp -a "$TRIPS" "$BACKUP/trips.json"
cp -a "$PATHS" "$BACKUP/paths.json"
[[ ! -f "$AXIS" ]] || cp -a "$AXIS" "$BACKUP/axis.geojson"
[[ ! -f "$PREVIEW" ]] || cp -a "$PREVIEW" "$BACKUP/preview.html"

echo "============================================================"
echo " MOO RAIL — NANCY -> PAGNY -> LGV — V2 AUTONOME"
echo " Réutilise les géométries déjà correctes de la carte live"
echo " Aucune dépendance au builder Pagny V7"
echo "============================================================"
echo "Backup : $BACKUP"
echo

python3 - "$TRIPS" "$PATHS" "$TMP/trips.json" "$TMP/paths.json" "$TMP/axis.geojson" <<'PY'
import hashlib,json,math,sys,unicodedata
from pathlib import Path

trips_file,paths_file,out_trips,out_paths,out_axis=map(Path,sys.argv[1:])
trips=json.load(open(trips_file,encoding='utf-8'))
paths=json.load(open(paths_file,encoding='utf-8'))

PAGNY=(6.027062006107198,48.980617830259646)
MEUSE=(5.2719,48.9783)  # secteur Meuse TGV, uniquement contrôle de corridor

def norm(s):
    s=unicodedata.normalize('NFKD',str(s or '')).encode('ascii','ignore').decode().upper()
    return ' '.join(s.replace('-', ' ').split())

def hav(a,b):
    R=6371000.0
    lon1,lat1=map(math.radians,a[:2]); lon2,lat2=map(math.radians,b[:2])
    dlon=lon2-lon1; dlat=lat2-lat1
    q=math.sin(dlat/2)**2+math.cos(lat1)*math.cos(lat2)*math.sin(dlon/2)**2
    return 2*R*math.asin(min(1,math.sqrt(q)))

def plen(cc):
    return sum(hav(cc[i-1],cc[i]) for i in range(1,len(cc)))

def metrics(cc):
    c=[0.0]
    for i in range(1,len(cc)): c.append(c[-1]+hav(cc[i-1],cc[i]))
    return c,c[-1]

def valid_coords(pid):
    p=paths.get(pid) or {}; cc=p.get('coordinates') or []
    out=[]
    for x in cc:
        if isinstance(x,(list,tuple)) and len(x)>=2:
            try: out.append([float(x[0]),float(x[1])])
            except: pass
    return out

def stop_coord(s):
    try:return (float(s['lon']),float(s['lat']))
    except:return None

def nearest_idx(cc,p):
    best=(10**30,None)
    for i,c in enumerate(cc):
        d=hav(c,p)
        if d<best[0]: best=(d,i)
    return best[1],best[0]

def segment_between(cc,a,b):
    ia,da=nearest_idx(cc,a); ib,db=nearest_idx(cc,b)
    if ia is None or ib is None:return None,None,None
    seg=cc[ia:ib+1] if ia<=ib else list(reversed(cc[ib:ia+1]))
    return seg,da,db

def trip_names(t): return [str(s.get('name') or '') for s in (t.get('stops') or [])]

def has_name(names,token):
    t=norm(token)
    return any(t in norm(x) for x in names)

def first_stop(t,token):
    tt=norm(token)
    for s in t.get('stops') or []:
        if tt in norm(s.get('name')): return s
    return None

def choose_north_stop(t):
    for token in ('Metz','Thionville','Luxembourg'):
        s=first_stop(t,token)
        if s:return s
    return None

# 1) Référence locale : un parcours déjà plausible Nancy -> Metz/Thionville/Lux.
local=[]
for tid,t in trips.items():
    names=trip_names(t)
    if not has_name(names,'Nancy'): continue
    north=choose_north_stop(t)
    if not north: continue
    ns=first_stop(t,'Nancy'); nc=stop_coord(ns); zc=stop_coord(north)
    if not nc or not zc: continue
    cc=valid_coords(t.get('pathId'))
    if len(cc)<2: continue
    seg,da,dz=segment_between(cc,nc,zc)
    if not seg or da>1800 or dz>3000: continue
    j,dp=nearest_idx(seg,PAGNY)
    if j is None or dp>6000: continue
    part=seg[:j+1]
    L=plen(part)
    if not (20000 <= L <= 65000): continue
    cat=norm(t.get('category'))
    score=dp + abs(L-38000)*0.05 + (5000 if 'TGV' in cat else 0)
    local.append((score,tid,t,part,dp,L))
if not local:
    raise SystemExit('ERREUR : aucun parcours local Nancy -> nord exploitable pour atteindre Pagny')
local.sort(key=lambda x:x[0])
_,local_tid,local_trip,nancy_to_pagny,local_dp,local_len=local[0]

# 2) Référence TGV : Paris -> Metz/Thionville/Lux qui passe déjà correctement par Pagny + LGV Est.
tgv=[]
for tid,t in trips.items():
    names=trip_names(t)
    if not has_name(names,'Paris Est'): continue
    north=choose_north_stop(t)
    if not north: continue
    blob=' '.join([str(t.get('category') or ''),str(t.get('routeName') or ''),str(t.get('number') or '')]).upper()
    if 'TGV' not in blob and 'OUIGO' not in blob: continue
    ps=first_stop(t,'Paris Est'); pc=stop_coord(ps); zc=stop_coord(north)
    if not pc or not zc: continue
    cc=valid_coords(t.get('pathId'))
    if len(cc)<2: continue
    seg,da,dz=segment_between(cc,pc,zc)
    if not seg or da>2500 or dz>4000: continue
    j,dp=nearest_idx(seg,PAGNY)
    if j is None or dp>5000: continue
    west=seg[:j+1]
    L=plen(west)
    if not (250000 <= L <= 430000): continue
    _,dm=nearest_idx(west,MEUSE)
    if dm>15000: continue
    pmeta=paths.get(t.get('pathId')) or {}
    bonus=0
    src=norm(pmeta.get('pathSource') or t.get('pathSource') or '')
    if 'PAGNY' in src or str(pmeta.get('requiredConnector') or '')=='005341': bonus=-20000
    score=dp + dm*0.3 + abs(L-320000)*0.02 + bonus
    tgv.append((score,tid,t,west,dp,dm,L,pmeta))
if not tgv:
    raise SystemExit('ERREUR : aucun TGV Paris -> Metz/Lux déjà correct exploitable autour de Pagny')
tgv.sort(key=lambda x:x[0])
_,tgv_tid,tgv_trip,paris_to_pagny,tgv_dp,tgv_dm,tgv_len,tgv_meta=tgv[0]

# 3) Jointure physique au même secteur de Pagny.
gap=hav(nancy_to_pagny[-1],paris_to_pagny[-1])
if gap>900:
    raise SystemExit(f'ERREUR : références Nancy et TGV ne se rejoignent pas à Pagny (écart {gap:.0f} m)')

paris_to_nancy=list(paris_to_pagny)
if hav(paris_to_nancy[-1],nancy_to_pagny[-1])>2:
    paris_to_nancy.append(nancy_to_pagny[-1])
rev=list(reversed(nancy_to_pagny))
if rev and hav(paris_to_nancy[-1],rev[0])<2: rev=rev[1:]
paris_to_nancy.extend(rev)

axis_len=plen(paris_to_nancy)
_,axis_pagny=nearest_idx(paris_to_nancy,PAGNY)
_,axis_meuse=nearest_idx(paris_to_nancy,MEUSE)
if not (280000 <= axis_len <= 430000):
    raise SystemExit(f'ERREUR : axe Paris-Nancy longueur anormale {axis_len/1000:.1f} km')
if axis_pagny>2500 or axis_meuse>15000:
    raise SystemExit(f'ERREUR : axe final ne passe pas correctement Pagny/Meuse ({axis_pagny:.0f}m/{axis_meuse:.0f}m)')

print('REFERENCE LOCALE :')
print(' trip=',local_tid,' train=',local_trip.get('number'),' pathId=',local_trip.get('pathId'))
print(f' Nancy -> Pagny = {local_len/1000:.2f} km ; proximité raccord={local_dp:.0f} m')
print('REFERENCE TGV :')
print(' trip=',tgv_tid,' train=',tgv_trip.get('number'),' pathId=',tgv_trip.get('pathId'))
print(' pathSource=',tgv_meta.get('pathSource') or tgv_trip.get('pathSource'))
print(f' Paris -> Pagny = {tgv_len/1000:.2f} km ; raccord={tgv_dp:.0f} m ; Meuse={tgv_dm:.0f} m')
print(f'JOINTURE PAGNY : {gap:.1f} m')
print(f'AXE PARIS -> NANCY : {axis_len/1000:.2f} km')

# projection monotone des arrêts sur une géométrie nouvelle
def project_seg(p,a,b):
    # approximation locale lon/lat suffisante pour choisir le segment puis offset haversine
    lat=math.radians((a[1]+b[1]+p[1])/3)
    sx=math.cos(lat)
    ax=a[0]*sx; ay=a[1]; bx=b[0]*sx; by=b[1]; px=p[0]*sx; py=p[1]
    dx=bx-ax; dy=by-ay; den=dx*dx+dy*dy
    t=0 if den<=0 else max(0,min(1,((px-ax)*dx+(py-ay)*dy)/den))
    q=(a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t)
    return t,hav(p,q)

def stop_offsets(cc,stops):
    cumulative,total=metrics(cc); offsets=[]; start=0
    for s in stops:
        p=stop_coord(s)
        if not p: offsets.append(offsets[-1] if offsets else 0.0); continue
        best=None
        for i in range(start,max(start,len(cc)-1)):
            if i>=len(cc)-1: break
            tt,dd=project_seg(p,cc[i],cc[i+1])
            off=cumulative[i]+hav(cc[i],(cc[i][0]+(cc[i+1][0]-cc[i][0])*tt,cc[i][1]+(cc[i+1][1]-cc[i][1])*tt))
            item=(dd,i,off)
            if best is None or item[0]<best[0]: best=item
        if best is None:
            offsets.append(cumulative[-1]); continue
        offsets.append(best[2]); start=max(start,best[1])
    # force non-decreasing
    for i in range(1,len(offsets)):
        if offsets[i]<offsets[i-1]: offsets[i]=offsets[i-1]
    return cumulative,total,offsets

def orient_full_to_stops(cc,stops):
    if len(stops)<2:return cc
    a=stop_coord(stops[0]); z=stop_coord(stops[-1])
    if not a or not z:return cc
    ia,_=nearest_idx(cc,a); iz,_=nearest_idx(cc,z)
    return cc if ia<=iz else list(reversed(cc))

def splice(cc,stops,pidx,nidx,new_axis):
    cc=orient_full_to_stops(cc,stops)
    pc=stop_coord(stops[pidx]); nc=stop_coord(stops[nidx])
    ip,dp=nearest_idx(cc,pc); inn,dn=nearest_idx(cc,nc)
    if dp>3500 or dn>3500:
        raise RuntimeError(f'ancienne géométrie trop loin Paris/Nancy ({dp:.0f}/{dn:.0f} m)')
    if pidx<nidx:
        if ip>inn: raise RuntimeError('ordre géométrique Paris/Nancy incohérent')
        rep=new_axis
        out=cc[:ip]
        if out and hav(out[-1],rep[0])<2: rep=rep[1:]
        out+=rep
        tail=cc[inn+1:]
        if tail and out and hav(out[-1],tail[0])<2: tail=tail[1:]
        out+=tail
        return out
    else:
        if inn>ip: raise RuntimeError('ordre géométrique Nancy/Paris incohérent')
        rep=list(reversed(new_axis))
        out=cc[:inn]
        if out and hav(out[-1],rep[0])<2: rep=rep[1:]
        out+=rep
        tail=cc[ip+1:]
        if tail and out and hav(out[-1],tail[0])<2: tail=tail[1:]
        out+=tail
        return out

changed=[]; cache={}
for tid,t in trips.items():
    names=trip_names(t)
    if not (has_name(names,'Paris Est') and has_name(names,'Nancy')): continue
    blob=' '.join([str(t.get('category') or ''),str(t.get('routeName') or ''),str(t.get('number') or '')]).upper()
    if 'TGV' not in blob and 'OUIGO' not in blob: continue
    stops=t.get('stops') or []
    pidx=next((i for i,s in enumerate(stops) if 'PARIS EST' in norm(s.get('name'))),None)
    nidx=next((i for i,s in enumerate(stops) if 'NANCY' in norm(s.get('name'))),None)
    if pidx is None or nidx is None: continue
    old=valid_coords(t.get('pathId'))
    if len(old)<2: raise SystemExit(f'ERREUR : path absent pour TGV {tid}')
    sig='BER_NANCY_PAGNY_LIVE_V2|'+'|'.join(norm(s.get('name')) for s in stops)
    if sig in cache:
        pid,offs,length=cache[sig]
    else:
        try:newcc=splice(old,stops,pidx,nidx,paris_to_nancy)
        except Exception as e: raise SystemExit(f'ERREUR TGV {t.get("number") or tid}: {e}')
        cumulative,length,offs=stop_offsets(newcc,stops)
        # contrôles géométriques uniquement sur le segment Paris/Nancy final
        _,dp=nearest_idx(newcc,PAGNY); _,dm=nearest_idx(newcc,MEUSE)
        if dp>3000 or dm>18000:
            raise SystemExit(f'ERREUR TGV {t.get("number")}: nouveau path hors Pagny/Meuse ({dp:.0f}/{dm:.0f}m)')
        pid='p-ber-np2-'+hashlib.sha1(sig.encode()).hexdigest()[:16]
        paths[pid]={
            'coordinates':newcc,'cumulative':cumulative,'length':length,'stopOffsets':offs,
            'profile':'tgv','pathSource':'BER_NANCY_PAGNY_LIVE_V2',
            'canonicalAxis':'Nancy-Pagny-LGV','requiredConnector':'005341',
            'referenceLocalPathId':local_trip.get('pathId'),'referenceTgvPathId':tgv_trip.get('pathId')
        }
        cache[sig]=(pid,offs,length)
    oldpid=t.get('pathId')
    t['pathId']=pid; t['offsets']=offs; t['pathSource']='BER_NANCY_PAGNY_LIVE_V2'
    changed.append((tid,str(t.get('number') or ''),oldpid,pid,length))

if not changed:
    raise SystemExit('ERREUR : aucun TGV contenant Paris Est + Nancy trouvé')

# Au moins un Paris->Nancy direct/variante doit être réparé.
print('\nTGV MODIFIES :',len(changed))
for row in changed[:30]: print(' - train=%s old=%s new=%s longueur=%.1fkm' % (row[1],row[2],row[3],row[4]/1000))

# GeoJSON de contrôle : 3 couches conceptuelles.
features=[
 {'type':'Feature','properties':{'name':'Nancy -> Pagny','part':'nancy-pagny','referenceTrain':str(local_trip.get('number') or '')},'geometry':{'type':'LineString','coordinates':nancy_to_pagny}},
 {'type':'Feature','properties':{'name':'Paris -> Pagny via LGV Est','part':'paris-pagny','referenceTrain':str(tgv_trip.get('number') or '')},'geometry':{'type':'LineString','coordinates':paris_to_pagny}},
 {'type':'Feature','properties':{'name':'Paris -> Nancy composite','part':'composite','pathSource':'BER_NANCY_PAGNY_LIVE_V2'},'geometry':{'type':'LineString','coordinates':paris_to_nancy}},
]
json.dump({'type':'FeatureCollection','features':features},open(out_axis,'w',encoding='utf-8'),ensure_ascii=False,indent=2)
json.dump(trips,open(out_trips,'w',encoding='utf-8'),ensure_ascii=False,separators=(',',':'))
json.dump(paths,open(out_paths,'w',encoding='utf-8'),ensure_ascii=False,separators=(',',':'))
PY

python3 -m json.tool "$TMP/trips.json" >/dev/null
python3 -m json.tool "$TMP/paths.json" >/dev/null
python3 -m json.tool "$TMP/axis.geojson" >/dev/null

install -m 0644 "$TMP/trips.json" "$TRIPS"
install -m 0644 "$TMP/paths.json" "$PATHS"
install -m 0644 "$TMP/axis.geojson" "$AXIS"

cat > "$PREVIEW" <<'HTML'
<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Nancy → Pagny → LGV — contrôle</title><link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"><style>html,body,#map{height:100%;margin:0}body{background:#061420;font-family:system-ui}.panel{position:absolute;z-index:1000;top:12px;left:50px;background:#061420e8;color:#eafcff;border:1px solid #19cfe5;border-radius:12px;padding:10px 13px;box-shadow:0 8px 30px #0008}.panel b{color:#70f2ff}.legend{font-size:12px;line-height:1.55}.c1{color:#ffd34e}.c2{color:#65eaff}.c3{color:#ff4b4b}</style></head><body><div id="map"></div><div class="panel"><b>Contrôle axe Nancy → Pagny → LGV</b><div class="legend"><span class="c1">●</span> Nancy → Pagny (tracé local déjà existant)<br><span class="c2">●</span> Paris → Pagny (TGV live déjà correct)<br><span class="c3">●</span> axe composite utilisé pour Paris ↔ Nancy</div></div><script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script><script>
const map=L.map('map').setView([48.96,6.02],11);
const osm=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap contributors'}).addTo(map);
const orm=L.tileLayer('https://tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png',{minZoom:2,maxZoom:19,tileSize:256,opacity:.9,attribution:'Data © OpenStreetMap contributors, Style: CC-BY-SA 2.0 OpenRailwayMap'}).addTo(map);
const layers={};
fetch('/map-v2/data/moorail-axis-nancy-pagny-lgv-v2.geojson?'+Date.now()).then(r=>r.json()).then(g=>{
  const styles={'nancy-pagny':{color:'#ffd34e',weight:6},'paris-pagny':{color:'#65eaff',weight:5},'composite':{color:'#ff4b4b',weight:3,dashArray:'8 7'}};
  for(const f of g.features){const name=f.properties.name;layers[name]=L.geoJSON(f,{style:styles[f.properties.part]||{color:'#fff',weight:4}}).addTo(map)}
  const group=L.featureGroup(Object.values(layers));map.fitBounds(group.getBounds().pad(.08));
  L.control.layers({'OpenStreetMap':osm},{'OpenRailwayMap':orm,...layers},{collapsed:false}).addTo(map);
});
</script></body></html>
HTML

# Redémarrage et contrôles réels.
RESTARTED=1
systemctl restart "$SERVICE"
for _ in $(seq 1 30); do
  if systemctl is-active --quiet "$SERVICE" && curl -fsS --max-time 2 http://127.0.0.1:3111/api/map-v2/health >/dev/null 2>&1; then break; fi
  sleep 1
done
systemctl is-active --quiet "$SERVICE"
curl -fsS --max-time 5 http://127.0.0.1:3111/api/map-v2/health
curl -fsS --max-time 5 http://127.0.0.1:3111/data/moorail-axis-nancy-pagny-lgv-v2.geojson >/dev/null
curl -fsS --max-time 5 http://127.0.0.1:3111/nancy-pagny-axis-preview.html >/dev/null

python3 - "$TRIPS" "$PATHS" <<'PY'
import json,sys
trips=json.load(open(sys.argv[1],encoding='utf-8')); paths=json.load(open(sys.argv[2],encoding='utf-8'))
rows=[t for t in trips.values() if t.get('pathSource')=='BER_NANCY_PAGNY_LIVE_V2']
if not rows: raise SystemExit('aucun TGV V2 après installation')
ids={t.get('pathId') for t in rows}
for pid in ids:
    p=paths.get(pid) or {}
    if p.get('canonicalAxis')!='Nancy-Pagny-LGV' or p.get('requiredConnector')!='005341':
        raise SystemExit(f'métadonnées axe incohérentes: {pid}')
print(f'VALIDATION FINALE : {len(rows)} trips TGV · {len(ids)} paths Nancy-Pagny-LGV')
PY

SUCCESS=1

echo
echo "============================================================"
echo " NANCY -> PAGNY -> LGV EST : INSTALLE — V2"
echo "============================================================"
echo "Méthode : géométrie live existante + splice Pagny, sans builder V7"
echo "Axe     : $AXIS"
echo "Contrôle détaillé : https://vps.labetaillere.fr/map-v2/nancy-pagny-axis-preview.html"
echo "Carte nationale   : https://vps.labetaillere.fr/map-v2/france-v3-preview.html"
echo "Backup             : $BACKUP"
echo
