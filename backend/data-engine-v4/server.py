#!/usr/bin/env python3
import argparse, json, os, re, sys, threading, time, urllib.parse, urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HOST = os.getenv('LB_DATA_HOST', '127.0.0.1')
PORT = int(os.getenv('LB_DATA_PORT', '3120'))
SNAPSHOT_INTERVAL = max(5, int(os.getenv('LB_SNAPSHOT_INTERVAL_SEC', '15')))
SNAPSHOT_FILE = os.getenv('LB_SNAPSHOT_FILE', '')
STATS_BASE = os.getenv('LB_STATS_BASE', 'http://127.0.0.1:3099').rstrip('/')
TIMEOUT = float(os.getenv('LB_SOURCE_TIMEOUT_SEC', '7'))

SOURCES = {
    'sncfRt': os.getenv('LB_SOURCE_SNCF_RT', ''),
    'cflRt': os.getenv('LB_SOURCE_CFL_RT', ''),
    'cflArrivals': os.getenv('LB_SOURCE_CFL_ARRIVALS', ''),
    'traffic': os.getenv('LB_SOURCE_TRAFFIC', ''),
    'compositions': os.getenv('LB_SOURCE_COMPOSITIONS', ''),
}

ALIAS_GROUPS = [
    ['2870','2871'], ['2864','2865'], ['2806','2807'], ['2872','2873'], ['2816','2817'],
    ['88504','88505'], ['88502','88503'], ['88500','88501'], ['88529','88530'], ['88531','88530'],
    ['88533','88532'], ['88535','88534'], ['88520','88521'], ['88522','88523'], ['88524','88525'],
    ['88526','88527'], ['88528','88529'], ['88510','88511']
]

ADJ = {}
def norm_train(value):
    matches = re.findall(r'\d{3,6}', str(value or ''))
    if not matches:
        return ''
    value = sorted(matches, key=lambda x: (-len(x), x))[0]
    return value.lstrip('0') or '0'

for group in ALIAS_GROUPS:
    vals = [norm_train(x) for x in group if norm_train(x)]
    for a in vals:
        ADJ.setdefault(a, set()).update(v for v in vals if v != a)

def aliases_for(number):
    root = norm_train(number)
    if not root:
        return []
    seen, stack = {root}, [root]
    while stack:
        cur = stack.pop()
        for nxt in ADJ.get(cur, ()):
            if nxt not in seen:
                seen.add(nxt); stack.append(nxt)
    return [root] + sorted(seen - {root})

def read_json(target):
    if not target:
        raise RuntimeError('source non configurée')
    if re.match(r'^https?://', target):
        req = urllib.request.Request(target, headers={'Accept':'application/json','User-Agent':'labetaillere-data-v4/1.0'})
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            return json.loads(r.read().decode('utf-8'))
    path = Path(target)
    with path.open('r', encoding='utf-8') as f:
        return json.load(f)

def safe_num(value):
    try:
        if value is None or isinstance(value, bool): return None
        x = float(value)
        if x != x or x in (float('inf'), float('-inf')): return None
        return x
    except (TypeError, ValueError):
        return None

def parse_delay(value):
    if value is None:
        return {'cancelled': True, 'minutes': None}
    if isinstance(value, (int,float)) and not isinstance(value,bool):
        return {'cancelled': False, 'minutes': float(value)}
    if isinstance(value, str):
        txt = value.strip()
        if re.search(r'cancel|suppr|annul|delete', txt, re.I):
            return {'cancelled': True, 'minutes': None}
        m = re.search(r'[-+]?\d+(?:[.,]\d+)?', txt)
        return {'cancelled': False, 'minutes': float(m.group(0).replace(',','.')) if m else None}
    if isinstance(value, (list,tuple)):
        cancelled, best = False, None
        for item in value:
            p = parse_delay(item)
            cancelled = cancelled or p['cancelled']
            if p['minutes'] is not None and (best is None or abs(p['minutes']) > abs(best)):
                best = p['minutes']
        return {'cancelled': cancelled, 'minutes': best}
    if isinstance(value, dict):
        status = value.get('status') or value.get('state') or value.get('rtStatus') or value.get('rtState') or value.get('note')
        cancelled = bool(status and re.search(r'cancel|suppr|annul|delete', str(status), re.I))
        best = None
        for key in ('delay','minutes','value','rtDelay','delayMinutes','min','rt','realtime','rtMinutes'):
            if key not in value: continue
            p = parse_delay(value.get(key)); cancelled = cancelled or p['cancelled']
            if p['minutes'] is not None and (best is None or abs(p['minutes']) > abs(best)):
                best = p['minutes']
        return {'cancelled': cancelled, 'minutes': best}
    return {'cancelled': False, 'minutes': None}

