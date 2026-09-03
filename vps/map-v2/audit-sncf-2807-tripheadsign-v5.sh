#!/usr/bin/env bash
set -euo pipefail

NUMBER="${1:-2807}"
DATE="${2:-$(date +%Y%m%d)}"
GTFS="/var/www/html/gtfs/static"
PROXY="https://assistant-train-cx5u.vercel.app/api/train"
TMP="$(mktemp -d /tmp/lb-sncf-2807-v5.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

printf '\n============================================================\n'
printf 'AUDIT SNCF V5 — TGV %s VIA trip_headsign + DEPARTURES NAVITIA\n' "$NUMBER"
printf 'DATE %s — AUCUNE MODIFICATION\n' "$DATE"
printf '============================================================\n'

python3 - "$GTFS" "$NUMBER" "$DATE" "$TMP/context.json" <<'PY'
import csv,sys,re,json,datetime,unicodedata
from pathlib import Path
root=Path(sys.argv[1]); wanted=str(sys.argv[2]); date_s=str(sys.argv[3]); out=Path(sys.argv[4])
date=datetime.datetime.strptime(date_s,'%Y%m%d').date()

def rows(name):
    p=root/name
    if not p.exists(): return []
    with p.open(encoding='utf-8-sig',newline='') as f:return list(csv.DictReader(f))

def norm(s):
    s=unicodedata.normalize('NFKD',str(s or ''))
    return ''.join(c for c in s if not unicodedata.combining(c)).upper()

def train_num(r):
    for k in ('trip_short_name','trip_headsign'):
        v=str(r.get(k) or '').strip()
        if re.fullmatch(r'\d{3,6}',v): return v
    m=re.search(r'OCESN(\d{3,6})F1187',str(r.get('trip_id') or ''))
    return m.group(1) if m else ''

trips=[r for r in rows('trips.txt') if train_num(r)==wanted]
print('=== 1. TRIPS GTFS MATCHÉS PAR trip_headsign / trip_id ===')
print('trips candidats:',len(trips))
for r in trips:
    print({k:r.get(k) for k in ('route_id','service_id','trip_id','trip_headsign','trip_short_name','shape_id')})
if not trips: raise SystemExit('aucun 2807 dans trips.txt')

cal={r.get('service_id'):r for r in rows('calendar.txt')}
exc={}
for r in rows('calendar_dates.txt'):
    if r.get('date')==date_s:
        exc[r.get('service_id')]=r.get('exception_type')
weekday=['monday','tuesday','wednesday','thursday','friday','saturday','sunday'][date.weekday()]

def active(sid):
    if exc.get(sid)=='1': return True
    if exc.get(sid)=='2': return False
    r=cal.get(sid)
    if not r:return False
    try:
        if not (r.get('start_date','')<=date_s<=r.get('end_date','')):return False
    except:return False
    return str(r.get(weekday) or '0')=='1'

active_trips=[r for r in trips if active(r.get('service_id'))]
print('\n=== 2. SERVICE ACTIF LE',date_s,'===')
print('trips actifs:',len(active_trips))
for r in active_trips: print(r.get('service_id'),r.get('trip_id'))
selected=active_trips or trips
if not active_trips:
    print('INFO: aucune variante active détectée à cette date dans calendar/calendar_dates ; audit poursuivi sur les variantes disponibles.')

stops={r.get('stop_id'):r for r in rows('stops.txt')}
by_trip={r.get('trip_id'):[] for r in selected}
for r in rows('stop_times.txt'):
    if r.get('trip_id') in by_trip:
        try:q=int(r.get('stop_sequence') or 0)
        except:q=0
        by_trip[r.get('trip_id')].append((q,r))

best=None
print('\n=== 3. SÉQUENCES D ARRÊTS DES VARIANTES ===')
for tr in selected:
    tid=tr.get('trip_id'); seq=sorted(by_trip.get(tid) or [])
    names=[]
    for q,r in seq:
        s=stops.get(r.get('stop_id'),{})
        name=s.get('stop_name') or r.get('stop_id')
        names.append(name)
    print('\nTRIP',tid,'\n ',names)
    if any('CHAMPAGNE' in norm(x) for x in names) and any(norm(x)=='METZ' or 'METZ' in norm(x) for x in names):
        if best is None: best=(tr,seq)

if best is None:
    print('Aucune variante Champagne-Ardenne -> Metz trouvée parmi les variantes sélectionnées.')
    # cherche sur toutes les variantes 2807, indépendamment du calendrier
    ids={r.get('trip_id') for r in trips}
    allseq={i:[] for i in ids}
    for r in rows('stop_times.txt'):
        if r.get('trip_id') in allseq:
            try:q=int(r.get('stop_sequence') or 0)
            except:q=0
            allseq[r.get('trip_id')].append((q,r))
    for tr in trips:
        seq=sorted(allseq.get(tr.get('trip_id')) or [])
        names=[(stops.get(r.get('stop_id'),{}) or {}).get('stop_name') or r.get('stop_id') for _,r in seq]
        if any('CHAMPAGNE' in norm(x) for x in names) and any('METZ' in norm(x) for x in names):
            best=(tr,seq); print('Fallback variante retenue:',tr.get('trip_id')); break
