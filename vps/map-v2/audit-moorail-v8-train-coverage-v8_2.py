#!/usr/bin/env python3
import csv, json, importlib.util, unicodedata
from pathlib import Path
from collections import defaultdict, Counter
from datetime import datetime
from zoneinfo import ZoneInfo

ROOT=Path('/opt/labetaillere-map-v2-src/map-v2')
GTFS=Path('/var/www/html/gtfs/static')
STATE=ROOT/'data/route-editor/moorail-route-editor-state-v1.json'
LIVE=ROOT/'public/data/moorail-live-v1/sections.json'
BUILDER=ROOT/'scripts/build-moorail-network-v8.py'
OUT=ROOT/'data/route-editor/moorail-v8-train-coverage-today.json'


def rows(path):
    with path.open('r',encoding='utf-8-sig',errors='replace',newline='') as f:
        yield from csv.DictReader(f)

def norm(s):
    s=unicodedata.normalize('NFKD',str(s or ''))
    return ''.join(c for c in s if not unicodedata.combining(c)).strip().lower()

def load_builder():
    spec=importlib.util.spec_from_file_location('moorail_v8_builder',BUILDER)
    if not spec or not spec.loader: raise SystemExit('Impossible de charger '+str(BUILDER))
    mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod);return mod

def active_services(today):
    ymd=today.strftime('%Y%m%d')
    weekday=['monday','tuesday','wednesday','thursday','friday','saturday','sunday'][today.weekday()]
    active=set()
    cal=GTFS/'calendar.txt'
    if cal.exists():
        for r in rows(cal):
            if str(r.get('start_date',''))<=ymd<=str(r.get('end_date','')) and str(r.get(weekday,'0'))=='1':
                active.add(str(r.get('service_id') or ''))
    cd=GTFS/'calendar_dates.txt'
    if cd.exists():
        for r in rows(cd):
            if str(r.get('date') or '')!=ymd: continue
            sid=str(r.get('service_id') or '');typ=str(r.get('exception_type') or '')
            if typ=='1': active.add(sid)
            elif typ=='2': active.discard(sid)
    return active

