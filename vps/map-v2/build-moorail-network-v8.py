#!/usr/bin/env python3
import argparse,csv,json,re,hashlib,datetime,os,tempfile,unicodedata
from pathlib import Path
from collections import defaultdict
from zoneinfo import ZoneInfo

ALLOWED_TOKENS={'OUI','OGO','LYR','ICE','TRN','TGV','THA','EUR'}
TOKEN_RE=re.compile(r'^[^:]+:([A-Z0-9]+):')
NUM_RE=re.compile(r'^\s*(\d{2,6})\s*$')
ID_NUM_RE=re.compile(r'^OCESN(\d{2,6})',re.I)
V6_AT='2026-09-09T06:20:50'

SPINES=[
 {'id':'LGV_EST','label':'LGV Est','nodes':[
  ['Paris Est'],['Champagne-Ardenne TGV'],['Meuse TGV'],['Lorraine TGV'],['Strasbourg'],['Karlsruhe Hbf']
 ]},
 {'id':'INTERCONNEXION_EST','label':'Interconnexion Est','nodes':[
  ['Massy TGV'],['Marne-la-Vallée Chessy','Marne la Vallée Chessy'],['Aéroport Charles de Gaulle 2 TGV','Aeroport Charles de Gaulle 2 TGV'],['Champagne-Ardenne TGV']
 ]},
 {'id':'LGV_NORD_INTERCO','label':'LGV Nord / Interconnexion','nodes':[
  ['Bruxelles Midi','Bruxelles-Midi'],['Lille Europe'],['TGV Haute-Picardie','Haute-Picardie TGV'],['Aéroport Charles de Gaulle 2 TGV','Aeroport Charles de Gaulle 2 TGV'],['Marne-la-Vallée Chessy','Marne la Vallée Chessy'],['Massy TGV']
 ]},
 {'id':'LGV_ATLANTIQUE_BPL','label':'LGV Atlantique / BPL Rennes','nodes':[
  ['Massy TGV'],['Le Mans'],['Laval'],['Rennes']
 ]},
 {'id':'LGV_ATLANTIQUE_NANTES','label':'LGV Atlantique / Nantes','nodes':[
  ['Massy TGV'],['Le Mans'],['Angers Saint-Laud','Angers St-Laud'],['Nantes']
 ]},
 {'id':'LGV_ATLANTIQUE_SEA','label':'LGV Atlantique / SEA','nodes':[
  ['Massy TGV'],['Saint-Pierre-des-Corps','St-Pierre-des-Corps'],['Poitiers'],['Angoulême','Angouleme'],['Bordeaux Saint-Jean','Bordeaux St-Jean']
 ]},
 {'id':'LGV_SUD_EST','label':'LGV Sud-Est / Méditerranée','nodes':[
  ['Paris Gare de Lyon','Paris-Gare-de-Lyon'],['Le Creusot - Montceau-les-Mines - Montchanin TGV','Le Creusot TGV'],['Mâcon-Loché TGV','Macon-Loche TGV'],['Lyon Part Dieu','Lyon Part-Dieu'],['Valence TGV Rhône-Alpes Sud','Valence TGV'],['Avignon TGV'],['Aix-en-Provence TGV'],['Marseille Saint-Charles','Marseille St-Charles']
 ]},
 {'id':'LGV_RHIN_RHONE','label':'LGV Rhin-Rhône','nodes':[
  ['Dijon Ville','Dijon'],['Besançon Franche-Comté TGV','Besancon Franche-Comte TGV'],['Belfort-Montbéliard TGV','Belfort-Montbeliard TGV'],['Mulhouse'],['Strasbourg']
 ]},
 {'id':'MEDITERRANEE_COTE_AZUR','label':'Méditerranée / Côte d’Azur','nodes':[
  ['Marseille Saint-Charles','Marseille St-Charles'],['Toulon'],['Les Arcs - Draguignan','Les Arcs Draguignan'],['Saint-Raphaël Valescure','Saint-Raphael Valescure'],['Cannes'],['Antibes'],['Nice-Ville','Nice Ville']
 ]},
 {'id':'LANGUEDOC','label':'Arc méditerranéen','nodes':[
  ['Avignon TGV'],['Nîmes Pont du Gard','Nimes Pont du Gard'],['Montpellier Sud de France'],['Béziers','Beziers'],['Narbonne'],['Perpignan'],['Figueres Vilafant'],['Girona'],['Barcelona Sants']
 ]},
 {'id':'ALPES_ITALIE','label':'Alpes / Italie','nodes':[
  ['Lyon Part Dieu','Lyon Part-Dieu'],['Chambéry - Challes-les-Eaux','Chambery - Challes-les-Eaux'],['Modane'],['Torino Porta Susa','Turin Porta Susa'],['Milano Porta Garibaldi','Milan']
 ]},
]

