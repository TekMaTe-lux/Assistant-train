#!/usr/bin/env bash
set -euo pipefail

ROOT="/opt/labetaillere-map-v2-src/map-v2"
SERVER="$ROOT/server/server.mjs"
BUILDER="$ROOT/scripts/build_dataset.py"
DATA="$ROOT/data/generated"
TRIPS="$DATA/trips.json"
PATHS="$DATA/paths.json"
SNCF_GTFS="/var/www/html/gtfs/static"
NUMBER="${1:-2870}"

printf '\n============================================================\n'
printf 'AUDIT TGV PARIS ↔ LUXEMBOURG — TRAIN %s\n' "$NUMBER"
printf 'AUCUNE MODIFICATION\n'
printf '============================================================\n'

printf '\n=== 1. TRAJET GTFS SNCF DU %s ===\n' "$NUMBER"
python3 - "$SNCF_GTFS" "$NUMBER" <<'PY'
import csv,re,sys
from pathlib import Path
root=Path(sys.argv[1]); wanted=re.sub(r'\D','',sys.argv[2])

def n(v):
    m=re.findall(r'\d{3,6}',str(v or ''))
    return m[0].lstrip('0') if m else ''

tr=[]
with (root/'trips.txt').open(encoding='utf-8-sig',newline='') as f:
    for r in csv.DictReader(f):
        if n(r.get('trip_short_name'))==n(wanted): tr.append(r)
print('trips candidats:',len(tr))
for r in tr[:20]:
    print({k:r.get(k) for k in ('route_id','service_id','trip_id','trip_headsign','trip_short_name','direction_id','shape_id')})
ids={r.get('trip_id') for r in tr}
stops={}
with (root/'stops.txt').open(encoding='utf-8-sig',newline='') as f:
    for r in csv.DictReader(f): stops[r.get('stop_id')]=r
rows={i:[] for i in ids}
with (root/'stop_times.txt').open(encoding='utf-8-sig',newline='') as f:
    for r in csv.DictReader(f):
        if r.get('trip_id') in rows:
            try:q=int(r.get('stop_sequence') or 0)
            except:q=0
            rows[r.get('trip_id')].append((q,r))
for tid,seq in rows.items():
    print('\nTRIP',tid)
    for q,r in sorted(seq):
        s=stops.get(r.get('stop_id'),{})
        print(f" {q:3d} | {s.get('stop_name')} | {r.get('arrival_time')} -> {r.get('departure_time')} | {s.get('stop_lat')},{s.get('stop_lon')}")
PY

printf '\n=== 2. REPERE OFFICIEL PAGNY-SUR-MOSELLE / VANDIERES ===\n'
python3 - "$SNCF_GTFS" <<'PY'
import csv,sys,unicodedata,re
from pathlib import Path
p=Path(sys.argv[1])/'stops.txt'
def norm(s):
    s=unicodedata.normalize('NFKD',str(s or ''))
    return ''.join(c for c in s if not unicodedata.combining(c)).lower()
with p.open(encoding='utf-8-sig',newline='') as f:
    for r in csv.DictReader(f):
        n=norm(r.get('stop_name'))
        if 'pagny-sur-moselle' in n or 'vandieres' in n:
            print({k:r.get(k) for k in ('stop_id','stop_name','stop_lat','stop_lon','parent_station','location_type')})
PY

printf '\n=== 3. API MATCH-PATH ACTUELLE POUR LUXEMBOURG|THIONVILLE|METZ|PARIS EST ===\n'
URL="http://127.0.0.1:3111/api/map-v2/match-path?stops=Luxembourg%7CThionville%7CMetz%7CParis%20Est&profile=tgv&number=${NUMBER}"
set +e
curl -sS "$URL" -o /tmp/lb-tgv-match-path.json
RC=$?
set -e
if [[ $RC -ne 0 ]]; then
  echo "curl API échoué: $RC"
else
python3 - /tmp/lb-tgv-match-path.json <<'PY'
import json,sys,math
obj=json.load(open(sys.argv[1],encoding='utf-8'))
print('keys:',list(obj)[:20])
p=obj.get('path') or {}
print('path metadata:',{k:p.get(k) for k in p if k!='geometry'})
coords=((p.get('geometry') or {}).get('coordinates') or [])
print('coordonnées:',len(coords))
if coords:
    print('début:',coords[:3])
    print('fin  :',coords[-3:])
    lons=[c[0] for c in coords if len(c)>=2]; lats=[c[1] for c in coords if len(c)>=2]
    print('bbox:',min(lons),min(lats),max(lons),max(lats))

    # repères approximatifs uniquement pour quantifier le détour ; la vraie
    # correction sera basée sur les raccordements RFN présents sur le VPS.
    refs={
      'Pagny-sur-Moselle':(48.983,6.020),
      'Vandieres':(48.954,6.037),
      'Nancy':(48.689,6.174),
      'Baudrecourt':(48.971,6.442),
      'Lucy':(48.983,6.474),
    }
    R=6371000
    def dist(a,b):
      lon1,lat1=a; lat2,lon2=b
      p1=math.radians(lat1); p2=math.radians(lat2); dphi=math.radians(lat2-lat1); dl=math.radians(lon2-lon1)
      x=math.sin(dphi/2)**2+math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
      return 2*R*math.asin(min(1,math.sqrt(x)))
    for name,(lat,lon) in refs.items():
      best=min((dist(c,(lat,lon)),i,c) for i,c in enumerate(coords) if len(c)>=2)
      print(f'plus proche {name}: {best[0]/1000:.2f} km @ index {best[1]} {best[2]}')