def main():
    for p in (STATE,LIVE,BUILDER,GTFS/'trips.txt',GTFS/'stop_times.txt',GTFS/'stops.txt'):
        if not p.exists(): raise SystemExit('Absent: '+str(p))

    b=load_builder()
    today=datetime.now(ZoneInfo('Europe/Paris')).date();active=active_services(today)
    stops={}
    for s in rows(GTFS/'stops.txt'):
        sid=str(s.get('stop_id') or '')
        if sid: stops[sid]=str(s.get('stop_name') or sid)

    trips={}
    for t in rows(GTFS/'trips.txt'):
        if active and str(t.get('service_id') or '') not in active: continue
        tid=str(t.get('trip_id') or '')
        tok=b.token_for_trip_id(tid)
        if tok not in b.ALLOWED_TOKENS: continue
        trips[tid]={'number':b.num_for(t),'token':tok}

    seq=defaultdict(list)
    for r in rows(GTFS/'stop_times.txt'):
        tid=str(r.get('trip_id') or '')
        if tid not in trips: continue
        try:o=int(float(r.get('stop_sequence') or 0))
        except:o=0
        sid=str(r.get('stop_id') or '')
        if sid in stops: seq[tid].append((o,stops[sid]))

    state=json.load(open(STATE,encoding='utf-8'))
    live=json.load(open(LIVE,encoding='utf-8'))
    direct={}
    for x in live.get('pairs') or []:
        a,bn=norm(x.get('from')),norm(x.get('to'))
        if a and bn: direct[(a,bn)]=x

    def edge_status(a,bn):
        cid=b.canonical_id(a,bn)
        sec=(state.get('sections') or {}).get(cid) or {}
        if sec.get('status')=='validated' and (sec.get('validationEngine')=='ROUTER_V6' or str(sec.get('source') or '')=='MOORAIL_VALIDATED_SECTIONS_V8'):
            return 'V8'
        if sec.get('status')=='validated': return 'LEGACY'
        # direct legacy section may still exist under old route id
        hit=direct.get((norm(a),norm(bn)))
        if hit: return 'LEGACY'
        return 'MISSING'

    def resolve_pair(a,bn):
        hit=direct.get((norm(a),norm(bn)))
        if hit:
            return True,[(a,bn,edge_status(a,bn))],'direct'
        ex=b.spine_expansion(a,bn)
        if not ex: return False,[],None
        used=[]
        for fa,fb,cid,clabel in ex:
            if (norm(fa),norm(fb)) not in direct:
                return False,used+[(fa,fb,'MISSING')],cid
            used.append((fa,fb,edge_status(fa,fb)))
        return True,used,ex[0][2] if ex else None

    missing=defaultdict(lambda:{'trips':set(),'numbers':set(),'examples':set()})
    full=certified=legacy_full=partial=0
    token_counts=Counter()
    train_rows=[]
    valid_trips=0

    for tid,t in trips.items():
        ss=[name for _,name in sorted(seq.get(tid) or [],key=lambda x:x[0])]
        if len(ss)<2: continue
        valid_trips+=1;token_counts[t['token']]+=1
        all_ok=True;all_v8=True;used_edges=[];miss=[]
        for a,bn in zip(ss,ss[1:]):
            ok,edges,mode=resolve_pair(a,bn)
            used_edges.extend(edges)
            if not ok:
                all_ok=False;all_v8=False;miss.append((a,bn))
                m=missing[(norm(a),norm(bn))];m['trips'].add(tid);m['numbers'].add(str(t['number']));m['examples'].add(a+' → '+bn)
            elif any(st!='V8' for _,_,st in edges):
                all_v8=False
        if all_ok:
            full+=1
            if all_v8: certified+=1
            else: legacy_full+=1
        else:
            partial+=1
        train_rows.append({'tripId':tid,'number':str(t['number']),'token':t['token'],'stops':ss,'resolvable':all_ok,'certifiedV8':all_v8,'missingPairs':[{'from':a,'to':bn} for a,bn in miss]})

    missing_rows=[]
    for (_, _),m in missing.items():
        ex=sorted(m['examples'])[0]
        a,bn=ex.split(' → ',1)
        missing_rows.append({'from':a,'to':bn,'tripCount':len(m['trips']),'numbers':sorted(m['numbers'])})
    missing_rows.sort(key=lambda x:(-x['tripCount'],x['from'],x['to']))

    payload={'version':'8.2','date':str(today),'strictTripsToday':valid_trips,'fullResolvable':full,'certifiedV8':certified,'fullButLegacy':legacy_full,'incomplete':partial,'tokenCounts':dict(token_counts),'topMissingPairs':missing_rows[:100],'trains':train_rows}
    OUT.parent.mkdir(parents=True,exist_ok=True);OUT.write_text(json.dumps(payload,ensure_ascii=False,indent=2),encoding='utf-8')

    pct=lambda n: (100*n/valid_trips if valid_trips else 0)
    print('============================================================')
    print(' MOO RAIL V8.2 — COUVERTURE REELLE DES TRAINS DU JOUR')
    print('============================================================')
    print('Date                 :',today)
    print('GV stricts            :',valid_trips)
    print(f'✅ entièrement résolus : {full} ({pct(full):.1f}%)')
    print(f'🟢 certifiés V8        : {certified} ({pct(certified):.1f}%)')
    print(f'⚠️ résolus via legacy  : {legacy_full} ({pct(legacy_full):.1f}%)')
    print(f'❌ incomplets           : {partial} ({pct(partial):.1f}%)')
    print('Tokens                :',dict(token_counts))
    print()
    print('TOP PAIRES QUI BLOQUENT LE PLUS DE TRAINS')
    for x in missing_rows[:40]:
        print(f" {x['tripCount']:3d} train(s) | {x['from']} → {x['to']}")
        if x['numbers']: print('    trains :',', '.join(x['numbers'][:16]))
    print()
    print('Rapport :',OUT)
    print('============================================================')

if __name__=='__main__': main()
