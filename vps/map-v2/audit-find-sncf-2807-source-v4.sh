#!/usr/bin/env bash
set -euo pipefail

NUMBER="${1:-2807}"
ROOT="/opt/labetaillere-map-v2-src/map-v2"

printf '\n============================================================\n'
printf 'AUDIT SOURCE SNCF/TGV — TRAIN %s — AUCUNE MODIFICATION\n' "$NUMBER"
printf '============================================================\n'

printf '\n=== 1. TOUS LES trips.txt TROUVÉS SUR LE VPS ===\n'
python3 - "$NUMBER" <<'PY'
import csv,os,re,sys
from pathlib import Path
wanted=re.sub(r'\D','',sys.argv[1])
roots=[Path('/var/www/html'),Path('/opt/labetaillere-map-v2-src')]
seen=set(); found=[]
for root in roots:
    if not root.exists(): continue
    for p in root.rglob('trips.txt'):
        try: rp=str(p.resolve())
        except: rp=str(p)
        if rp in seen: continue
        seen.add(rp)
        try:
            with p.open(encoding='utf-8-sig',newline='',errors='replace') as f:
                r=csv.DictReader(f)
                fields=r.fieldnames or []
                count=0; samples=[]
                for row in r:
                    vals=[]
                    for k in ('trip_short_name','trip_id','trip_headsign','route_id'):
                        vals.append(str(row.get(k) or ''))
                    blob=' | '.join(vals)
                    nums=re.findall(r'(?<!\d)'+re.escape(wanted)+r'(?!\d)',blob)
                    if nums:
                        count+=1
                        if len(samples)<5: samples.append({k:row.get(k) for k in ('route_id','service_id','trip_id','trip_headsign','trip_short_name','shape_id')})
                print(f'FILE {p} | fields={fields[:12]} | matches {wanted}={count}')
                for s in samples: print('  ',s)
                if count: found.append((str(p),count))
        except Exception as e:
            print(f'FILE {p} | ERREUR {e}')
print('\nSOURCES AVEC LE TRAIN:',found)
PY

printf '\n=== 2. OÙ LE 2807 EXISTE DANS LE DATASET MAP-V2 ===\n'
python3 - "$ROOT/data/generated/trips.json" "$NUMBER" <<'PY'
import json,re,sys
p,num=sys.argv[1],re.sub(r'\D','',sys.argv[2])
o=json.load(open(p,encoding='utf-8'))
rows=[]
for tid,t in (o.items() if isinstance(o,dict) else []):
    blob=' '.join(str(t.get(k) or '') for k in ('number','displayLabel','trainNumber','trip_short_name','origin','destination'))+' '+tid
    if re.search(r'(?<!\d)'+re.escape(num)+r'(?!\d)',blob):
        rows.append((tid,t))
print('variants dataset:',len(rows))
for tid,t in rows[:20]:
    print('\ntrip=',tid)
    print({k:t.get(k) for k in ('number','category','source','origin','destination','pathId','pathSource')})
    print('stops=',[s.get('name') for s in (t.get('stops') or [])])
PY

printf '\n=== 3. RECHERCHE DES FICHIERS LOCAUX QUI CONTIENNENT LE NUMÉRO ===\n'
python3 - "$NUMBER" <<'PY'
import os,re,sys
from pathlib import Path
wanted=re.sub(r'\D','',sys.argv[1])
roots=[Path('/var/www/html/gtfs'),Path('/opt/labetaillere-map-v2-src/map-v2/data')]
exts={'.txt','.csv','.json','.jsonl','.ndjson'}
for root in roots:
    if not root.exists(): continue
    print('\nROOT',root)
    hits=0
    for p in root.rglob('*'):
        if not p.is_file() or p.suffix.lower() not in exts: continue
        try:
            if p.stat().st_size>250_000_000: continue
            with p.open('r',encoding='utf-8',errors='ignore') as f:
                for i,line in enumerate(f,1):
                    if re.search(r'(?<!\d)'+re.escape(wanted)+r'(?!\d)',line):
                        print(f' HIT {p}:{i}: {line[:500].rstrip()}')
                        hits+=1
                        break
        except Exception:
            pass
    print('hits=',hits)
PY

printf '\n=== 4. INDICES DANS LE BUILDER / SCRIPTS DE GÉNÉRATION ===\n'
grep -RniE 'gtfs|trips\.txt|stop_times\.txt|routes\.txt|generated/trips|build_dataset' \
  "$ROOT/scripts" "$ROOT/server" "$ROOT"/*.sh 2>/dev/null | head -n 300 || true

printf '\n============================================================\n'
printf 'FIN AUDIT SOURCE %s — AUCUNE MODIFICATION\n' "$NUMBER"
printf '============================================================\n'
