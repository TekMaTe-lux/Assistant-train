#!/usr/bin/env bash
set -euo pipefail

ROOT="/opt/labetaillere-map-v2-src/map-v2"
PUBLIC="$ROOT/public"
BUILDER="$ROOT/scripts/build_dataset.py"
PROD="$PUBLIC/carte-core-preview.html"
PREVIEW="$PUBLIC/carte-core-canonical-v4-preview.html"
SNAP="$PUBLIC/v4-preview/data/snapshot.json"
CFL_GTFS="/var/www/html/gtfs/static/CFL"
SNCF_GTFS="/var/www/html/gtfs/static"
TRAIN="${1:-86563}"

printf '\n============================================================\n'
printf 'AUDIT CARTE — CHEMINS + POINTS TECHNIQUES\n'
printf 'Train cible : %s\n' "$TRAIN"
printf '============================================================\n'

for f in "$BUILDER" "$PROD" "$PREVIEW" "$SNAP"; do
  if [[ -f "$f" ]]; then
    printf '%-72s %s\n' "$f" "$(sha256sum "$f" | awk '{print $1}')"
  else
    printf '%-72s ABSENT\n' "$f"
  fi
done

printf '\n=== 1. GTFS CFL — TRAJET EXACT DU TRAIN %s ===\n' "$TRAIN"
python3 - "$CFL_GTFS" "$TRAIN" <<'PY'
import csv,sys,re
from pathlib import Path

root=Path(sys.argv[1]); target=re.sub(r'\D','',sys.argv[2])

def norm(v):
    m=re.findall(r'\d{3,6}',str(v or ''))
    if not m:return ''
    return sorted(m,key=lambda x:(-len(x),x))[0].lstrip('0') or '0'

trips=[]
with (root/'trips.txt').open(encoding='utf-8-sig',newline='') as f:
    for r in csv.DictReader(f):
        if norm(r.get('trip_short_name'))==norm(target):
            trips.append(r)

print('candidats trips.txt :',len(trips))
for t in trips[:20]:
    print(' -', {k:t.get(k) for k in ('route_id','service_id','trip_id','trip_headsign','trip_short_name','direction_id')})

trip_ids={str(t.get('trip_id') or '') for t in trips}
stops={}
with (root/'stops.txt').open(encoding='utf-8-sig',newline='') as f:
    for r in csv.DictReader(f):
        sid=str(r.get('stop_id') or '')
        if sid:
            stops[sid]=r

rows={tid:[] for tid in trip_ids}
with (root/'stop_times.txt').open(encoding='utf-8-sig',newline='') as f:
    for r in csv.DictReader(f):
        tid=str(r.get('trip_id') or '')
        if tid in rows:
            try: seq=int(r.get('stop_sequence') or 0)
            except: seq=0
            rows[tid].append((seq,r))

for tid in sorted(rows):
    print('\nTRIP',tid)
    for seq,r in sorted(rows[tid]):
        s=stops.get(str(r.get('stop_id') or ''),{})
        print(
            f" {seq:3d} | {r.get('stop_id')} | {s.get('stop_name') or '?'} | "
            f"{r.get('arrival_time')} -> {r.get('departure_time')} | "
            f"pickup={r.get('pickup_type')} dropoff={r.get('drop_off_type')} | "
            f"lat={s.get('stop_lat')} lon={s.get('stop_lon')}"
        )
PY

printf '\n=== 2. POINTS FRONTIERE / TECHNIQUES DANS LES GTFS ===\n'
python3 - "$CFL_GTFS" "$SNCF_GTFS" <<'PY'
import csv,sys,re
from pathlib import Path

rx=re.compile(r'fronti|frontier|frontière|border|grenz|grens|douane',re.I)
for label,root in [('CFL',Path(sys.argv[1])),('SNCF',Path(sys.argv[2]))]:
    p=root/'stops.txt'
    print('\n--',label,p)
    if not p.exists():
        print('ABSENT'); continue
    hits=[]
    with p.open(encoding='utf-8-sig',newline='') as f:
        for r in csv.DictReader(f):
            text=' | '.join(str(r.get(k) or '') for k in ('stop_name','stop_id','stop_code','parent_station'))
            if rx.search(text): hits.append(r)
    print('points techniques nommés :',len(hits))
    for r in hits[:100]:
        print(' -', {k:r.get(k) for k in ('stop_id','stop_code','stop_name','parent_station','location_type','stop_lat','stop_lon')})
PY

printf '\n=== 3. V4 — POINTS TECHNIQUES QUI PEUVENT POLLUER UN STATUT ===\n'
python3 - "$SNAP" <<'PY'
import json,sys,re
p=sys.argv[1]
if not __import__('os').path.exists(p):
    print('snapshot absent'); raise SystemExit
s=json.load(open(p,encoding='utf-8'))
rx=re.compile(r'fronti|frontier|frontière|border|grenz|grens|douane',re.I)
hits=[]
for t in s.get('trains') or []:
    for st in t.get('stops') or []:
        if rx.search(str(st.get('name') or '')):
            hits.append((t,st))
