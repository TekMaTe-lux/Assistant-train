#!/usr/bin/env bash
set -euo pipefail

ROOT="/opt/labetaillere-map-v2-src/map-v2"
PREVIEW="$ROOT/public/carte-core-canonical-v4-preview.html"
MANIFEST="$ROOT/public/data/cfl-rail-shapes/manifest.json"
SHAPES="$ROOT/public/data/cfl-rail-shapes"
TRAIN="${1:-86563}"

printf '\n============================================================\n'
printf 'AUDIT CACHE LIVE CARTE — TRAIN %s\n' "$TRAIN"
printf 'AUCUNE MODIFICATION\n'
printf '============================================================\n'

CACHE=""
for candidate in \
  /var/www/html/gtfs/carte_static_today.json \
  /var/www/gtfs/carte_static_today.json \
  "$ROOT/public/gtfs/carte_static_today.json" \
  "$ROOT/public/carte_static_today.json"
do
  if [[ -f "$candidate" ]]; then
    CACHE="$candidate"
    break
  fi
done

if [[ -z "$CACHE" ]]; then
  CACHE="$(find /var/www /opt -type f -name 'carte_static_today.json' 2>/dev/null | head -n1 || true)"
fi

if [[ -z "$CACHE" || ! -f "$CACHE" ]]; then
  echo "ERREUR: carte_static_today.json introuvable" >&2
  exit 2
fi

printf '\n=== 1. FICHIERS REELLEMENT UTILISES ===\n'
printf 'cache   : %s\n' "$CACHE"
printf '         %s octets · sha256=%s\n' "$(stat -c%s "$CACHE")" "$(sha256sum "$CACHE" | awk '{print $1}')"
printf 'preview : %s\n' "$PREVIEW"
printf '         %s octets · sha256=%s\n' "$(stat -c%s "$PREVIEW")" "$(sha256sum "$PREVIEW" | awk '{print $1}')"
printf 'manifest: %s\n' "$MANIFEST"

printf '\n=== 2. TRAIN %s DANS LE CACHE STATIQUE LIVE ===\n' "$TRAIN"
python3 - "$CACHE" "$MANIFEST" "$TRAIN" <<'PY'
import json,re,sys,unicodedata,os
from collections import Counter

cache_path, manifest_path, wanted = sys.argv[1:4]
payload=json.load(open(cache_path,encoding='utf-8'))
d=payload.get('data') or {}

def as_map(value):
    if isinstance(value,dict): return value
    out={}
    if isinstance(value,list):
        for item in value:
            if isinstance(item,list) and len(item)>=2:
                out[str(item[0])]=item[1]
            elif isinstance(item,dict):
                key=item.get('id') or item.get('key') or item.get('trip_id') or item.get('stop_id')
                if key is not None: out[str(key)]=item
    return out

trips=as_map(d.get('tripsById'))
seqs=as_map(d.get('stopTimesByTrip'))
stops=as_map(d.get('stopsById'))
routes=as_map(d.get('routesById'))

print('payload date       :',payload.get('date'))
print('payload generated  :',payload.get('generatedAt') or payload.get('generated_at'))
print('tripsById          :',len(trips))
print('stopTimesByTrip    :',len(seqs))
print('stopsById          :',len(stops))
print('activeServiceIds   :',len(d.get('activeServiceIds') or []))

for key in ('24331941','24331953','cfl:24331941','cfl:24331953'):
    print(f'clé {key:16}: trip={key in trips} seq={key in seqs}')

def digits(v):
    vals=re.findall(r'\d{3,6}',str(v or ''))
    return sorted(vals,key=lambda x:(-len(x),x))[0].lstrip('0') if vals else ''

def trip_number(tid,t):
    if not isinstance(t,dict): t={}
    for k in ('trip_short_name','number','trainNumber','displayLabel','trip_headsign','block_id'):
        n=digits(t.get(k))
        if n: return n
    return digits(tid)

def stop_name(sid):
    meta=stops.get(str(sid)) or {}
    if isinstance(meta,dict): return meta.get('name') or meta.get('stop_name') or str(sid)
    return str(sid)

def row_stop_id(row):
    if not isinstance(row,dict): return None
    return row.get('stop_id') or row.get('stopId') or row.get('id')

def row_time(row):
    if not isinstance(row,dict): return ''
    return row.get('departure_time') or row.get('departure') or row.get('arrival_time') or row.get('arrival') or ''

matches=[]
for tid,t in trips.items():
    if trip_number(tid,t)==wanted.lstrip('0'):
        matches.append((str(tid),t))

print('\ntrips cache correspondant au numéro',wanted,':',len(matches))
for tid,t in matches:
    print('\nTRIP CACHE',tid)
    if isinstance(t,dict):
        keys=('trip_short_name','number','displayLabel','route_id','service_id','shape_id','trip_headsign','source','_feed','pathId')
        print({k:t.get(k) for k in keys if k in t})
    seq=seqs.get(tid) or []
    print('séquence :',len(seq),'arrêts')
    for i,row in enumerate(seq):
        if not isinstance(row,dict):
            print(f' {i:2d} | RAW {row!r}')
            continue
        sid=row_stop_id(row)
        meta=stops.get(str(sid)) or {}
        print(
            f" {i:2d} | {sid} | {stop_name(sid)} | {row_time(row)} | "
            f"pickup={row.get('pickup_type',row.get('pickupType'))} "
            f"dropoff={row.get('drop_off_type',row.get('dropOffType',row.get('dropoff_type')))} | "
            f"seq={row.get('stop_sequence',row.get('stopSequence'))}"
        )

