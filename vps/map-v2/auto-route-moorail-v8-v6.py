#!/usr/bin/env python3
import argparse, json, math, os, re, heapq, tempfile, datetime
from pathlib import Path
from collections import Counter, defaultdict

LGV_CORE_CODES={
    '005000','014000','216000','226000','431000','429000','408000',
    '566000','752000','834000','834100'
}
LGV_CONNECTOR_PREFIXES=(
    '0053','0143','2163','2263','4313','4293','4083','5663','7523','8343'
)


def atomic_json(path, value, mode=0o644):
    path=Path(path); path.parent.mkdir(parents=True,exist_ok=True)
    fd,tmp=tempfile.mkstemp(prefix=path.name+'.',suffix='.tmp',dir=str(path.parent)); os.close(fd)
    with open(tmp,'w',encoding='utf-8') as f: json.dump(value,f,ensure_ascii=False,indent=2)
    os.chmod(tmp,mode); os.replace(tmp,path)


def hav(a,b):
    # [lon,lat] -> metres
    R=6371000.0
    p1=math.radians(a[1]); p2=math.radians(b[1])
    dp=math.radians(b[1]-a[1]); dl=math.radians(b[0]-a[0])
    x=math.sin(dp/2)**2+math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
    return 2*R*math.asin(min(1.0,math.sqrt(max(0.0,x))))


def node_key(c): return f'{c[0]:.6f},{c[1]:.6f}'


def props_text(props):
    try: return json.dumps(props or {},ensure_ascii=False,separators=(',',':')).upper()
    except: return ''


def rail_codes(props):
    txt=props_text(props)
    nums=set(re.findall(r'(?<!\d)(\d{6})(?!\d)',txt))
    return nums


def is_lgv(props):
    txt=props_text(props)
    if re.search(r'\bLGV\b|GRANDE VITESSE|LIGNE NOUVELLE',txt): return True
    nums=rail_codes(props)
    if nums & LGV_CORE_CODES: return True
    return any(any(n.startswith(p) for p in LGV_CONNECTOR_PREFIXES) for n in nums)


def project_to_seg(point,seg):
    lon,lat=point; a=seg['a']; b=seg['b']
    cl=math.cos(math.radians(lat))
    x=(lon-a[0])*cl; y=lat-a[1]
    vx=(b[0]-a[0])*cl; vy=b[1]-a[1]
    den=vx*vx+vy*vy
    t=(x*vx+y*vy)/den if den else 0.0
    t=max(0.0,min(1.0,t))
    p=[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t]
    return p,t,hav(point,p)


