#!/usr/bin/env bash
set -euo pipefail

NUMBER="${1:-2807}"
DATE_RAW="${2:-$(date +%Y%m%d)}"
PROXY="https://assistant-train-cx5u.vercel.app/api/train"
GTFS="/var/www/html/gtfs/static"
TMP="$(mktemp -d /tmp/lb-sncf-discover-v3.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

DATE="$(python3 - "$DATE_RAW" <<'PY'
import re,sys
s=re.sub(r'\D','',sys.argv[1])
if len(s)!=8: raise SystemExit('date invalide, attendu YYYYMMDD ou YYYY-MM-DD')
print(s)
PY
)"

printf '\n============================================================\n'
printf 'AUDIT SNCF V3 — DECOUVERTE DU VRAI VEHICLE_JOURNEY + GEOJSON\n'
printf 'TGV %s — %s — AUCUNE MODIFICATION\n' "$NUMBER" "$DATE"
printf '============================================================\n'

printf '\n=== 1. HORAIRE 2807 DANS LE GTFS LOCAL ===\n'
python3 - "$GTFS" "$NUMBER" "$TMP/gtfs.json" <<'PY'
import csv,json,re,sys,unicodedata
from pathlib import Path
root=Path(sys.argv[1]); wanted=re.sub(r'\D','',sys.argv[2]); out=sys.argv[3]
for fn in ('trips.txt','stop_times.txt','stops.txt'):
    if not (root/fn).exists(): raise SystemExit(f'GTFS absent: {root/fn}')

def n(v):
    m=re.findall(r'\d{3,6}',str(v or ''))
    return (m[0].lstrip('0') or '0') if m else ''
def norm(s):
    s=unicodedata.normalize('NFKD',str(s or ''))
    return ''.join(c for c in s if not unicodedata.combining(c)).upper()

tr=[]
with (root/'trips.txt').open(encoding='utf-8-sig',newline='') as f:
    for r in csv.DictReader(f):
        if n(r.get('trip_short_name'))==n(wanted): tr.append(r)
print('trips candidats GTFS:',len(tr))
if not tr: raise SystemExit('aucun trip_short_name '+wanted)
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
chosen=None
for t in tr:
    seq=sorted(rows.get(t.get('trip_id')) or [])
    names=[]
    for q,r in seq:
        s=stops.get(r.get('stop_id'),{})
        names.append(norm(s.get('stop_name')))
    if any('CHAMPAGNE-ARDENNE TGV' in x or 'CHAMPAGNE ARDENNE TGV' in x for x in names) and any(x=='METZ' or 'METZ VILLE' in x for x in names):
        chosen=(t,seq); break
if not chosen:
    raise SystemExit('aucune variante 2807 contenant Champagne-Ardenne TGV et Metz')
t,seq=chosen
print('trip choisi:',t.get('trip_id'),'service=',t.get('service_id'),'headsign=',t.get('trip_headsign'))
items=[]
for q,r in seq:
    s=stops.get(r.get('stop_id'),{})
    name=s.get('stop_name') or ''
    items.append({'seq':q,'name':name,'arr':r.get('arrival_time'),'dep':r.get('departure_time'),'stop_id':r.get('stop_id'),'parent_station':s.get('parent_station'),'stop_code':s.get('stop_code'),'lat':s.get('stop_lat'),'lon':s.get('stop_lon')})
    print(f" {q:3d} | {name} | {r.get('arrival_time')} -> {r.get('departure_time')} | stop={r.get('stop_id')} parent={s.get('parent_station')} code={s.get('stop_code')}")
champ=next((x for x in items if 'CHAMPAGNE' in norm(x['name']) and 'TGV' in norm(x['name'])),None)
metz=next((x for x in items if norm(x['name'])=='METZ' or 'METZ VILLE' in norm(x['name'])),None)
if not champ or not metz: raise SystemExit('Champagne ou Metz introuvable dans variante')
json.dump({'trip':t,'stops':items,'champagne':champ,'metz':metz},open(out,'w',encoding='utf-8'),ensure_ascii=False)
PY

printf '\n=== 2. RESOLUTION NAVITIA DES DEUX GARES ===\n'
for NAME in "Champagne-Ardenne TGV" "Metz"; do
  KEY="$(printf '%s' "$NAME" | tr '[:upper:]' '[:lower:]' | tr -cd '[:alnum:]')"
  REL="places?q=$(python3 -c 'import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))' "$NAME")&type%5B%5D=stop_area&count=20"
  curl -fsS --get "$PROXY" --data-urlencode "url=$REL" -o "$TMP/places-$KEY.json"
done

python3 - "$TMP" <<'PY'
import json,sys,unicodedata
from pathlib import Path
p=Path(sys.argv[1])
def norm(s):
    s=unicodedata.normalize('NFKD',str(s or ''))
    return ''.join(c for c in s if not unicodedata.combining(c)).upper().replace('-',' ')