def rows(path):
    with path.open('r',encoding='utf-8-sig',errors='replace',newline='') as f:
        yield from csv.DictReader(f)

def norm(s):
    s=unicodedata.normalize('NFKD',str(s or ''))
    return ''.join(c for c in s if not unicodedata.combining(c)).strip().lower()

def token_for_trip_id(tid):
    m=TOKEN_RE.match(str(tid or '').upper())
    return m.group(1) if m else ''

def num_for(t):
    for k in ('trip_short_name','trip_headsign'):
        m=NUM_RE.match(str(t.get(k) or ''))
        if m:return m.group(1)
    m=ID_NUM_RE.search(str(t.get('trip_id') or ''))
    return m.group(1) if m else str(t.get('trip_short_name') or t.get('trip_id') or '')

def atomic_json(path,value,mode=0o644):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    fd,tmp=tempfile.mkstemp(prefix=path.name+'.',suffix='.tmp',dir=str(path.parent));os.close(fd)
    with open(tmp,'w',encoding='utf-8') as f:json.dump(value,f,ensure_ascii=False,indent=2)
    os.chmod(tmp,mode);os.replace(tmp,path)

def canonical_id(a,b):
    aa,bb=sorted((norm(a),norm(b)))
    return 'sec-'+hashlib.sha1((aa+'\0'+bb).encode()).hexdigest()[:16]

def route_id_for(corridor):
    return 'network-'+str(corridor or 'AUTRE').lower().replace('_','-')

def index_spines():
    out=[]
    for sp in SPINES:
        nodes=[]
        for aliases in sp['nodes']:
            nodes.append({'label':aliases[0],'aliases':aliases,'norms':{norm(x) for x in aliases}})
        out.append({**sp,'_nodes':nodes})
    return out
SPX=index_spines()

def match_node(name,node):
    n=norm(name)
    if n in node['norms']:return True
    return any(len(a)>=8 and (n==a or n.startswith(a+' ') or a.startswith(n+' ')) for a in node['norms'])

def spine_expansion(a,b):
    candidates=[]
    for sp in SPX:
        ai=[i for i,node in enumerate(sp['_nodes']) if match_node(a,node)]
        bi=[i for i,node in enumerate(sp['_nodes']) if match_node(b,node)]
        for i in ai:
            for j in bi:
                if i!=j:candidates.append((abs(j-i),sp,i,j))
    if not candidates:return None
    _,sp,i,j=min(candidates,key=lambda x:(x[0],x[1]['id']))
    step=1 if j>i else -1
    edges=[]
    for k in range(i,j,step):
        n1=sp['_nodes'][k];n2=sp['_nodes'][k+step]
        edges.append((n1['label'],n2['label'],sp['id'],sp['label']))
    return edges