print('occurrences techniques V4 :',len(hits))
for t,st in hits[:100]:
    print(
        f" - train={t.get('number')} status={t.get('status')} | {st.get('name')} | "
        f"cancelled={st.get('cancelled')} known={st.get('realtimeKnown')} "
        f"delay={st.get('delayMinutes')} source={(st.get('delay') or {}).get('source')} "
        f"country={st.get('country')} authority={st.get('realtimeAuthority')}"
    )
PY

printf '\n=== 4. BUILD_DATASET — LOGIQUE DE CHEMIN ACTUELLE ===\n'
python3 - "$BUILDER" <<'PY'
import sys,re
from pathlib import Path
p=Path(sys.argv[1])
if not p.exists():
    print('build_dataset.py absent'); raise SystemExit
lines=p.read_text(encoding='utf-8',errors='replace').splitlines()
patterns=[
    r'path_store',r'trip_store',r'shortest',r'dijkstra',r'graph',r'network',
    r'connector',r'raccord',r'segment',r'chemin',r'path',r'nearest',r'snap',r'heurist',r'route'
]
idx=[]
for i,line in enumerate(lines):
    if any(re.search(pat,line,re.I) for pat in patterns): idx.append(i)
# Fusion de fenêtres, assez larges pour comprendre les fonctions sans imprimer tout le fichier.
ranges=[]
for i in idx:
    a=max(0,i-8); b=min(len(lines),i+16)
    if ranges and a <= ranges[-1][1]+4:
        ranges[-1]=(ranges[-1][0],max(ranges[-1][1],b))
    else:
        ranges.append((a,b))
for a,b in ranges:
    print(f'\n--- lignes {a+1}-{b} ---')
    for n in range(a,b):
        print(f'{n+1:5d} | {lines[n]}')
PY

printf '\n=== 5. FICHIERS CARTO QUI REFERENCENT LE TRAIN %s ===\n' "$TRAIN"
python3 - "$PUBLIC" "$TRAIN" <<'PY'
import os,sys,json,re
from pathlib import Path
root=Path(sys.argv[1]); target=sys.argv[2]
files=[]
for p in root.rglob('*'):
    if not p.is_file(): continue
    if p.suffix.lower() not in {'.json','.js','.html','.geojson','.csv','.txt'}: continue
    try:
        size=p.stat().st_size
    except: continue
    # Le grep binaire de très gros fichiers est évité; les fichiers jusqu'à 120 Mo restent auditables.
    if size > 120*1024*1024: continue
    try:
        with p.open('r',encoding='utf-8',errors='ignore') as f:
            found=False
            for line_no,line in enumerate(f,1):
                if target in line:
                    files.append((str(p),line_no,line[:500].rstrip()))
                    found=True
                    if len(files)>=80: break
            if len(files)>=80: break
    except Exception:
        pass
print('matches :',len(files))
for p,n,line in files:
    print(f' - {p}:{n}: {line}')
PY

printf '\n=== 6. FICHIERS DE DONNEES CARTO DISPONIBLES ===\n'
find "$PUBLIC" -maxdepth 4 -type f \
  \( -name '*.json' -o -name '*.geojson' -o -name '*.csv' \) \
  -printf '%s %p\n' 2>/dev/null | sort -n | tail -n 100

printf '\n=== 7. FONCTIONS MOUVEMENT / INTERPOLATION / ROUTAGE DANS LA CARTE ===\n'
python3 - "$PROD" <<'PY'
import sys,re
from pathlib import Path
p=Path(sys.argv[1])
lines=p.read_text(encoding='utf-8',errors='replace').splitlines()
patterns=[
    r'segmentIndex',r'segmentProgress',r'interpol',r'polyline',r'geometry',r'path',
    r'stopTimesByTrip',r'trainMotionById',r'position',r'latLng',r'progress'
]
idx=[]
for i,line in enumerate(lines):
    if any(re.search(pat,line,re.I) for pat in patterns): idx.append(i)
ranges=[]
for i in idx:
    a=max(0,i-7); b=min(len(lines),i+13)
    if ranges and a <= ranges[-1][1]+3:
        ranges[-1]=(ranges[-1][0],max(ranges[-1][1],b))
    else:
        ranges.append((a,b))
# On se limite aux fenêtres les plus pertinentes / taille raisonnable.
printed=0
for a,b in ranges:
    block='\n'.join(lines[a:b])
    if not re.search(r'segmentIndex|segmentProgress|interpol|stopTimesByTrip|trainMotionById|geometry|polyline',block,re.I):
        continue
    print(f'\n--- lignes {a+1}-{b} ---')
    for n in range(a,b): print(f'{n+1:5d} | {lines[n]}')
    printed += (b-a)
    if printed > 900:
        print('\n[sortie tronquée volontairement après ~900 lignes]')
        break
PY

printf '\n=== 8. RECHERCHE DES LIBELLES FRONTIERE DANS LA CARTE/JEUX BUILT ===\n'
grep -RniE --binary-files=without-match \
  'fronti[eè]re|frontier|border|grenz|grens|Rodange.*Athus|Sterpenich' \
  "$PUBLIC" "$ROOT/scripts" \
  --include='*.html' --include='*.js' --include='*.json' --include='*.geojson' --include='*.py' \
  2>/dev/null | head -n 200 || true

printf '\n============================================================\n'
printf 'FIN AUDIT — AUCUN FICHIER MODIFIE\n'
printf '============================================================\n'
