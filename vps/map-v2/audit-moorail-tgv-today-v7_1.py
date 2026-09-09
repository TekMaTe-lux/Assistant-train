#!/usr/bin/env python3
import csv, json, re, unicodedata
from pathlib import Path
from datetime import datetime
from zoneinfo import ZoneInfo
from collections import defaultdict

GTFS=Path('/var/www/html/gtfs/static')
ROOT=Path('/opt/labetaillere-map-v2-src/map-v2')
LIVE=ROOT/'public/data/moorail-live-v1/sections.json'
STATE=ROOT/'data/route-editor/moorail-route-editor-state-v1.json'
OUT=ROOT/'data/route-editor/moorail-tgv-today-v7_1.json'
V6_AT='2026-09-09T06:20:50'


def rows(path):
    with path.open('r',encoding='utf-8-sig',errors='replace',newline='') as f:
        yield from csv.DictReader(f)

def norm(s):
    s=unicodedata.normalize('NFKD',str(s or ''))
    return ''.join(c for c in s if not unicodedata.combining(c)).strip().lower()

def text(*vals):
    return ' '.join(str(v or '') for v in vals).upper()

# IMPORTANT: TRN est volontairement exclu comme marque générique : dans le
# feed SNCF il peut apparaître sur des trains qui ne sont pas grande vitesse.
STRONG_BRANDS=(
    'TGV','TGV INOUI','INOUI','OUIGO','LYRIA','ICE','EUROSTAR','THALYS',
    'FRECCIAROSSA','TRENITALIA','AVE','RENFE','DB-SNCF','ALLEO'
)

def is_high_speed(trip, route):
    tid=str(trip.get('trip_id') or '')
    rtxt=text(route.get('route_short_name'),route.get('route_long_name'),route.get('route_desc'))
    ttxt=text(trip.get('trip_short_name'),trip.get('trip_headsign'))
    alltxt=' '.join((tid.upper(),rtxt,ttxt))

    # Tokens d'identité explicites dans les trip_id SNCF.
    if any(tok in tid.upper() for tok in (':OUI:',':OUIGO:',':OGO:',':TGV:',':ICE:',':LYRIA:',':EUR:')):
        return True

    # Marques fortes dans la route / desserte.
    if any(b in alltxt for b in STRONG_BRANDS):
        return True

    # TRN seul n'est PAS une preuve de TGV/Trenitalia.
    return False


def train_num(t):
    v=str(t.get('trip_short_name') or '').strip()
    if re.fullmatch(r'\d{2,6}',v): return v
    m=re.search(r'^OCESN(\d{2,6})',str(t.get('trip_id') or ''),re.I)
    return m.group(1) if m else str(t.get('trip_short_name') or t.get('trip_id') or '')


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
    for r in rows(rp): routes[str(r.get('route_id'))]=r

stops={}
for s in rows(GTFS/'stops.txt'):
    stops[str(s.get('stop_id'))]={
        'name':str(s.get('stop_name') or s.get('stop_id')),
        'lat':s.get('stop_lat'),'lon':s.get('stop_lon')
    }

selected={}
rejected_samples=[]
for t in rows(GTFS/'trips.txt'):
    sid=str(t.get('service_id') or '')
    if active and sid not in active: continue
    route=routes.get(str(t.get('route_id') or ''),{})
    if is_high_speed(t,route):
        tid=str(t.get('trip_id') or '')
        if tid:
            selected[tid]={
                'number':train_num(t),
                'headsign':str(t.get('trip_headsign') or ''),
                'route_id':str(t.get('route_id') or ''),
                'service_id':sid,
                'route_short_name':str(route.get('route_short_name') or ''),
                'route_long_name':str(route.get('route_long_name') or ''),
            }
    elif len(rejected_samples)<40:
        n=train_num(t)
        if n in {'879303','839654','68230','427250'}:
            rejected_samples.append((n,str(t.get('trip_id') or ''),str(route.get('route_short_name') or ''),str(route.get('route_long_name') or '')))