if best is None: raise SystemExit('aucune variante 2807 Champagne/Metz trouvée')

tr,seq=best
ctx={'trip_id':tr.get('trip_id'),'service_id':tr.get('service_id'),'number':wanted,'date':date_s}
for q,r in seq:
    s=stops.get(r.get('stop_id'),{})
    name=s.get('stop_name') or ''
    print(f" {q:3d} | {name} | {r.get('arrival_time')} -> {r.get('departure_time')} | stop_id={r.get('stop_id')} parent={s.get('parent_station')}")
    n=norm(name)
    if 'CHAMPAGNE' in n:
        ctx['champagne_name']=name; ctx['champagne_stop_id']=r.get('stop_id'); ctx['champagne_parent']=s.get('parent_station'); ctx['champagne_time']=r.get('departure_time') or r.get('arrival_time')
    if n=='METZ' or 'METZ' in n:
        ctx['metz_name']=name; ctx['metz_stop_id']=r.get('stop_id'); ctx['metz_parent']=s.get('parent_station')

def uic(*vals):
    for v in vals:
        m=re.findall(r'(?<!\d)(8\d{7})(?!\d)',str(v or ''))
        if m:return m[-1]
    for v in vals:
        m=re.findall(r'(\d{8})',str(v or ''))
        if m:return m[-1]
    return ''
ctx['champagne_uic']=uic(ctx.get('champagne_stop_id'),ctx.get('champagne_parent'))
ctx['metz_uic']=uic(ctx.get('metz_stop_id'),ctx.get('metz_parent'))
print('\nContexte retenu:',json.dumps(ctx,ensure_ascii=False,indent=2))
json.dump(ctx,out.open('w',encoding='utf-8'),ensure_ascii=False)
PY

printf '\n=== 4. DÉPARTS NAVITIA DE CHAMPAGNE-ARDENNE AUTOUR DU 2807 ===\n'
python3 - "$TMP/context.json" "$TMP/query.env" <<'PY'
import json,sys,re,datetime
c=json.load(open(sys.argv[1],encoding='utf-8'))
uic=c.get('champagne_uic') or ''
if not uic: raise SystemExit('UIC Champagne-Ardenne introuvable')
raw=str(c.get('champagne_time') or '00:00:00')
parts=[int(x or 0) for x in raw.split(':')[:3]]
while len(parts)<3:parts.append(0)
d=datetime.datetime.strptime(c['date'],'%Y%m%d')+datetime.timedelta(hours=parts[0],minutes=parts[1],seconds=parts[2])-datetime.timedelta(minutes=30)
navdt=d.strftime('%Y%m%dT%H%M%S')
open(sys.argv[2],'w').write(f"CHAMP=stop_area:SNCF:{uic}\nMETZ=stop_area:SNCF:{c.get('metz_uic','')}\nNAVDT={navdt}\n")
print('Champagne stop_area =',f'stop_area:SNCF:{uic}')
print('Metz stop_area      =',f"stop_area:SNCF:{c.get('metz_uic','')}")
print('datetime départs    =',navdt)
PY
source "$TMP/query.env"
REL="stop_areas/${CHAMP}/departures?datetime=${NAVDT}&duration=7200&count=200&depth=3&data_freshness=base_schedule"
set +e
curl -sS --get "$PROXY" --data-urlencode "url=$REL" -o "$TMP/departures.json"
RC=$?
set -e
if [[ $RC -ne 0 ]]; then echo "curl departures échoué: $RC"; exit $RC; fi
python3 - "$TMP/departures.json" "$NUMBER" "$TMP/vj.txt" <<'PY'
import json,sys,re
obj=json.load(open(sys.argv[1],encoding='utf-8')); wanted=str(sys.argv[2]); out=sys.argv[3]
print('top keys:',list(obj)[:30])
deps=obj.get('departures') or []
print('departures:',len(deps))

def blob(x):
    vals=[]
    def rec(v):
        if isinstance(v,dict):
            for k,z in v.items():
                if k in ('code','label','headsign','name','id','value','type'): vals.append(str(z or ''))
                rec(z)
        elif isinstance(v,list):
            for z in v:rec(z)
    rec(x); return ' '.join(vals)

matches=[]; vjids=[]
for d in deps:
    di=d.get('display_informations') or {}
    dt=d.get('stop_date_time') or {}
    code=str(di.get('code') or di.get('label') or '')
    if code==wanted or re.search(r'(?<!\d)'+re.escape(wanted)+r'(?!\d)',blob(d)):
        matches.append(d)
        print('\nMATCH 2807:',{k:di.get(k) for k in ('code','label','headsign','direction','name')},'dep=',dt.get('departure_date_time'))
        # cherche tout id vehicle_journey dans l'objet
        def rec(v):
            if isinstance(v,dict):
                for k,z in v.items():
                    if isinstance(z,str) and 'vehicle_journey' in z.lower(): vjids.append(z)
                    rec(z)
            elif isinstance(v,list):
                for z in v:rec(z)
        rec(d)