def normalize_platform(value):
    if value is None: return None
    s = re.sub(r'^(voie|track)\s*', '', str(value).strip(), flags=re.I)
    if not s or re.match(r'^(?:n/?a|nc|null|undefined|-+)$', s, re.I): return None
    return s

def station_name_from_entry(entry):
    if not isinstance(entry, dict): return ''
    return str(entry.get('station') or entry.get('stop') or entry.get('name') or entry.get('label') or '').strip()

def parse_cfl(payload):
    root = payload
    if isinstance(payload, dict):
        for key in ('data','trains','journeys'):
            val = payload.get(key)
            if isinstance(val, dict): root = val; break
    out = {}
    if not isinstance(root, dict): return out
    for label, raw in root.items():
        num = norm_train(label)
        if isinstance(raw, dict): num = norm_train(raw.get('train') or raw.get('train_number') or raw.get('number') or label)
        if not num: continue
        stations = []
        entries = raw if isinstance(raw, list) else list(raw.items()) if isinstance(raw, dict) else []
        if isinstance(raw, list):
            for entry in entries:
                if isinstance(entry, (list,tuple)) and entry:
                    name = str(entry[0]); value = entry[1] if len(entry)>1 else None; meta = value if isinstance(value,dict) else {}
                elif isinstance(entry, dict):
                    name = station_name_from_entry(entry)
                    value = entry.get('delay', entry.get('minutes', entry.get('value', entry.get('rtDelay', entry.get('delayMinutes', entry.get('min', entry.get('rt', entry.get('realtime'))))))))
                    if value is None: value = entry
                    meta = entry
                else: continue
                if not name: continue
                p = parse_delay(value)
                platform = normalize_platform(meta.get('platform') or meta.get('voie') or meta.get('track') or meta.get('quai')) if isinstance(meta,dict) else None
                stations.append({'name':name,'delayMinutes':p['minutes'],'cancelled':p['cancelled'],'platform':platform})
        else:
            for name, value in entries:
                if name in ('train','train_number','number','status','updatedAt','updated_at','generatedAt','timestamp'): continue
                meta = value if isinstance(value,dict) else {}
                p = parse_delay(value)
                platform = normalize_platform(meta.get('platform') or meta.get('voie') or meta.get('track') or meta.get('quai')) if isinstance(meta,dict) else None
                stations.append({'name':str(name),'delayMinutes':p['minutes'],'cancelled':p['cancelled'],'platform':platform})
        if stations: out.setdefault(num, []).extend(stations)
    return out

def parse_arrivals(payload):
    root = payload.get('data') if isinstance(payload,dict) and isinstance(payload.get('data'),dict) else payload
    out = {}
    if not isinstance(root,dict): return out
    for label, raw in root.items():
        if not isinstance(raw,dict): continue
        num = norm_train(raw.get('train') or raw.get('train_number') or raw.get('number') or label)
        if not num: continue
        platform = normalize_platform(raw.get('arrivalPlatformRealtime') or raw.get('arrivalPlatformPlanned') or raw.get('platform') or raw.get('track'))
        out.setdefault(num, []).append({'platform':platform,'arrivalPlanned':raw.get('arrivalPlanned'),'arrivalRealtime':raw.get('arrivalRealtime')})
    return out

def flatten_compositions(payload):
    out = {}
    if not isinstance(payload,dict): return out
    for group in payload.values():
        if not isinstance(group,dict): continue
        for n, code in group.items():
            num = norm_train(n)
            if num and code: out[num] = str(code)
    return out

def normalize_traffic(payload):
    if isinstance(payload,dict) and isinstance(payload.get('situations'),list): items = payload['situations']
    elif isinstance(payload,dict) and isinstance(payload.get('data'),dict) and isinstance(payload['data'].get('situations'),list): items = payload['data']['situations']
    elif isinstance(payload,list): items = payload
    elif isinstance(payload,dict): items = [v for v in payload.values() if isinstance(v,dict)]
    else: items = []
    out=[]
    for i,item in enumerate(items):
        if not isinstance(item,dict): continue
        out.append({'id':str(item.get('situation_number') or item.get('id') or f'traffic-{i}'),'summary':str(item.get('summary') or item.get('title') or ''),'description':str(item.get('detail') or item.get('description') or ''),'participant':item.get('participant_ref'),'scope':item.get('scope_type'),'validity':item.get('validity_periods') if isinstance(item.get('validity_periods'),list) else [],'affects':item.get('affects') if isinstance(item.get('affects'),list) else []})
    return out

