#!/usr/bin/env python3
import argparse,csv,json,re,hashlib,datetime,os,tempfile
from pathlib import Path

ALLOWED_TOKENS={'OUI','OGO','LYR','ICE','TRN','TGV','THA','EUR'}
NUM_RE=re.compile(r'^\s*(\d{2,6})\s*$')
ID_NUM_RE=re.compile(r'^OCESN(\d{2,6})',re.I)
TOKEN_RE=re.compile(r'^[^:]+:([A-Z0-9]+):')

def rows(path):
    with path.open('r',encoding='utf-8-sig',errors='replace',newline='') as f:
        yield from csv.DictReader(f)

def token_for_trip_id(tid):
    m=TOKEN_RE.match(str(tid or '').upper())
    return m.group(1) if m else ''

def num_for(t):
    for k in ('trip_short_name','trip_headsign'):
        m=NUM_RE.match(str(t.get(k) or ''))
        if m:return m.group(1)
    m=ID_NUM_RE.search(str(t.get('trip_id') or ''))
    return m.group(1) if m else None

def f(v):
    try:return float(v)
    except:return None

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--source',required=True)
    ap.add_argument('--output',required=True)
    args=ap.parse_args()
    src=Path(args.source); out=Path(args.output)
    for n in ('trips.txt','stop_times.txt','stops.txt'):
        if not (src/n).exists(): raise SystemExit(f'absent: {src/n}')

    routes={}
    rp=src/'routes.txt'
    if rp.exists():
        for r in rows(rp): routes[str(r.get('route_id') or '')]=r

    stops={}
    for s in rows(src/'stops.txt'):
        sid=str(s.get('stop_id') or '')
        if not sid:continue
        stops[sid]={'name':str(s.get('stop_name') or sid),'lat':f(s.get('stop_lat')),'lon':f(s.get('stop_lon'))}

    candidates={}; raw_trip_count=0; token_counts={}
    for t in rows(src/'trips.txt'):
        raw_trip_count+=1
        tid=str(t.get('trip_id') or '')
        token=token_for_trip_id(tid)
        token_counts[token]=token_counts.get(token,0)+1
        if token not in ALLOWED_TOKENS: continue
        n=num_for(t)
        if not n or not tid: continue
        candidates[tid]={**t,'_number':n,'_token':token}

    seq={tid:[] for tid in candidates}; matched_stop_times=0
    for r in rows(src/'stop_times.txt'):
        tid=str(r.get('trip_id') or '')
        if tid not in candidates:continue
        try:order=int(float(r.get('stop_sequence') or 0))
        except:order=0
        sid=str(r.get('stop_id') or '')
        seq[tid].append((order,sid,str(r.get('arrival_time') or ''),str(r.get('departure_time') or '')))
        matched_stop_times+=1

    synthetic={}; signatures={}; missing_coords=0
    for tid,t in candidates.items():
        items=sorted(seq.get(tid) or [],key=lambda x:x[0])
        if len(items)<2:continue
        ss=[]; valid=True
        for _,sid,arr,dep in items:
            meta=stops.get(sid)
            if not meta or meta['lat'] is None or meta['lon'] is None:
                missing_coords+=1;valid=False;break
            tm=dep or arr
            ss.append({'name':meta['name'],'lat':meta['lat'],'lon':meta['lon'],'time':tm,'displayTime':tm})
        if not valid or len(ss)<2:continue
        signature=' → '.join(x['name'] for x in ss)
        number=str(t['_number']);dedup=number+'\0'+signature
        if dedup in signatures:continue
        h=hashlib.sha1(dedup.encode()).hexdigest()[:18];sid='LIVEGTFS:'+number+':'+h
        route=routes.get(str(t.get('route_id') or ''),{})
        synthetic[sid]={
            'id':sid,'number':number,'category':'TGV_LIVE_GTFS_STRICT',
            'serviceToken':t['_token'],
            'routeName':str(route.get('route_long_name') or route.get('route_short_name') or 'GTFS SNCF live'),
            'routeShortName':str(route.get('route_short_name') or ''),
            'source':'SNCF_LIVE_GTFS_STRICT_V8','liveGtfs':True,'stops':ss
        }
        signatures[dedup]=sid

    nums={str(t.get('number')) for t in synthetic.values()}
    payload={
        'version':2,'generatedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'source':str(src),'allowedTokens':sorted(ALLOWED_TOKENS),
        'stats':{
            'rawTrips':raw_trip_count,'strictHighSpeedDatedTrips':len(candidates),
            'matchedStopTimes':matched_stop_times,'syntheticTrips':len(synthetic),
            'uniqueSignatures':len({' → '.join(s['name'] for s in t['stops']) for t in synthetic.values()}),
            'missingCoordinates':missing_coords
        },
        'controls':{
            'mustBePresent':{n:(n in nums) for n in ('2509','5454','5460','9577','9242','9706')},
            'mustBeAbsent':{n:(n not in nums) for n in ('879303','839654','68230','427250')}
        },
        'trips':synthetic
    }
    out.parent.mkdir(parents=True,exist_ok=True)
    fd,tmp=tempfile.mkstemp(prefix='live-gtfs-v8.',suffix='.json',dir=str(out.parent));os.close(fd)
    with open(tmp,'w',encoding='utf-8') as fo:json.dump(payload,fo,ensure_ascii=False,separators=(',',':'))
    os.chmod(tmp,0o644);os.replace(tmp,out)
    print(json.dumps({'stats':payload['stats'],'controls':payload['controls']},ensure_ascii=False))

if __name__=='__main__':main()
