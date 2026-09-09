#!/usr/bin/env python3
import csv,re
from collections import Counter,defaultdict
from pathlib import Path
from datetime import datetime
from zoneinfo import ZoneInfo

GTFS=Path('/var/www/html/gtfs/static')
TARGETS={'5454','2509','5460','9577','9242','9706','879303','839654','68230','427250'}

def rows(path):
    with path.open('r',encoding='utf-8-sig',errors='replace',newline='') as f:
        yield from csv.DictReader(f)

def train_num(t):
    v=str(t.get('trip_short_name') or '').strip()
    if re.fullmatch(r'\d{2,6}',v): return v
    m=re.search(r'^OCES[AN](\d{2,6})',str(t.get('trip_id') or ''),re.I)
    return m.group(1) if m else ''

def service_token(tid):
    s=str(tid or '')
    # Format SNCF observé: ..._F:OUI:FR:Line::... ou ..._F:TER:FR:Line::...
    m=re.search(r'_F:([^:]+):FR:Line::',s,re.I)
    if m: return m.group(1).upper()
    m=re.search(r':([^:]+):FR:Line::',s,re.I)
    if m: return m.group(1).upper()
    return '(NONE)'

today=datetime.now(ZoneInfo('Europe/Paris')).date()
ymd=today.strftime('%Y%m%d')
weekday=['monday','tuesday','wednesday','thursday','friday','saturday','sunday'][today.weekday()]

active=set()
cal=GTFS/'calendar.txt'
if cal.exists():
    for r in rows(cal):
        if str(r.get('start_date',''))<=ymd<=str(r.get('end_date','')) and str(r.get(weekday,'0'))=='1':
            active.add(str(r.get('service_id')))
cd=GTFS/'calendar_dates.txt'
if cd.exists():
    for r in rows(cd):
        if str(r.get('date'))!=ymd: continue
        sid=str(r.get('service_id')); typ=str(r.get('exception_type'))
        if typ=='1': active.add(sid)
        elif typ=='2': active.discard(sid)

routes={}
rp=GTFS/'routes.txt'
if rp.exists():
    for r in rows(rp): routes[str(r.get('route_id') or '')]=r

counts=Counter(); examples=defaultdict(list); targets=defaultdict(list); total=0
for t in rows(GTFS/'trips.txt'):
    sid=str(t.get('service_id') or '')
    if active and sid not in active: continue
    total+=1
    tid=str(t.get('trip_id') or '')
    tok=service_token(tid)
    counts[tok]+=1
    if len(examples[tok])<4:
        route=routes.get(str(t.get('route_id') or ''),{})
        examples[tok].append((train_num(t),str(t.get('trip_headsign') or ''),str(route.get('route_short_name') or ''),tid))
    n=train_num(t)
    if n in TARGETS:
        route=routes.get(str(t.get('route_id') or ''),{})
        targets[n].append({
            'token':tok,
            'headsign':str(t.get('trip_headsign') or ''),
            'routeShort':str(route.get('route_short_name') or ''),
            'routeLong':str(route.get('route_long_name') or ''),
            'tripId':tid,
        })

print('============================================================')
print(' MOO RAIL V7.2 — AUDIT DES TOKENS SERVICE GTFS')
print('============================================================')
print('Date Europe/Paris :',today)
print('Trips actifs      :',total)
print()
print('TOKENS EXACTS DANS trip_id')
for tok,n in counts.most_common():
    print(f'{n:6d} | {tok}')
    for num,head,short,tid in examples[tok][:2]:
        print('       ex:',num or '?','|',head or '-','| route=',short or '-','|',tid[:120])
print()
print('============================================================')
print(' TRAINS DE CONTROLE')
print('============================================================')
for n in sorted(TARGETS,key=lambda x:(len(x),x)):
    arr=targets.get(n,[])
    print()
    print(n,':',len(arr),'trip(s) actif(s)')
    if not arr:
        print('   ABSENT aujourd\'hui')
        continue
    seen=set()
    for x in arr:
        key=(x['token'],x['headsign'],x['routeShort'],x['routeLong'])
        if key in seen: continue
        seen.add(key)
        print('   token     :',x['token'])
        print('   headsign  :',x['headsign'] or '-')
        print('   routeShort:',x['routeShort'] or '-')
        print('   routeLong :',x['routeLong'] or '-')
        print('   tripId    :',x['tripId'])
        if len(seen)>=3: break
print()
print('============================================================')
print(' AUCUNE MODIFICATION')
print('============================================================')