def lookup_alias(index, number):
    exact = norm_train(number)
    if exact in index: return exact, index[exact]
    for alias in aliases_for(exact)[1:]:
        if alias in index: return alias, index[alias]
    return None, None

def canonical_station(name):
    s = str(name or '').strip().lower()
    return (s.replace('é','e').replace('è','e').replace('ê','e').replace('à','a').replace('â','a').replace('î','i').replace('ï','i').replace('ô','o').replace('ö','o').replace('ü','u').replace('ù','u').replace('ç','c'))

def cfl_by_station(stations):
    return {canonical_station(x.get('name')): x for x in stations if x.get('name')}

def status_from(raw, delay, station_cancelled=False):
    txt = str(raw or '').upper().replace('-','_').replace(' ','_')
    if re.search(r'CANCEL|SUPPR|ANNUL',txt): return 'cancelled'
    if station_cancelled or re.search(r'PARTIAL|PARTIEL|REDUCED',txt): return 'partial'
    if delay > 0 or re.search(r'DELAY|LATE|RETARD',txt): return 'delay'
    if re.search(r'LIVE|RUNNING',txt): return 'live'
    return 'on-time'

def build_snapshot_from_payloads(payloads, source_meta=None):
    sncf = payloads.get('sncfRt') or {}
    cfl_idx = parse_cfl(payloads.get('cflRt') or {})
    arr_idx = parse_arrivals(payloads.get('cflArrivals') or {})
    comps = flatten_compositions(payloads.get('compositions') or {})
    traffic = normalize_traffic(payloads.get('traffic') or {})
    now = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    trains=[]
    if isinstance(sncf,dict):
        for key, raw in sncf.items():
            if not isinstance(raw,dict): continue
            num = norm_train(raw.get('train_number') or raw.get('train') or key)
            if not num: continue
            raw_stops = raw.get('stops') if isinstance(raw.get('stops'),dict) else {}
            cfl_match, cfl_stations = lookup_alias(cfl_idx, num)
            arr_match, arrivals = lookup_alias(arr_idx, num)
            cfl_map = cfl_by_station(cfl_stations or [])
            stops=[]; max_delay=0.0; any_cancelled=False
            for name, delay_raw in raw_stops.items():
                sncf_delay = safe_num(delay_raw) or 0.0
                cfl = cfl_map.get(canonical_station(name))
                use_cfl = canonical_station(name) in ('luxembourg','howald','bettembourg') and cfl is not None
                delay = cfl.get('delayMinutes') if use_cfl and cfl.get('delayMinutes') is not None else sncf_delay
                cancelled = bool(cfl.get('cancelled')) if use_cfl else False
                platform = cfl.get('platform') if use_cfl else None
                if canonical_station(name) == 'luxembourg' and arrivals:
                    platform = arrivals[0].get('platform') or platform
                delay = float(delay or 0)
                max_delay = max(max_delay, delay)
                any_cancelled = any_cancelled or cancelled
                stops.append({'name':str(name),'delayMinutes':delay,'cancelled':cancelled,'platform':platform,'delaySource':'CFL/HAFAS' if use_cfl else 'SNCF'})
            status = status_from(raw.get('status'), max_delay, any_cancelled)
            comp = comps.get(num)
            dest_platform = stops[-1].get('platform') if stops else None
            trains.append({'id':raw.get('train_id') or f'{num}:{time.strftime("%Y%m%d")}','number':num,'operator':'SNCF','line':'L90','origin':{'name':stops[0]['name']} if stops else None,'destination':{'name':stops[-1]['name'],'platform':dest_platform} if stops else None,'status':status,'delayMinutes':max_delay,'cancelled':status=='cancelled','partial':status=='partial','live':bool(raw.get('live')),'position':raw.get('position'),'composition':{'code':comp,'source':'labetaillere-composition','confidence':'estimated'} if comp else None,'occupancy':raw.get('occupancy') if isinstance(raw.get('occupancy'),dict) else None,'stops':stops,'disruptions':raw.get('disruptions') if isinstance(raw.get('disruptions'),list) else [],'provenance':[{'source':'sncf-gtfs-rt','role':'base','stale':False},*([{'source':'cfl-hafas','role':'enrichment','matchedTrain':cfl_match,'alias':cfl_match!=num,'stale':False}] if cfl_match else []),*([{'source':'cfl-arrivals','role':'platform','matchedTrain':arr_match,'alias':arr_match!=num,'stale':False}] if arr_match else []),*([{'source':'labetaillere-composition','role':'composition','stale':False}] if comp else [])],'updatedAt':now})
    meta = source_meta or []
    return {'apiVersion':4,'updatedAt':now,'stale':any(x.get('stale') for x in meta if isinstance(x,dict)),'sources':meta,'trains':trains,'traffic':traffic,'meta':{'trainCount':len(trains),'delayedCount':sum(1 for t in trains if t['status']=='delay'),'cancelledCount':sum(1 for t in trains if t['status']=='cancelled'),'partialCount':sum(1 for t in trains if t['status']=='partial'),'liveCount':sum(1 for t in trains if t['live']),'trafficCount':len(traffic),'cflTrainCount':len(cfl_idx),'arrivalTrainCount':len(arr_idx),'compositionCount':len(comps)}}