class RFNRouter:
    def __init__(self,rfn_root):
        self.root=Path(rfn_root)
        mf=json.load(open(self.root/'manifest.json',encoding='utf-8'))
        self.cell_size=float(mf.get('cellSize') or .2)
        self.cell_cache={}

    def load_cell(self,x,y):
        k=(x,y)
        if k in self.cell_cache:return self.cell_cache[k]
        p=self.root/'cells'/f'c_{x}_{y}.geojson'
        if not p.exists():
            self.cell_cache[k]=[];return []
        try:
            g=json.load(open(p,encoding='utf-8'))
            f=g.get('features') or []
        except Exception:
            f=[]
        self.cell_cache[k]=f
        return f

    def cell_coords(self,a,b,scale):
        cs=self.cell_size
        lon1,lat1=a;lon2,lat2=b
        lon_pad=max(.30,abs(lon2-lon1)*.08)*scale
        lat_pad=max(.25,abs(lat2-lat1)*.45)*scale
        x0=math.floor((min(lon1,lon2)-lon_pad)/cs)-1
        x1=math.floor((max(lon1,lon2)+lon_pad)/cs)+1
        y0=math.floor((min(lat1,lat2)-lat_pad)/cs)-1
        y1=math.floor((max(lat1,lat2)+lat_pad)/cs)+1
        return [(x,y) for x in range(x0,x1+1) for y in range(y0,y1+1)]

    def graph(self,a,b,scale):
        nodes={};adj=defaultdict(list);segments=[];seen=set();cells=0;features=0
        for x,y in self.cell_coords(a,b,scale):
            fs=self.load_cell(x,y)
            if fs: cells+=1
            for fi,f in enumerate(fs):
                geom=f.get('geometry') or {}
                if geom.get('type')!='LineString':continue
                coords=geom.get('coordinates') or []
                if len(coords)<2:continue
                features+=1;props=f.get('properties') or {};lgv=is_lgv(props);codes=rail_codes(props)
                for j in range(len(coords)-1):
                    try:
                        p=[float(coords[j][0]),float(coords[j][1])]
                        q=[float(coords[j+1][0]),float(coords[j+1][1])]
                    except: continue
                    ak=node_key(p);bk=node_key(q)
                    edge_key=(min(ak,bk),max(ak,bk),lgv)
                    if edge_key in seen:continue
                    seen.add(edge_key)
                    w=hav(p,q)
                    if not math.isfinite(w) or w<=0:continue
                    cost=w*.34 if lgv else w
                    nodes.setdefault(ak,{'lon':p[0],'lat':p[1]})
                    nodes.setdefault(bk,{'lon':q[0],'lat':q[1]})
                    seg={'a':p,'b':q,'aKey':ak,'bKey':bk,'w':w,'cost':cost,'lgv':lgv,'codes':codes}
                    segments.append(seg)
                    adj[ak].append((bk,cost,w,lgv,seg))
                    adj[bk].append((ak,cost,w,lgv,seg))
        return {'nodes':nodes,'adj':adj,'segments':segments,'cells':cells,'features':features}

    def anchor(self,point,graph):
        c=[];best=None
        for s in graph['segments']:
            p,t,d=project_to_seg(point,s)
            item=(d,s,p,t)
            if best is None or d<best[0]:best=item
            if d<=900:c.append(item)
        c.sort(key=lambda z:z[0]);keep=c[:18]
        if not keep and best:keep=[best]
        if not keep:return None
        nearest=keep[0]
        links=[]
        for d,s,p,t in keep:
            links.append((s['aKey'],s['cost']*t+d,s['w']*t,s['lgv']))
            links.append((s['bKey'],s['cost']*(1-t)+d,s['w']*(1-t),s['lgv']))
        return {'point':point,'rail':nearest[2],'snap':nearest[0],'links':links}

    def dijkstra(self,A,B,graph):
        dist={};prev={};heap=[];goals={}
        for node,cost,phys,lgv in A['links']:
            if cost<dist.get(node,float('inf')):
                dist[node]=cost;prev[node]=None;heapq.heappush(heap,(cost,node))
        for node,cost,phys,lgv in B['links']:
            old=goals.get(node)
            if old is None or cost<old[0]:goals[node]=(cost,phys,lgv)
        best=float('inf');end=None;end_goal=None
        while heap:
            d,u=heapq.heappop(heap)
            if d!=dist.get(u):continue
            if d>=best:break
            if u in goals:
                gc,gp,gl=goals[u]
                if d+gc<best:best=d+gc;end=u;end_goal=(gp,gl)
            for v,cost,phys,lgv,seg in graph['adj'].get(u,[]):
                nd=d+cost
                if nd<dist.get(v,float('inf')):
                    dist[v]=nd;prev[v]=(u,phys,lgv);heapq.heappush(heap,(nd,v))
        if end is None:return None
        keys=[];edge_meta=[];u=end
        while u is not None:
            keys.append(u)
            pe=prev.get(u)
            if pe is None:break
            pu,phys,lgv=pe;edge_meta.append((phys,lgv));u=pu
        keys.reverse();edge_meta.reverse()
        coords=[A['point']]
        for k in keys:
            n=graph['nodes'][k];pt=[n['lon'],n['lat']]
            if coords[-1]!=pt:coords.append(pt)
        if coords[-1]!=B['point']:coords.append(B['point'])
        physical=sum(hav(x,y) for x,y in zip(coords,coords[1:]))
        lgv_phys=sum(p for p,l in edge_meta if l)
        if end_goal and end_goal[1]:lgv_phys+=end_goal[0]
        return {'coords':coords,'physical':physical,'lgvPhysical':lgv_phys,'weighted':best}

    def route(self,a,b):
        last=None
        for scale in (1.0,1.5,2.2):
            g=self.graph(a,b,scale)
            if not g['segments']:
                last={'error':'NO_SEGMENTS','scale':scale};continue
            A=self.anchor(a,g);B=self.anchor(b,g)
            if not A or not B:
                last={'error':'NO_ANCHOR','scale':scale};continue
            r=self.dijkstra(A,B,g)
            if not r:
                last={'error':'NO_PATH','scale':scale,'snapA':A['snap'],'snapB':B['snap']};continue
            r.update({'scale':scale,'snapA':A['snap'],'snapB':B['snap'],'cells':g['cells'],'features':g['features'],'segments':len(g['segments'])})
            return r
        return last or {'error':'NO_PATH'}