PY
fi

printf '\n=== 4. ENTREES 2870 DANS data/generated ===\n'
python3 - "$TRIPS" "$PATHS" "$NUMBER" <<'PY'
import json,re,sys,math
trips=json.load(open(sys.argv[1],encoding='utf-8'))
paths=json.load(open(sys.argv[2],encoding='utf-8'))
wanted=re.sub(r'\D','',sys.argv[3])
items=[]
it=trips.items() if isinstance(trips,dict) else []
for k,v in it:
    s=' '.join(str(v.get(x) or '') for x in ('number','displayLabel','trainNumber','trip_short_name'))+' '+str(k)
    nums=re.findall(r'(?<!\d)'+re.escape(wanted)+r'(?!\d)',s)
    if nums: items.append((k,v))
print('trips trouvés:',len(items))
for k,v in items[:30]:
    pid=v.get('pathId') or v.get('path_id')
    print('\n',k,{x:v.get(x) for x in ('number','displayLabel','source','category','pathId','pathSource','origin','destination')})
    p=(paths.get(pid) if isinstance(paths,dict) else None) or {}
    coords=p.get('coordinates') or ((p.get('geometry') or {}).get('coordinates') or [])
    print(' path:',pid,'coords=',len(coords),'source=',p.get('source'),'length=',p.get('length'))
PY

printf '\n=== 5. RACCORDements RFN AUTOUR DE PAGNY/VANDIERES/LUCY ===\n'
python3 - "$ROOT" <<'PY'
import json,sys,math,os,re
from pathlib import Path
root=Path(sys.argv[1])
files=[]
for p in list((root/'data').rglob('*.geojson')) + list((root/'sources').rglob('*.geojson')) if (root/'sources').exists() else []:
    if p.is_file(): files.append(p)
# aussi data/source(s)
for base in (root/'data'/'source', root/'data'/'sources'):
    if base.exists(): files += [p for p in base.rglob('*.geojson') if p.is_file()]
files=list(dict.fromkeys(files))
print('geojson candidats:',len(files))
refs={'Pagny':(6.020,48.983),'Vandieres':(6.037,48.954),'Lucy':(6.474,48.983),'Baudrecourt':(6.442,48.971)}

def itercoords(g):
    if not isinstance(g,dict): return
    c=g.get('coordinates'); t=g.get('type')
    if t=='LineString':
        for x in c or []:
            if isinstance(x,list) and len(x)>=2 and isinstance(x[0],(int,float)): yield x[:2]
    elif t=='MultiLineString':
        for line in c or []:
            for x in line:
                if isinstance(x,list) and len(x)>=2: yield x[:2]

def d2(a,b): return (a[0]-b[0])**2+(a[1]-b[1])**2
for p in files:
    try:o=json.load(open(p,encoding='utf-8'))
    except:continue
    hits=[]
    for f in o.get('features',[]) if isinstance(o,dict) else []:
        props=f.get('properties') or {}
        blob=' '.join(str(x) for x in props.values()).lower()
        coords=list(itercoords(f.get('geometry') or {}))
        if not coords: continue
        near=min((d2(c,r),name,c) for name,r in refs.items() for c in coords)
        named=any(x in blob for x in ('racc','pagny','vandi','lucy','baudrecourt','lgv'))
        if near[0] < 0.015**2 or named:
            hits.append((near,props))
    if hits:
        print('\nFILE',p)
        for near,props in sorted(hits,key=lambda x:x[0][0])[:40]:
            print(' near',near[1],near[2],'ddeg=',round(near[0]**0.5,5),'props=',props)
PY

printf '\n=== 6. CODE SERVEUR match-path ===\n'
python3 - "$SERVER" <<'PY'
from pathlib import Path
import sys,re
p=Path(sys.argv[1]); lines=p.read_text(encoding='utf-8',errors='replace').splitlines()
idx=[i for i,l in enumerate(lines) if 'match-path' in l or 'matchPath' in l or 'match_path' in l]
if not idx:
 print('aucune ancre match-path trouvée')
else:
 ranges=[]
 for i in idx:
  a=max(0,i-80); b=min(len(lines),i+180)
  if ranges and a<=ranges[-1][1]: ranges[-1]=(ranges[-1][0],max(ranges[-1][1],b))
  else:ranges.append((a,b))
 for a,b in ranges:
  print(f'\n--- lignes {a+1}-{b} ---')
  for n in range(a,b): print(f'{n+1:5d} | {lines[n]}')
PY

printf '\n=== 7. CODE BUILDER TGV / LGV / RACCORDements ===\n'
python3 - "$BUILDER" <<'PY'
from pathlib import Path
import sys,re
lines=Path(sys.argv[1]).read_text(encoding='utf-8',errors='replace').splitlines()
idx=[]
for i,l in enumerate(lines):
 if re.search(r'profile.*tgv|lgv|raccord|connector|route_between_coords|nearest_candidates|def route\(',l,re.I): idx.append(i)
r=[]
for i in idx:
 a=max(0,i-18); b=min(len(lines),i+35)
 if r and a<=r[-1][1]+3:r[-1]=(r[-1][0],max(r[-1][1],b))
 else:r.append((a,b))
for a,b in r:
 print(f'\n--- lignes {a+1}-{b} ---')
 for n in range(a,b):print(f'{n+1:5d} | {lines[n]}')
PY

printf '\n============================================================\n'
printf 'FIN AUDIT TGV — AUCUN FICHIER MODIFIE\n'
printf '============================================================\n'