def infer_corridor(a,b):
    ex=spine_expansion(a,b)
    if ex:return ex[0][2]
    text=norm(a)+' '+norm(b)
    if any(x in text for x in ('nancy','metz','sarrebourg','saverne')):return 'RACCORDEMENT_EST'
    if any(x in text for x in ('lille','arras','bruxelles')):return 'LGV_NORD_RACCORDEMENT'
    if any(x in text for x in ('rennes','nantes','le mans','laval','angers')):return 'OUEST_RACCORDEMENT'
    if any(x in text for x in ('bordeaux','poitiers','angouleme','tours','saint-pierre')):return 'ATLANTIQUE_RACCORDEMENT'
    if any(x in text for x in ('lyon','marseille','avignon','valence')):return 'SUD_EST_RACCORDEMENT'
    return 'AUTRE_A_VERIFIER'

def active_services(gtfs,today):
    ymd=today.strftime('%Y%m%d');weekday=['monday','tuesday','wednesday','thursday','friday','saturday','sunday'][today.weekday()]
    active=set();cal=gtfs/'calendar.txt'
    if cal.exists():
        for r in rows(cal):
            if str(r.get('start_date',''))<=ymd<=str(r.get('end_date','')) and str(r.get(weekday,'0'))=='1':active.add(str(r.get('service_id') or ''))
    cd=gtfs/'calendar_dates.txt'
    if cd.exists():
        for r in rows(cd):
            if str(r.get('date') or '')!=ymd:continue
            sid=str(r.get('service_id') or '');typ=str(r.get('exception_type') or '')
            if typ=='1':active.add(sid)
            elif typ=='2':active.discard(sid)
    return active

def best_legacy_by_pair(state):
    best={}
    for sid,s in (state.get('sections') or {}).items():
        if not isinstance(s,dict) or s.get('status')!='validated' or not isinstance(s.get('coordinates'),list) or len(s['coordinates'])<2:continue
        a=(s.get('stopFrom') or {}).get('name');b=(s.get('stopTo') or {}).get('name')
        if not a or not b:continue
        cid=canonical_id(a,b);old=best.get(cid)
        if not old or str(s.get('updatedAt') or '')>=str(old[1].get('updatedAt') or ''):best[cid]=(sid,s)
    return best