print('\nmatchs numéro:',len(matches))
# normalise les IDs potentiels
clean=[]
for x in vjids:
    if x.startswith('vehicle_journey:'): clean.append(x)
    elif 'vehicle_journeys/' in x: clean.append(x.split('vehicle_journeys/',1)[1])
clean=list(dict.fromkeys(clean))
print('vehicle_journey IDs trouvés:',clean[:20])
if clean:
    open(out,'w').write(clean[0])
else:
    open(out,'w').write('')
    if not matches:
        print('Aucun départ 2807 trouvé dans la fenêtre ; réponse brute tronquée:')
        print(json.dumps(obj,ensure_ascii=False)[:4000])
PY

VJID="$(cat "$TMP/vj.txt")"
if [[ -n "$VJID" ]]; then
  printf '\n=== 5. VRAI VEHICLE_JOURNEY DÉCOUVERT DEPUIS departures ===\n'
  echo "VJID=$VJID"
  set +e
  curl -sS --get "$PROXY" --data-urlencode "url=vehicle_journeys/${VJID}" -o "$TMP/vj.json"
  RC=$?
  set -e
  echo "curl rc=$RC"
  python3 - "$TMP/vj.json" <<'PY'
import json,sys
obj=json.load(open(sys.argv[1],encoding='utf-8'))
print('top keys:',list(obj)[:30])
rows=obj.get('vehicle_journeys') or []
print('vehicle_journeys:',len(rows))
if rows:
 v=rows[0]
 print('id=',v.get('id'),'name=',v.get('name'),'headsign=',v.get('headsign'))
 for key in ('geojson','shape'):
  g=v.get(key)
  if isinstance(g,dict) and g.get('coordinates'): print('GEOJSON DIRECT',key,'type=',g.get('type'))
else:
 print(json.dumps(obj,ensure_ascii=False)[:3000])
PY
else
  printf '\n=== 5. AUCUN VEHICLE_JOURNEY IDENTIFIABLE DANS departures ===\n'
fi

printf '\n=== 6. JOURNEY CHAMPAGNE -> METZ ET GEOJSON DES SECTIONS ===\n'
if [[ -n "$METZ" && "$METZ" != "stop_area:SNCF:" ]]; then
  REL="journeys?from=${CHAMP}&to=${METZ}&datetime=${NAVDT}&datetime_represents=departure&count=10&depth=3&data_freshness=base_schedule"
  curl -sS --get "$PROXY" --data-urlencode "url=$REL" -o "$TMP/journeys.json"
  python3 - "$TMP/journeys.json" "$NUMBER" "$VJID" <<'PY'
import json,sys,re,math
obj=json.load(open(sys.argv[1],encoding='utf-8')); wanted=str(sys.argv[2]); vjid=str(sys.argv[3] or '')
js=obj.get('journeys') or []
print('journeys:',len(js))

def coords(g):
 out=[]
 if not isinstance(g,dict):return out
 def rec(x):
  if isinstance(x,(list,tuple)):
   if len(x)>=2 and isinstance(x[0],(int,float)) and isinstance(x[1],(int,float)):out.append((float(x[0]),float(x[1])))
   else:
    for y in x:rec(y)
 rec(g.get('coordinates')); return out

def blob(v):
 if isinstance(v,dict): return ' '.join([str(x or '') for x in v.values() if isinstance(x,(str,int,float))]+[blob(x) for x in v.values() if isinstance(x,(dict,list))])
 if isinstance(v,list): return ' '.join(blob(x) for x in v)
 return ''
refs={'005341_ouest':(6.00214991102663,48.97062296888771),'005341_est':(6.027062006107198,48.980617830259646)}
R=6371000
def dist(a,b):
 lon1,lat1=a; lon2,lat2=b; p1=math.radians(lat1);p2=math.radians(lat2);dp=math.radians(lat2-lat1);dl=math.radians(lon2-lon1)
 h=math.sin(dp/2)**2+math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
 return 2*R*math.asin(min(1,math.sqrt(h)))
for ji,j in enumerate(js):
 for si,s in enumerate(j.get('sections') or []):
  if s.get('type')!='public_transport':continue
  di=s.get('display_informations') or {}; cs=coords(s.get('geojson'))
  match=(str(di.get('code') or '')==wanted or re.search(r'(?<!\d)'+re.escape(wanted)+r'(?!\d)',blob(s)) or (vjid and vjid in blob(s)))
  print(f"PT j={ji} s={si} code={di.get('code')} label={di.get('label')} headsign={di.get('headsign')} points={len(cs)} match={bool(match)}")
  if cs and match:
   for name,p in refs.items():
    best=min((dist(c,p),idx,c) for idx,c in enumerate(cs))
    print(f'  proche {name}: {best[0]:.0f} m @ {best[1]} {best[2]}')
else:
 print('Metz UIC introuvable ; étape journey ignorée')
PY
fi

printf '\n============================================================\n'
printf 'FIN AUDIT SNCF V5 — AUCUNE MODIFICATION\n'
printf '============================================================\n'