def expected_lgv(task,geo_km):
    if geo_km<60:return False
    c=str(task.get('corridor') or '').upper()
    hot=('LGV','ATLANTIQUE','OUEST','INTERCONNEXION','SUD_EST','RACCORDEMENT_EST','NORD_RACCORDEMENT')
    return any(x in c for x in hot)


def assess(task,result):
    if not result or result.get('error'):
        return False,[str((result or {}).get('error') or 'NO_RESULT')],{}
    a=[float(task['from']['lon']),float(task['from']['lat'])]
    b=[float(task['to']['lon']),float(task['to']['lat'])]
    geo=hav(a,b)/1000.0;km=result['physical']/1000.0
    ratio=km/max(geo,.001);lgv=result['lgvPhysical']/max(result['physical'],1.0)
    reasons=[]
    if result['snapA']>900 or result['snapB']>900:reasons.append('SNAP>900M')
    if km+0.05<geo*.985:reasons.append('PATH<GEODESIC')
    if geo<10:max_ratio=4.0
    elif geo<40:max_ratio=2.5
    elif geo<120:max_ratio=2.0
    else:max_ratio=1.65
    if ratio>max_ratio:reasons.append(f'DETOUR>{max_ratio:.2f}')
    if expected_lgv(task,geo) and geo>=80 and lgv<.18:reasons.append('LGV_SHARE<18%')
    if str(task.get('corridor') or '')=='AUTRE_A_VERIFIER' and geo>50 and lgv<.15 and ratio>1.20:
        reasons.append('AUTRE_LONG_AMBIGU')
    if len(result.get('coords') or [])<2:reasons.append('GEOMETRY_EMPTY')
    metrics={'geoKm':round(geo,3),'routeKm':round(km,3),'ratio':round(ratio,4),'lgvShare':round(lgv,4),
             'snapA':round(result['snapA'],1),'snapB':round(result['snapB'],1),'scale':result['scale'],
             'cells':result.get('cells',0),'features':result.get('features',0),'segments':result.get('segments',0)}
    return not reasons,reasons,metrics


def route_id(task):return str(task.get('routeId') or 'network-autre')


def save_candidate(state,task,result,metrics):
    now=datetime.datetime.now(datetime.timezone.utc).isoformat()
    sid=str(task['sectionId']);rid=route_id(task)
    sec={
      'routeId':rid,'sectionId':sid,'status':'validated','source':'MOORAIL_VALIDATED_SECTIONS_V8',
      'validationEngine':'ROUTER_V6','canonical':True,'canonicalSectionId':sid,
      'corridor':task.get('corridor'),'autoValidated':True,'autoValidatedAt':now,
      'route':{'origin':'Réseau','destination':task.get('corridorLabel') or task.get('corridor'),'signature':task.get('corridor')},
      'stopFrom':task.get('from'),'stopTo':task.get('to'),'waypoints':[],
      'coordinates':result['coords'],'distanceKm':metrics['routeKm'],
      'validationMeta':{'method':'RFN_V6_BATCH','metrics':metrics,'impactToday':task.get('impactToday',0),'trainNumbers':task.get('trainNumbers',[])[:30]},
      'updatedAt':now
    }
    state.setdefault('sections',{})[sid]=sec
    r=state.setdefault('routes',{}).setdefault(rid,{'id':rid,'origin':'Réseau','destination':task.get('corridor'),'signature':task.get('corridor'),'sectionIds':[]})
    if sid not in r['sectionIds']:r['sectionIds'].append(sid)
    r['updatedAt']=now;state['updatedAt']=now


def norm(s):
    import unicodedata
    s=unicodedata.normalize('NFKD',str(s or ''))
    return ''.join(c for c in s if not unicodedata.combining(c)).strip().lower()