def migrate_state(state):
    state.setdefault('sections',{});state.setdefault('routes',{})
    best=best_legacy_by_pair(state);created=0;upgraded=0
    now=datetime.datetime.now(datetime.timezone.utc).isoformat()
    for cid,(sid,s) in best.items():
        if cid in state['sections']:
            continue
        a=(s.get('stopFrom') or {}).get('name');b=(s.get('stopTo') or {}).get('name')
        corridor=s.get('corridor') or infer_corridor(a,b)
        engine='ROUTER_V6' if str(s.get('updatedAt') or '')[:19]>=V6_AT else 'LEGACY_MIGRATED'
        sec=dict(s)
        sec.update({
            'routeId':route_id_for(corridor),'sectionId':cid,'canonical':True,'canonicalSectionId':cid,
            'corridor':corridor,'validationEngine':engine,'migratedFrom':sid,
            'source':'MOORAIL_VALIDATED_SECTIONS_V8_MIGRATION',
            'updatedAt':str(s.get('updatedAt') or now)
        })
        state['sections'][cid]=sec
        rid=sec['routeId'];r=state['routes'].setdefault(rid,{'id':rid,'origin':'Réseau','destination':corridor,'signature':corridor,'sectionIds':[]})
        if cid not in r['sectionIds']:r['sectionIds'].append(cid)
        r['updatedAt']=now;created+=1
        if engine=='ROUTER_V6':upgraded+=1
    if created:
        state['updatedAt']=now
    return created,upgraded

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--root',default='/opt/labetaillere-map-v2-src/map-v2')
    ap.add_argument('--gtfs',default='/var/www/html/gtfs/static')
    ap.add_argument('--output',default=None)
    ap.add_argument('--migrate-state',action='store_true')
    args=ap.parse_args()
    root=Path(args.root);gtfs=Path(args.gtfs)
    state_path=root/'data/route-editor/moorail-route-editor-state-v1.json'
    output=Path(args.output) if args.output else root/'public/data/moorail-network-v8/network.json'
    for p in (gtfs/'trips.txt',gtfs/'stop_times.txt',gtfs/'stops.txt',state_path):
        if not p.exists():raise SystemExit(f'absent: {p}')
    state=json.load(open(state_path,encoding='utf-8'))
    migrated=upgraded=0
    if args.migrate_state:
        migrated,upgraded=migrate_state(state)
        if migrated:atomic_json(state_path,state,0o664)

    today=datetime.datetime.now(ZoneInfo('Europe/Paris')).date();active=active_services(gtfs,today)
    routes={}
    if (gtfs/'routes.txt').exists():
        for r in rows(gtfs/'routes.txt'):routes[str(r.get('route_id') or '')]=r
    stops={}
    for s in rows(gtfs/'stops.txt'):
        sid=str(s.get('stop_id') or '')
        if not sid:continue
        try:lat=float(s.get('stop_lat'));lon=float(s.get('stop_lon'))
        except:continue
        stops[sid]={'name':str(s.get('stop_name') or sid),'lat':lat,'lon':lon}

    trips={};token_counts=defaultdict(int)
    for t in rows(gtfs/'trips.txt'):
        if active and str(t.get('service_id') or '') not in active:continue
        tid=str(t.get('trip_id') or '');token=token_for_trip_id(tid)
        if token not in ALLOWED_TOKENS:continue
        token_counts[token]+=1
        trips[tid]={'number':num_for(t),'token':token,'route':routes.get(str(t.get('route_id') or ''),{}),'service':str(t.get('service_id') or '')}
    seq=defaultdict(list)
    for r in rows(gtfs/'stop_times.txt'):
        tid=str(r.get('trip_id') or '')
        if tid not in trips:continue
        try:o=int(float(r.get('stop_sequence') or 0))
        except:o=0
        sid=str(r.get('stop_id') or '')
        if sid in stops:seq[tid].append((o,stops[sid]))

    stop_by_norm={norm(m['name']):m for m in stops.values()}
    demand={}
    def add_edge(a,b,corridor,label,trip):
        cid=canonical_id(a['name'],b['name'])
        d=demand.setdefault(cid,{
            'id':cid,'sectionId':cid,'routeId':route_id_for(corridor),'corridor':corridor,'corridorLabel':label,
            'from':dict(a),'to':dict(b),'tripIds':set(),'trainNumbers':set(),'tokens':set(),'derivedFrom':set()
        })
        d['tripIds'].add(trip['tid']);d['trainNumbers'].add(trip['number']);d['tokens'].add(trip['token'])
    def station_meta(label, fallback):
        if norm(fallback['name'])==norm(label):return dict(fallback)
        meta=stop_by_norm.get(norm(label))
        if meta:return dict(meta)
        return {'name':label,'lat':fallback['lat'],'lon':fallback['lon']}

    selected_numbers=set();valid_trip_count=0
    for tid,t in trips.items():
        ss=[m for _,m in sorted(seq.get(tid) or [],key=lambda x:x[0])]
        if len(ss)<2:continue
        valid_trip_count+=1;selected_numbers.add(str(t['number']));trip={**t,'tid':tid}
        for a,b in zip(ss,ss[1:]):
            ex=spine_expansion(a['name'],b['name'])
            if ex:
                for fa,fb,cid,clabel in ex:
                    ma=station_meta(fa,a);mb=station_meta(fb,b)
                    add_edge(ma,mb,cid,clabel,trip)
                    demand[canonical_id(ma['name'],mb['name'])]['derivedFrom'].add(a['name']+' → '+b['name'])
            else:
                corridor=infer_corridor(a['name'],b['name'])
                add_edge(a,b,corridor,corridor.replace('_',' ').title(),trip)
                demand[canonical_id(a['name'],b['name'])]['derivedFrom'].add(a['name']+' → '+b['name'])

    best=best_legacy_by_pair(state)
    for cid,(sid,s) in best.items():
        if cid in demand:continue
        a=s.get('stopFrom') or {};b=s.get('stopTo') or {}
        corridor=s.get('corridor') or infer_corridor(a.get('name'),b.get('name'))
        demand[cid]={
            'id':cid,'sectionId':cid,'routeId':route_id_for(corridor),'corridor':corridor,'corridorLabel':corridor.replace('_',' ').title(),
            'from':{'name':a.get('name'),'lat':a.get('lat'),'lon':a.get('lon')},'to':{'name':b.get('name'),'lat':b.get('lat'),'lon':b.get('lon')},
            'tripIds':set(),'trainNumbers':set(),'tokens':set(),'derivedFrom':{'historique'}
        }

    best=best_legacy_by_pair(state)
    tasks=[];status_counts=defaultdict(int);corr_counts=defaultdict(lambda:defaultdict(int))
    for cid,d in demand.items():
        source=state.get('sections',{}).get(cid)
        source_sid=cid if source else None
        if not source and cid in best:source_sid,source=best[cid]
        if source:
            engine=str(source.get('validationEngine') or '')
            if engine=='ROUTER_V6' or str(source.get('source') or '')=='MOORAIL_VALIDATED_SECTIONS_V8':
                status='VALIDATED_V8'
            else:status='LEGACY'
        else:status='TODO'
        status_counts[status]+=1;corr_counts[d['corridor']][status]+=1
        tasks.append({
            'id':cid,'sectionId':cid,'routeId':d['routeId'],'corridor':d['corridor'],'corridorLabel':d['corridorLabel'],
            'from':d['from'],'to':d['to'],'status':status,'sourceSectionId':source_sid,
            'validationEngine':(source or {}).get('validationEngine') if source else None,
            'impactToday':len(d['tripIds']),'trainNumbers':sorted(d['trainNumbers'],key=lambda x:(len(str(x)),str(x)))[:80],
            'tokens':sorted(d['tokens']),'derivedFrom':sorted(d['derivedFrom'])[:30]
        })
    rank={'TODO':0,'LEGACY':1,'VALIDATED_V8':2}
    tasks.sort(key=lambda x:(rank.get(x['status'],9),-x['impactToday'],x['corridorLabel'],x['from']['name'] or '',x['to']['name'] or ''))

    corridors=[]
    for cid,cc in sorted(corr_counts.items()):
        total=sum(cc.values());done=cc.get('VALIDATED_V8',0)
        corridors.append({'id':cid,'label':next((s['label'] for s in SPINES if s['id']==cid),cid.replace('_',' ').title()),'total':total,'validated':done,'legacy':cc.get('LEGACY',0),'todo':cc.get('TODO',0),'coveragePct':round(done*100/total,1) if total else 0})

    spines_public=[]
    for sp in SPINES:
        spines_public.append({'id':sp['id'],'label':sp['label'],'nodes':[{'label':n[0],'aliases':n} for n in sp['nodes']]})

    controls={
      'mustBePresent':{n:(n in selected_numbers) for n in ('2509','5454','5460','9577','9242','9706')},
      'mustBeAbsent':{n:(n not in selected_numbers) for n in ('879303','839654','68230','427250')}
    }
    payload={
      'version':8,'generatedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'date':str(today),
      'allowedTokens':sorted(ALLOWED_TOKENS),'strictTripsToday':valid_trip_count,'tokenCounts':dict(sorted(token_counts.items())),
      'stats':{'tasks':len(tasks),**dict(status_counts),'migratedThisRun':migrated,'migratedAlreadyV6':upgraded},
      'controls':controls,'corridors':corridors,'spines':spines_public,'tasks':tasks
    }
    atomic_json(output,payload,0o644)
    print(json.dumps({'date':payload['date'],'strictTripsToday':valid_trip_count,'stats':payload['stats'],'controls':controls,'corridors':corridors[:12]},ensure_ascii=False))

if __name__=='__main__':main()