manifest=json.load(open(manifest_path,encoding='utf-8')) if os.path.exists(manifest_path) else {}
mt=manifest.get('trips') or {}
print('\nmanifest CFL :')
for key in ('24331941','24331953'):
    print(' ',key,'-> shape',mt.get(key))
PY

printf '\n=== 3. POINTS TECHNIQUES PRESENTS DANS LE CACHE LIVE ===\n'
python3 - "$CACHE" <<'PY'
import json,re,sys,unicodedata
from collections import Counter
p=json.load(open(sys.argv[1],encoding='utf-8')); d=p.get('data') or {}

def amap(v):
    if isinstance(v,dict): return v
    out={}
    for x in v or []:
        if isinstance(x,list) and len(x)>=2: out[str(x[0])]=x[1]
    return out
stops=amap(d.get('stopsById')); seqs=amap(d.get('stopTimesByTrip'))

def name(sid):
    m=stops.get(str(sid)) or {}
    return str((m.get('name') or m.get('stop_name') or sid) if isinstance(m,dict) else sid)

def norm(v):
    s=unicodedata.normalize('NFKD',str(v or ''))
    return ''.join(c for c in s if not unicodedata.combining(c)).upper().strip()
rx=re.compile(r'(?:^|[^A-Z0-9])(?:FRONTIERE|FRONTIER|DOUANE|GRENZ)(?:$|[^A-Z0-9])|(?:^|[-\s])GR\.?$')
counts=Counter(); pickup_pass=Counter(); examples=[]
for tid,seq in seqs.items():
    for row in seq or []:
        if not isinstance(row,dict): continue
        sid=row.get('stop_id') or row.get('stopId') or row.get('id')
        nm=name(sid); token=norm(nm)
        pickup=str(row.get('pickup_type',row.get('pickupType','0')))
        drop=str(row.get('drop_off_type',row.get('dropOffType',row.get('dropoff_type','0'))))
        technical=bool(rx.search(token))
        passpoint=pickup=='1' and drop=='1'
        if technical: counts[nm]+=1
        if passpoint: pickup_pass[nm]+=1
        if (technical or passpoint) and len(examples)<50:
            examples.append((tid,nm,pickup,drop))
print('points nommés frontière/douane/grenz/gr. :',sum(counts.values()),'occurrences /',len(counts),'noms')
for k,v in counts.most_common(40): print(f' {v:4d} x {k}')
print('\npickup=1 + dropoff=1 :',sum(pickup_pass.values()),'occurrences /',len(pickup_pass),'noms')
for k,v in pickup_pass.most_common(40): print(f' {v:4d} x {k}')
print('\nexemples trip -> point :')
for x in examples: print(' ',x)
PY

printf '\n=== 4. QUI PRODUIT carte_static_today.json ? ===\n'
grep -RnsF --exclude='*.json' --exclude='*.log' --exclude-dir=node_modules \
  'carte_static_today.json' \
  /opt /usr/local/bin /etc/systemd /etc/cron.d /etc/cron.daily /etc/cron.hourly \
  2>/dev/null | head -n 120 || true

printf '\n--- unités systemd / timers plausibles ---\n'
systemctl list-unit-files --type=service --type=timer 2>/dev/null \
  | grep -Ei 'carte|static|gtfs|map-v2' | head -n 120 || true
printf '\n--- timers actifs ---\n'
systemctl list-timers --all 2>/dev/null \
  | grep -Ei 'carte|static|gtfs|map-v2' | head -n 120 || true

printf '\n=== 5. PREVIEW : VRAIE CHAINE MOUVEMENT / SHAPE CFL ===\n'
python3 - "$PREVIEW" <<'PY'
from pathlib import Path
import re,sys
p=Path(sys.argv[1]); lines=p.read_text(encoding='utf-8',errors='replace').splitlines()
patterns=[
 'async function fetchOfficialCflTripShape',
 'function tripIdForSelectedRoute',
 'function tryLoadCarteStaticCache',
 'function loadGTFS',
 'trainMotionById.set',
 'segmentProgress',
 'pathBetweenStops(',
 'function buildStaticPanelTrainData'
]
seen=[]
for pat in patterns:
    found=[i for i,l in enumerate(lines) if pat in l]
    print(f'\n### {pat} : {len(found)} occurrence(s)')
    for i in found[:5]:
        a=max(0,i-18); b=min(len(lines),i+45)
        key=(a,b)
        if key in seen: continue
        seen.append(key)
        print(f'--- lignes {a+1}-{b} ---')
        for n in range(a,b): print(f'{n+1:5d} | {lines[n]}')
PY

printf '\n=== 6. CONFIRMATION data/generated ===\n'
python3 - "$ROOT/data/generated/trips.json" "$TRAIN" <<'PY'
import json,re,sys,os
p=sys.argv[1]; wanted=sys.argv[2].lstrip('0')
if not os.path.exists(p):
    print('trips.json absent'); raise SystemExit
trips=json.load(open(p,encoding='utf-8'))
found=[]
for tid,t in (trips.items() if isinstance(trips,dict) else []):
    vals=[t.get(k) for k in ('number','displayLabel','trip_short_name','trip_headsign') if isinstance(t,dict)]
    nums=[]
    for v in vals+[tid]: nums += re.findall(r'\d{3,6}',str(v or ''))
    if any((n.lstrip('0') or '0')==wanted for n in nums): found.append((tid,t))
print('trips data/generated pour',wanted,':',len(found))
for tid,t in found[:20]:
    print(' ',tid,{k:t.get(k) for k in ('number','displayLabel','source','pathId','pathSource') if isinstance(t,dict)})
PY

printf '\n============================================================\n'
printf 'FIN AUDIT — AUCUN FICHIER MODIFIE\n'
printf '============================================================\n'