def export_live(state,out_path):
    best={}
    def keep(k,v):
        old=best.get(k)
        if old is None or str(v.get('updatedAt') or '')>=str(old.get('updatedAt') or ''):best[k]=v
    for sid,s in (state.get('sections') or {}).items():
        if not isinstance(s,dict) or s.get('status')!='validated':continue
        a=(s.get('stopFrom') or {}).get('name');b=(s.get('stopTo') or {}).get('name');raw=s.get('coordinates') or []
        if not a or not b or len(raw)<2:continue
        coords=[]
        for c in raw:
            if not isinstance(c,(list,tuple)) or len(c)<2:continue
            try:lon=float(c[0]);lat=float(c[1])
            except:continue
            if not (-180<=lon<=180 and -90<=lat<=90):continue
            p=[lat,lon]
            if not coords or p!=coords[-1]:coords.append(p)
        if len(coords)<2:continue
        upd=str(s.get('updatedAt') or '')
        keep((norm(a),norm(b)),{'from':a,'to':b,'coords':coords,'sectionId':sid,'updatedAt':upd,'reversed':False})
        keep((norm(b),norm(a)),{'from':b,'to':a,'coords':list(reversed(coords)),'sectionId':sid,'updatedAt':upd,'reversed':True})
    payload={'version':1,'generatedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'pairs':list(best.values())}
    atomic_json(out_path,payload,0o644)
    return len(payload['pairs'])


def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--root',default='/opt/labetaillere-map-v2-src/map-v2')
    ap.add_argument('--network',default=None)
    ap.add_argument('--report',default=None)
    ap.add_argument('--apply',action='store_true')
    ap.add_argument('--min-impact',type=int,default=1)
    ap.add_argument('--max-tasks',type=int,default=0)
    args=ap.parse_args()
    root=Path(args.root)
    network=Path(args.network) if args.network else root/'public/data/moorail-network-v8/network.json'
    report=Path(args.report) if args.report else root/'data/route-editor/moorail-v8-v6-auto-route-report.json'
    state_path=root/'data/route-editor/moorail-route-editor-state-v1.json'
    live_path=root/'public/data/moorail-live-v1/sections.json'
    rfn=root/'public/data/moorail-rfn-game-v2'
    for p in (network,state_path,rfn/'manifest.json',rfn/'cells'):
        if not p.exists():raise SystemExit('Absent: '+str(p))
    net=json.load(open(network,encoding='utf-8'));state=json.load(open(state_path,encoding='utf-8'))
    tasks=[x for x in (net.get('tasks') or []) if x.get('status') in ('TODO','LEGACY') and int(x.get('impactToday') or 0)>=args.min_impact]
    tasks.sort(key=lambda x:(-int(x.get('impactToday') or 0),0 if x.get('status')=='TODO' else 1,x.get('corridorLabel') or '',x.get('sectionId') or ''))
    if args.max_tasks>0:tasks=tasks[:args.max_tasks]
    router=RFNRouter(rfn)
    results=[];accepted=0;rejected=0;applied=0;reasons=Counter()
    total=len(tasks)
    for i,t in enumerate(tasks,1):
        a=t.get('from') or {};b=t.get('to') or {}
        try:A=[float(a['lon']),float(a['lat'])];B=[float(b['lon']),float(b['lat'])]
        except Exception:
            item={'sectionId':t.get('sectionId'),'from':a.get('name'),'to':b.get('name'),'status':t.get('status'),'impactToday':t.get('impactToday'),'accepted':False,'reasons':['BAD_COORDS']}
            results.append(item);rejected+=1;reasons['BAD_COORDS']+=1;continue
        print(f"[{i:03d}/{total:03d}] {t.get('status'):6s} impact={int(t.get('impactToday') or 0):3d} | {a.get('name')} -> {b.get('name')}",flush=True)
        r=router.route(A,B);ok,why,metrics=assess(t,r)
        if ok:accepted+=1
        else:
            rejected+=1
            for x in why:reasons[x]+=1
        item={'sectionId':t.get('sectionId'),'from':a.get('name'),'to':b.get('name'),'corridor':t.get('corridor'),'status':t.get('status'),
              'impactToday':int(t.get('impactToday') or 0),'trainNumbers':t.get('trainNumbers') or [],'accepted':ok,'reasons':why,'metrics':metrics}
        results.append(item)
        if ok and args.apply:
            save_candidate(state,t,r,metrics);applied+=1
            print(f"   ✅ AUTO-V8 {metrics['routeKm']:.1f} km | LGV {metrics['lgvShare']*100:.0f}% | ratio {metrics['ratio']:.2f}",flush=True)
        elif ok:
            print(f"   ✅ candidat {metrics['routeKm']:.1f} km | LGV {metrics['lgvShare']*100:.0f}% | ratio {metrics['ratio']:.2f}",flush=True)
        else:
            print('   🟠 revue manuelle : '+', '.join(why),flush=True)
    live_count=None
    if args.apply and applied:
        atomic_json(state_path,state,0o664)
        live_count=export_live(state,live_path)
    payload={'version':'8.3','generatedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'apply':args.apply,
             'tasksConsidered':total,'accepted':accepted,'rejected':rejected,'applied':applied,'livePairs':live_count,
             'reasonCounts':dict(reasons),'lgvCodes':sorted(LGV_CORE_CODES),'results':results}
    atomic_json(report,payload,0o644)
    print(json.dumps({k:payload[k] for k in ('tasksConsidered','accepted','rejected','applied','livePairs','reasonCounts')},ensure_ascii=False))

if __name__=='__main__':main()
