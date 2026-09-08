#!/usr/bin/env python3
import argparse, copy, hashlib, json, math, os, re, shutil, sys, tempfile
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(os.environ.get('MOORAIL_ROOT', '/opt/labetaillere-map-v2-src/map-v2'))
STATE = ROOT / 'data/route-editor/moorail-route-editor-state-v1.json'
TRIPS = ROOT / 'data/generated/trips.json'
PATHS = ROOT / 'data/generated/paths.json'
SERVICE = 'labetaillere-map-v2.service'
SOURCE = 'MOORAIL_VALIDATED_V3'


def load(path):
    with path.open(encoding='utf-8') as f:
        return json.load(f)


def atomic(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=path.name + '.', dir=str(path.parent))
    os.close(fd)
    try:
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(obj, f, ensure_ascii=False, separators=(',', ':'))
        os.chmod(tmp, 0o644)
        os.replace(tmp, path)
    finally:
        try: os.unlink(tmp)
        except FileNotFoundError: pass


def norm(s):
    import unicodedata
    s = unicodedata.normalize('NFKD', str(s or ''))
    return ''.join(c for c in s if not unicodedata.combining(c)).strip().lower()


def high_speed_trip(t):
    dump = ' '.join(str(t.get(k) or '') for k in ('category','routeName','routeShortName','id')).upper()
    return bool(re.search(r'(^|[^A-Z])(TGV|OUIGO|LYRIA|ICE|AVR|TRENITALIA|FRECCIAROSSA|OUI|OGO|TRN)([^A-Z]|$)', dump))


def signature_of_trip(t):
    return ' → '.join(str(s.get('name') or 'Gare') for s in (t.get('stops') or []))


def dist_m(a,b):
    lon1,lat1 = map(float,a[:2]); lon2,lat2 = map(float,b[:2])
    R=6371000.0
    p1=math.radians(lat1); p2=math.radians(lat2)
    dp=math.radians(lat2-lat1); dl=math.radians(lon2-lon1)
    x=math.sin(dp/2)**2+math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
    return 2*R*math.atan2(math.sqrt(x), math.sqrt(max(0.0,1-x)))


def metrics(coords):
    cum=[0.0]
    for i in range(1,len(coords)):
        cum.append(cum[-1]+dist_m(coords[i-1],coords[i]))
    return cum, (cum[-1] if cum else 0.0)


def section_num(section_id):
    m=re.search(r':s(\d+)$', str(section_id))
    return int(m.group(1)) if m else 10**9


def clean_coords(raw):
    out=[]
    for c in raw or []:
        if not isinstance(c,(list,tuple)) or len(c)<2: continue
        try: p=[float(c[0]),float(c[1])]
        except: continue
        if not all(math.isfinite(x) for x in p): continue
        if not out or dist_m(out[-1],p)>0.05: out.append(p)
    return out


def assemble_route(route, state_sections):
    ids=sorted(route.get('sectionIds') or [], key=section_num)
    if not ids:
        return None, 'aucune section enregistrée'
    sections=[]
    expected=1
    for sid in ids:
        n=section_num(sid)
        if n!=expected:
            return None, f'section manquante avant {sid}'
        s=state_sections.get(sid)
        if not s or s.get('status')!='validated':
            return None, f'{sid} non validée'
        c=clean_coords(s.get('coordinates'))
        if len(c)<2:
            return None, f'{sid} géométrie invalide'
        sections.append((sid,s,c))
        expected+=1

    full=[]; offsets=[0.0]; section_meta=[]
    for idx,(sid,s,c) in enumerate(sections):
        if full:
            gap=dist_m(full[-1],c[0])
            if gap>300:
                return None, f'{sid} démarre à {gap:.0f} m de la section précédente'
            if gap<=5:
                c=c[1:]
        if not c:
            return None, f'{sid} vide après jointure'
        full.extend(c)
        cum,length=metrics(full)
        offsets.append(length)
        section_meta.append({
            'sectionId':sid,
            'from':(s.get('stopFrom') or {}).get('name',''),
            'to':(s.get('stopTo') or {}).get('name',''),
            'waypoints':len(s.get('waypoints') or []),
            'distanceKm':s.get('distanceKm')
        })

    if len(full)<2:
        return None, 'géométrie finale trop courte'
    cum,length=metrics(full)
    return {
        'coordinates':full,
        'cumulative':cum,
        'length':length,
        'stopOffsets':offsets,
        'sections':section_meta
    }, None