_lock = threading.Lock(); _snapshot = None; _last_error = None

def build_snapshot():
    payloads={}; meta=[]
    for name,target in SOURCES.items():
        started=time.time()
        try:
            data=read_json(target); payloads[name]=data
            meta.append({'name':name,'ok':True,'stale':False,'target':target,'readMs':round((time.time()-started)*1000)})
        except Exception as exc:
            payloads[name]={}
            meta.append({'name':name,'ok':False,'stale':True,'target':target,'error':str(exc),'readMs':round((time.time()-started)*1000)})
    snap=build_snapshot_from_payloads(payloads,meta)
    snap['buildMs']=sum(int(x.get('readMs',0)) for x in meta)
    return snap

def write_snapshot(snapshot):
    if not SNAPSHOT_FILE: return
    path=Path(SNAPSHOT_FILE); path.parent.mkdir(parents=True,exist_ok=True)
    tmp=path.with_name(path.name+'.tmp')
    tmp.write_text(json.dumps(snapshot,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    os.replace(tmp,path)

def refresh_loop():
    global _snapshot,_last_error
    while True:
        try:
            snap=build_snapshot(); write_snapshot(snap)
            with _lock: _snapshot=snap; _last_error=None
        except Exception as exc:
            with _lock: _last_error=str(exc)
        time.sleep(SNAPSHOT_INTERVAL)

def get_snapshot(force=False):
    global _snapshot,_last_error
    if force or _snapshot is None:
        try:
            snap=build_snapshot(); write_snapshot(snap)
            with _lock: _snapshot=snap; _last_error=None
        except Exception as exc:
            with _lock: _last_error=str(exc)
    with _lock: return _snapshot,_last_error

def stats_proxy(path,query):
    mapping={'overview':'/beta/overview','daily':'/beta/daily','causes':'/beta/causes','hourly':'/beta/hourly','compare':'/beta/compare','train':'/gtfs/train','day':'/gtfs/day'}
    endpoint=mapping.get(path)
    if not endpoint: raise RuntimeError('stats endpoint inconnu')
    return read_json(STATS_BASE+endpoint+('?' + query if query else ''))

class Handler(BaseHTTPRequestHandler):
    server_version='LBDataV4/1.0'
    def log_message(self,fmt,*args): sys.stderr.write('[data-v4] '+fmt%args+'\n')
    def send_json(self,status,payload):
        body=json.dumps(payload,ensure_ascii=False,separators=(',',':')).encode()
        self.send_response(status); self.send_header('Content-Type','application/json; charset=utf-8'); self.send_header('Cache-Control','no-store'); self.send_header('Access-Control-Allow-Origin','*'); self.send_header('X-Content-Type-Options','nosniff'); self.send_header('Content-Length',str(len(body))); self.end_headers(); self.wfile.write(body)
    def do_GET(self):
        parsed=urllib.parse.urlsplit(self.path); path=parsed.path.rstrip('/') or '/'
        try:
            snap,err=get_snapshot()
            if path=='/api/v4/health':
                sources=(snap or {}).get('sources',[]); ok=bool(snap and snap.get('trains'))
                self.send_json(200 if ok else 503,{'apiVersion':4,'status':'ok' if ok and all(x.get('ok') for x in sources) else 'degraded','trainCount':len((snap or {}).get('trains',[])),'updatedAt':(snap or {}).get('updatedAt'),'snapshotFile':SNAPSHOT_FILE or None,'error':err,'sources':sources}); return
            if path=='/api/v4/snapshot': self.send_json(200,snap or {'apiVersion':4,'trains':[],'error':err}); return
            if path=='/api/v4/trains': self.send_json(200,{'apiVersion':4,'updatedAt':snap.get('updatedAt'),'trains':snap.get('trains',[])}); return
            if path.startswith('/api/v4/trains/'):
                num=norm_train(path.split('/')[-1]); train=next((t for t in snap.get('trains',[]) if t.get('number')==num),None)
                self.send_json(200 if train else 404,train or {'error':'train not found'}); return
            if path=='/api/v4/traffic': self.send_json(200,{'apiVersion':4,'updatedAt':snap.get('updatedAt'),'traffic':snap.get('traffic',[])}); return
            if path.startswith('/api/v4/stats/'):
                name=path.split('/')[-1]; self.send_json(200,stats_proxy(name,parsed.query)); return
            self.send_json(404,{'error':'not found'})
        except Exception as exc: self.send_json(500,{'error':str(exc)})

def fixture_self_test():
    payloads={'sncfRt':{'88530':{'train_id':'x','train_number':'88530','status':'ON_TIME','stops':{'Luxembourg':10,'Howald':10,'Bettembourg':10,'Thionville':8,'Metz':8,'Nancy':7}},'88742':{'train_id':'y','train_number':'88742','status':'ON_TIME','stops':{'Metz':0,'Hagondange':0,'Uckange':0,'Thionville':0,'Hettange-Grande':0,'Bettembourg':0,'Luxembourg':0}}},'cflRt':{'data':{'88529':{'Luxembourg':{'delay':12,'platform':'4'},'Howald':12,'Bettembourg':11},'88742':{'Bettembourg':1,'Luxembourg':2}}},'cflArrivals':{'data':{'TER 88529':{'train':'88529','arrivalPlatformRealtime':'4'},'TER 88742':{'train':'88742','arrivalPlatformRealtime':'8'}}},'traffic':{'situations':[{'situation_number':'S1','summary':'Test'}]},'compositions':{'NancyMetzLux':{'88742':'US5'},'LuxMetzNancy':{'88530':'UM'}}}
    snap=build_snapshot_from_payloads(payloads,[])
    a=next(t for t in snap['trains'] if t['number']=='88530'); b=next(t for t in snap['trains'] if t['number']=='88742')
    assert next(s for s in a['stops'] if s['name']=='Luxembourg')['delayMinutes']==12
    assert a['destination']['platform'] is None
    assert next(s for s in a['stops'] if s['name']=='Luxembourg')['platform']=='4'
    assert next(s for s in a['stops'] if s['name']=='Thionville')['delayMinutes']==8
    assert next(s for s in b['stops'] if s['name']=='Luxembourg')['platform']=='8'
    assert next(s for s in b['stops'] if s['name']=='Bettembourg')['delayMinutes']==1
    assert b['composition']['code']=='US5'
    return snap

def main():
    p=argparse.ArgumentParser(); p.add_argument('--fixture-test',action='store_true'); p.add_argument('--self-test',action='store_true'); args=p.parse_args()
    if args.fixture_test:
        snap=fixture_self_test(); print(json.dumps({'ok':True,'meta':snap['meta']},ensure_ascii=False)); return
    if args.self_test:
        snap=build_snapshot(); required={'sncfRt','cflRt','cflArrivals','traffic'}
        bad=[s for s in snap['sources'] if s['name'] in required and not s.get('ok')]
        ok=not bad and len(snap['trains'])>0
        print(json.dumps({'ok':ok,'meta':snap['meta'],'sources':snap['sources']},ensure_ascii=False,indent=2)); raise SystemExit(0 if ok else 2)
    fixture_self_test(); snap,err=get_snapshot(force=True)
    if not snap or not snap.get('trains'): raise SystemExit('Data Engine V4: aucun train au démarrage; refus de servir')
    threading.Thread(target=refresh_loop,daemon=True).start()
    print(f'Data Engine V4 listening on http://{HOST}:{PORT} | trains={len(snap["trains"])} | snapshot={SNAPSHOT_FILE or "off"}',flush=True)
    ThreadingHTTPServer((HOST,PORT),Handler).serve_forever()

if __name__=='__main__': main()