def pick(fn,wanted):
    o=json.load(open(fn,encoding='utf-8')); rows=o.get('places') or []
    print('\n',wanted,'candidats:',len(rows))
    best=None
    for x in rows:
        sa=x.get('stop_area') or {}
        print(' -',sa.get('name'),'|',sa.get('id'),'|',sa.get('coord'))
        score=0
        n=norm(sa.get('name'))
        if norm(wanted)==n: score=100
        elif all(tok in n for tok in norm(wanted).split()): score=80
        elif 'METZ' in norm(wanted) and n.startswith('METZ'): score=70
        if best is None or score>best[0]: best=(score,sa)
    if not best or best[0]<=0: raise SystemExit('gare Navitia non résolue: '+wanted)
    return best[1]
champ=pick(p/'places-champagneardennetgv.json','Champagne-Ardenne TGV')
metz=pick(p/'places-metz.json','Metz')
json.dump({'champagne':champ,'metz':metz},open(p/'areas.json','w',encoding='utf-8'),ensure_ascii=False)
print('\nCHOISI Champagne:',champ.get('id'),champ.get('name'))
print('CHOISI Metz      :',metz.get('id'),metz.get('name'))
PY

printf '\n=== 3. DEPARTURES CHAMPAGNE : ON DECOUVRE LE VRAI VEHICLE_JOURNEY ===\n'
python3 - "$TMP/gtfs.json" "$TMP/areas.json" "$DATE" "$TMP/departures-rel.txt" <<'PY'
import json,sys,urllib.parse,datetime
G=json.load(open(sys.argv[1],encoding='utf-8')); A=json.load(open(sys.argv[2],encoding='utf-8')); d=sys.argv[3]
time=(G['champagne'].get('dep') or G['champagne'].get('arr') or '00:00:00').replace(':','')[:6]
h=int(time[:2]); m=int(time[2:4]); s=int(time[4:6])
dt=datetime.datetime.strptime(d,'%Y%m%d').replace(hour=h%24,minute=m,second=s)-datetime.timedelta(minutes=20)
stamp=dt.strftime('%Y%m%dT%H%M%S')
area=A['champagne']['id']
rel=f"stop_areas/{urllib.parse.quote(area,safe='')}/departures?datetime={stamp}&duration=3600&count=100&depth=3&data_freshness=base_schedule"
open(sys.argv[4],'w',encoding='utf-8').write(rel)
print('départ GTFS 2807:',G['champagne'].get('dep'))
print('requête depuis   :',stamp)
print('stop_area        :',area)
PY
REL="$(cat "$TMP/departures-rel.txt")"
curl -fsS --get "$PROXY" --data-urlencode "url=$REL" -o "$TMP/departures.json"

python3 - "$TMP/departures.json" "$NUMBER" "$TMP/vjid.txt" <<'PY'
import json,re,sys
o=json.load(open(sys.argv[1],encoding='utf-8')); wanted=str(sys.argv[2]); out=sys.argv[3]
rows=o.get('departures') or []
print('departures reçus:',len(rows))

def blob(x):
    d=x.get('display_informations') or {}
    vals=[d.get('code'),d.get('label'),d.get('headsign'),d.get('name'),d.get('direction')]
    return ' '.join(str(v or '') for v in vals)
def ids(obj):
    found=[]
    def rec(x):
        if isinstance(x,dict):
            typ=str(x.get('type') or '')
            ident=str(x.get('id') or '')
            if typ=='vehicle_journey' and ident: found.append(ident)
            if 'vehicle_journey:' in ident: found.append(ident)
            for v in x.values(): rec(v)
        elif isinstance(x,list):
            for v in x: rec(v)
    rec(obj)
    return list(dict.fromkeys(found))

matches=[]
for i,r in enumerate(rows):
    d=r.get('display_informations') or {}; b=blob(r)
    dep=((r.get('stop_date_time') or {}).get('departure_date_time'))
    print(f" {i:3d} | dep={dep} | code={d.get('code')} label={d.get('label')} headsign={d.get('headsign')} direction={d.get('direction')}")
    if re.search(r'(?<!\d)'+re.escape(wanted)+r'(?!\d)',b): matches.append(r)
print('\nmatch numéro',wanted,':',len(matches))
allids=[]
for r in matches:
    js=ids(r); allids+=js
    print(' MATCH',blob(r))
    print(' vehicle_journey ids:',js)
allids=list(dict.fromkeys(allids))
if allids:
    open(out,'w',encoding='utf-8').write(allids[0])
    print('VRAI VJ RETENU:',allids[0])
else:
    open(out,'w',encoding='utf-8').write('')
    print('ATTENTION: aucun vehicle_journey id extrait; on poursuivra par journeys')
PY

VJID="$(cat "$TMP/vjid.txt")"
if [[ -n "$VJID" ]]; then
  printf '\n=== 4. FETCH DU VRAI VEHICLE_JOURNEY ===\n'
  REL="vehicle_journeys/$(python3 -c 'import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=""))' "$VJID")?depth=3"
  curl -fsS --get "$PROXY" --data-urlencode "url=$REL" -o "$TMP/vj-real.json"
  python3 - "$TMP/vj-real.json" <<'PY'