def main():
    ap=argparse.ArgumentParser(description='Compile MooRail validated stop-to-stop sections into France V3 preview paths')
    ap.add_argument('--apply', action='store_true', help='write trips.json/paths.json and restart Map V2')
    ap.add_argument('--route-id', help='compile only one route id')
    args=ap.parse_args()

    for p in (STATE,TRIPS,PATHS):
        if not p.exists(): raise SystemExit(f'ERREUR: fichier absent: {p}')

    state=load(STATE); trips=load(TRIPS); paths=load(PATHS)
    routes=state.get('routes') or {}; sections=state.get('sections') or {}
    if args.route_id:
        routes={k:v for k,v in routes.items() if k==args.route_id}
        if not routes: raise SystemExit(f'ERREUR: route inconnue: {args.route_id}')

    print('============================================================')
    print(' MOO RAIL — COMPILATION VALIDATIONS -> FRANCE V3 PREVIEW')
    print(' Mode :', 'APPLY' if args.apply else 'DIAGNOSTIC')
    print('============================================================')

    new_trips=copy.deepcopy(trips); new_paths=copy.deepcopy(paths)
    candidates=[]; skipped=[]
    for rid,route in sorted(routes.items()):
        built,err=assemble_route(route,sections)
        if err:
            skipped.append((rid,route.get('signature',''),err)); continue
        sig=route.get('signature') or ''
        matched=[(tid,t) for tid,t in trips.items() if high_speed_trip(t) and signature_of_trip(t)==sig]
        if not matched:
            skipped.append((rid,sig,'aucune circulation correspondante')); continue

        payload = json.dumps(built['coordinates'], separators=(',',':'))
        pid='p-moorail-v3-'+hashlib.sha1((rid+'|'+payload).encode()).hexdigest()[:16]
        new_paths[pid]={
            'coordinates':built['coordinates'],
            'cumulative':built['cumulative'],
            'length':built['length'],
            'stopOffsets':built['stopOffsets'],
            'profile':'tgv',
            'pathSource':SOURCE,
            'routeId':rid,
            'signature':sig,
            'compiledAt':datetime.now(timezone.utc).isoformat(),
            'validatedSections':built['sections']
        }
        nums=set()
        for tid,t in matched:
            nt=new_trips[tid]
            nt['pathId']=pid
            nt['offsets']=built['stopOffsets']
            nt['pathSource']=SOURCE
            nums.add(str(t.get('number') or ''))
        candidates.append({
            'routeId':rid,'signature':sig,'pathId':pid,'trips':len(matched),
            'numbers':sorted(x for x in nums if x),'km':built['length']/1000,
            'sections':len(built['sections'])
        })

    print('\nPARCOURS COMPLETS COMPILABLES :',len(candidates))
    for c in candidates:
        print(f"  {c['routeId']} | {c['signature']} | {c['sections']} étapes | {c['km']:.1f} km | {c['trips']} circulations")
        if c['numbers']: print('    trains:', ', '.join(c['numbers'][:30]))

    print('\nNON PUBLIABLES / INCOMPLETS :',len(skipped))
    for rid,sig,why in skipped[:30]: print(f'  {rid} | {sig} | {why}')
    if len(skipped)>30: print('  ...')

    report={
        'generatedAt':datetime.now(timezone.utc).isoformat(),
        'applyRequested':args.apply,
        'candidates':candidates,
        'skipped':[{'routeId':a,'signature':b,'reason':c} for a,b,c in skipped]
    }
    report_path=ROOT/'data/route-editor/moorail-compile-preview-v1.json'
    atomic(report_path,report)
    print('\nRapport :',report_path)

    if not candidates:
        print('\nAucun parcours complet à publier. Rien modifié.')
        return 0

    if not args.apply:
        print('\nDIAGNOSTIC UNIQUEMENT — aucun fichier France V3 modifié.')
        print('Relancer avec --apply pour publier les parcours complets ci-dessus.')
        return 0

    stamp=datetime.now().strftime('%Y%m%d-%H%M%S')
    backup=ROOT/f'backups/moorail-compile-v1-{stamp}'
    backup.mkdir(parents=True,exist_ok=True)
    shutil.copy2(TRIPS,backup/'trips.json')
    shutil.copy2(PATHS,backup/'paths.json')
    shutil.copy2(STATE,backup/'moorail-route-editor-state-v1.json')
    print('\nBackup :',backup)

    atomic(TRIPS,new_trips); atomic(PATHS,new_paths)
    print('Écriture trips.json / paths.json : OK')

    import subprocess, time
    try:
        subprocess.run(['systemctl','restart',SERVICE],check=True)
        ok=False
        for _ in range(30):
            p=subprocess.run(['curl','-fsS','--max-time','2','http://127.0.0.1:3111/api/map-v2/health'],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,text=True)
            if p.returncode==0:
                try:
                    h=json.loads(p.stdout)
                    if h.get('ok') is True:
                        ok=True; print('Health :',p.stdout.strip()); break
                except: pass
            time.sleep(1)
        if not ok: raise RuntimeError('health Map V2 indisponible après restart')
    except Exception as e:
        print('ERREUR publication:',e,file=sys.stderr)
        shutil.copy2(backup/'trips.json',TRIPS); shutil.copy2(backup/'paths.json',PATHS)
        subprocess.run(['systemctl','restart',SERVICE],check=False)
        print('ROLLBACK effectué.',file=sys.stderr)
        return 2

    print('\n============================================================')
    print(' PUBLICATION FRANCE V3 PREVIEW OK')
    print(' pathSource :',SOURCE)
    print(' parcours   :',len(candidates))
    print(' circulations modifiées :',sum(c['trips'] for c in candidates))
    print(' carte      : https://vps.labetaillere.fr/map-v2/france-v3-preview.html')
    print('============================================================')
    return 0

if __name__=='__main__':
    raise SystemExit(main())