seq=defaultdict(list)
for r in rows(GTFS/'stop_times.txt'):
    tid=str(r.get('trip_id') or '')
    if tid not in selected: continue
    try: order=int(float(r.get('stop_sequence') or 0))
    except: order=0
    sid=str(r.get('stop_id') or '')
    seq[tid].append((order,stops.get(sid,{'name':sid})['name']))

pair_usage=defaultdict(lambda:{'trips':set(),'numbers':set()})
variants=set()
brands=defaultdict(int)
for tid,t in selected.items():
    ss=[name for _,name in sorted(seq.get(tid,[]))]
    if len(ss)<2: continue
    variants.add((t['number'],' → '.join(ss)))
    brand=(t['route_short_name'] or t['route_long_name'] or 'UNKNOWN').strip()
    brands[brand]+=1
    for a,b in zip(ss,ss[1:]):
        d=pair_usage[(norm(a),norm(b))]
        d['from']=a; d['to']=b; d['trips'].add(tid); d['numbers'].add(t['number'])

live=json.load(open(LIVE,encoding='utf-8'))
state=json.load(open(STATE,encoding='utf-8'))
state_sections=state.get('sections') or {}
live_pairs={(norm(x.get('from')),norm(x.get('to'))):x for x in (live.get('pairs') or [])}

stats=defaultdict(int); report=[]
for key,u in pair_usage.items():
    direct=live_pairs.get(key)
    if direct:
        sid=str(direct.get('sectionId') or '')
        sec=state_sections.get(sid) or {}
        updated=str(sec.get('updatedAt') or direct.get('updatedAt') or '')
        status='DIRECT_V6' if updated[:19]>=V6_AT else 'DIRECT_LEGACY'
    else:
        status='MISSING'; updated=''
    stats[status]+=1
    report.append({
        'from':u['from'],'to':u['to'],'status':status,'updatedAt':updated,
        'tripCount':len(u['trips']),'numbers':sorted(u['numbers'])
    })

report.sort(key=lambda x:({'MISSING':0,'DIRECT_LEGACY':1,'DIRECT_V6':2}.get(x['status'],9),-x['tripCount'],x['from'],x['to']))

payload={
    'date':str(today),'strictHighSpeedTrips':len(selected),'variants':len(variants),
    'uniquePairs':len(pair_usage),'stats':dict(stats),'brands':dict(sorted(brands.items(),key=lambda kv:-kv[1])),
    'pairs':report
}
OUT.parent.mkdir(parents=True,exist_ok=True)
OUT.write_text(json.dumps(payload,ensure_ascii=False,indent=2),encoding='utf-8')

print('============================================================')
print(' MOO RAIL V7.1 — AUDIT STRICT TGV / GV DU JOUR')
print('============================================================')
print('Date                :',today)
print('Trips GV stricts    :',len(selected))
print('Variantes uniques   :',len(variants))
print('Paires arrêt→arrêt  :',len(pair_usage))
print()
print('COUVERTURE DIRECTE')
print(' ✅ Direct V6       :',stats['DIRECT_V6'])
print(' ⚠️ Direct pré-V6   :',stats['DIRECT_LEGACY'])
print(' ❌ Manquante       :',stats['MISSING'])
print()
print('MARQUES / ROUTES LES PLUS VUES')
for k,v in list(sorted(brands.items(),key=lambda kv:-kv[1]))[:20]:
    print(f' {v:4d} | {k or "(vide)"}')
print()
print('CONTROLE ANTI-FAUX-POSITIFS (doivent être absents)')
nums={t['number'] for t in selected.values()}
for n in ('879303','839654','68230','427250'):
    print(' ',n,'PRESENT' if n in nums else 'OK exclu')
print()
print('TOP 80 A REPARER / REVALIDER')
for x in report[:80]:
    if x['status']=='DIRECT_V6': continue
    icon='❌' if x['status']=='MISSING' else '⚠️'
    print(f"{icon} {x['status']:13s} | {x['tripCount']:3d} | {x['from']} → {x['to']}")
    if x['numbers']:
        print('   trains :',', '.join(x['numbers'][:18]))
print()
print('Rapport JSON :',OUT)
print('============================================================')