import json,sys
o=json.load(open(sys.argv[1],encoding='utf-8')); rows=o.get('vehicle_journeys') or []
print('vehicle_journeys:',len(rows))
if rows:
 v=rows[0]
 print('id=',v.get('id')); print('name=',v.get('name')); print('headsign=',v.get('headsign'))
 print('route=',(v.get('route') or {}).get('name')); print('physical_mode=',(v.get('physical_mode') or {}).get('name'))
 print('geojson direct=',bool((v.get('geojson') or {}).get('coordinates')))
PY
else
  printf '\n=== 4. VJ DIRECT SAUTE : ID NON EXPOSE DANS DEPARTURES ===\n'
fi

printf '\n=== 5. JOURNEYS CHAMPAGNE -> METZ ET GEOJSON DES SECTIONS ===\n'
python3 - "$TMP/gtfs.json" "$TMP/areas.json" "$DATE" "$TMP/journeys-rel.txt" <<'PY'
import json,sys,urllib.parse
G=json.load(open(sys.argv[1],encoding='utf-8')); A=json.load(open(sys.argv[2],encoding='utf-8')); d=sys.argv[3]
time=(G['champagne'].get('dep') or G['champagne'].get('arr') or '00:00:00').replace(':','')[:6]
params={
 'from':A['champagne']['id'],
 'to':A['metz']['id'],
 'datetime':d+'T'+time,
 'datetime_represents':'departure',
 'count':'20','depth':'3','data_freshness':'base_schedule'
}
rel='journeys?'+urllib.parse.urlencode(params)
open(sys.argv[4],'w',encoding='utf-8').write(rel)
print('query=',rel)
PY
REL="$(cat "$TMP/journeys-rel.txt")"
curl -fsS --get "$PROXY" --data-urlencode "url=$REL" -o "$TMP/journeys.json"

python3 - "$TMP/journeys.json" "$NUMBER" "$VJID" <<'PY'
import json,sys,re,math
obj=json.load(open(sys.argv[1],encoding='utf-8')); wanted=str(sys.argv[2]); real_vj=str(sys.argv[3] or '')
js=obj.get('journeys') or []
print('journeys reçus:',len(js))

def coords(g):
    if not isinstance(g,dict): return []
    out=[]
    def rec(x):
        if isinstance(x,(list,tuple)):
            if len(x)>=2 and isinstance(x[0],(int,float)) and isinstance(x[1],(int,float)): out.append((float(x[0]),float(x[1])))
            else:
                for y in x: rec(y)
    rec(g.get('coordinates')); return out

def text(sec):
    d=sec.get('display_informations') or {}; vals=[d.get('code'),d.get('label'),d.get('headsign'),d.get('name'),d.get('direction')]
    def rec(x):
        if isinstance(x,dict):
            for k,v in x.items():
                if k in ('id','value','type'): vals.append(v)
                rec(v)
        elif isinstance(x,list):
            for v in x: rec(v)
    rec(sec.get('links') or [])
    return ' '.join(str(v or '') for v in vals)
refs={
 '005341_ouest':(6.00214991102663,48.97062296888771),
 '005341_est':(6.027062006107198,48.980617830259646),
 'Metz':(6.176,49.119),
}
R=6371000
def dist(a,b):
    lon1,lat1=a; lon2,lat2=b; p1=math.radians(lat1); p2=math.radians(lat2); dp=math.radians(lat2-lat1); dl=math.radians(lon2-lon1)
    h=math.sin(dp/2)**2+math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
    return 2*R*math.asin(min(1,math.sqrt(h)))
found=[]
for ji,j in enumerate(js):
    for si,s in enumerate(j.get('sections') or []):
        if s.get('type')!='public_transport': continue
        d=s.get('display_informations') or {}; c=coords(s.get('geojson')); b=text(s)
        ismatch=bool(re.search(r'(?<!\d)'+re.escape(wanted)+r'(?!\d)',b)) or (real_vj and real_vj in b)
        print(f"PT j={ji} s={si} code={d.get('code')} label={d.get('label')} headsign={d.get('headsign')} points={len(c)} match={ismatch}")
        if c:
            print(' bbox=',(min(x for x,y in c),min(y for x,y in c),max(x for x,y in c),max(y for x,y in c)))
        if ismatch: found.append((ji,si,s,c))
print('\nsections 2807/VJ correspondantes:',len(found))
for ji,si,s,c in found:
    print(f'\nMATCH j={ji} s={si} points={len(c)}')
    if not c:
        print(' PAS DE GEOJSON')
        continue
    for name,p in refs.items():
        best=min((dist(x,p),idx,x) for idx,x in enumerate(c))
        print(f' plus proche {name}: {best[0]:.0f} m @ index {best[1]} {best[2]}')
    fn=f'/tmp/lb-sncf-{wanted}-journey-geojson.json'
    json.dump({'type':'Feature','properties':{'train':wanted,'journey':ji,'section':si,'vehicle_journey':real_vj},'geometry':s.get('geojson')},open(fn,'w',encoding='utf-8'),ensure_ascii=False)
    print(' GEOJSON SAUVEGARDE:',fn)
PY

printf '\n============================================================\n'
printf 'FIN AUDIT V3 — AUCUNE MODIFICATION\n'
printf '============================================================\n'
