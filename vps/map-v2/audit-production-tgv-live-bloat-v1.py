#!/usr/bin/env python3
from pathlib import Path
import json, math, sys, unicodedata

ROOT=Path('/opt/labetaillere-map-v2-src/map-v2')
LIVE=ROOT/'public/data/moorail-live-v1/sections.json'
ACTIVE_NET=ROOT/'public/data/moorail-network-v8/network.json'
REF_NET=ROOT/'backups/moorail-v11-production-20260909-124051/network.json'
TARGETS=['2870','2871','9898','2656','8602','6702','9713']

def norm(s):
    s=unicodedata.normalize('NFKD',str(s or ''))
    return ''.join(c for c in s if not unicodedata.combining(c)).strip().lower()

def stopname(x):
    if isinstance(x,dict): return str(x.get('name') or x.get('stop_name') or x.get('label') or '')
    return str(x or '')

def coords_of(x):
    c=x.get('coords') or x.get('coordinates') or x.get('geometry') or []
    if isinstance(c,dict): c=c.get('coordinates') or []
    out=[]
    if isinstance(c,list):
        for p in c:
            if isinstance(p,(list,tuple)) and len(p)>=2:
                try:
                    a,b=float(p[0]),float(p[1])
                    # MooRail uses [lon,lat]. If obviously inverted, fix only for metrics.
                    if abs(a)<=90 and abs(b)>90: a,b=b,a
                    out.append((a,b))
                except Exception: pass
    return out

def hav(a,b):
    lon1,lat1=a; lon2,lat2=b
    r=6371.0088
    p1,p2=math.radians(lat1),math.radians(lat2)
    dp=math.radians(lat2-lat1); dl=math.radians(lon2-lon1)
    q=math.sin(dp/2)**2+math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
    return 2*r*math.asin(min(1,math.sqrt(q)))

def metrics(item):
    c=coords_of(item)
    if len(c)<2:return (len(c),None,None,None)
    path=sum(hav(a,b) for a,b in zip(c,c[1:]))
    direct=hav(c[0],c[-1])
    ratio=(path/direct if direct>0.01 else None)
    return len(c),path,direct,ratio

def routes(net,num):
    return (net.get('trainRoutes') or {}).get(num) or []

def seq(v):
    return [stopname(x) for x in (v.get('stops') or [])]

for p in (LIVE,ACTIVE_NET,REF_NET):
    if not p.exists():
        print('ABSENT:',p,file=sys.stderr);sys.exit(2)

print('Chargement des fichiers...')
live=json.load(open(LIVE,encoding='utf-8'))
act=json.load(open(ACTIVE_NET,encoding='utf-8'))
ref=json.load(open(REF_NET,encoding='utf-8'))
pairs=live.get('pairs') or []

by={}
for i,x in enumerate(pairs):
    k=(norm(x.get('from')),norm(x.get('to')))
    by.setdefault(k,[]).append((i,x))

print('\n============================================================')
print(' VOLUME LIVE ACTUEL')
print('============================================================')
print('Fichier     :',LIVE)
print('Taille      : %.2f Mo'%(LIVE.stat().st_size/1024/1024))
print('Pairs       :',len(pairs))
print('Pairs uniques:',len(by))
dups=sum(max(0,len(v)-1) for v in by.values())
print('Doublons    :',dups)
print('Facteur pairs/uniques: %.2fx'%(len(pairs)/max(1,len(by))))

print('\n============================================================')
print(' TRAINROUTES : BACKUP 09/09 12:24 vs ACTIF')
print('============================================================')
required=[]
for num in TARGETS:
    rr=routes(ref,num); aa=routes(act,num)
    print(f'\nTRAIN {num}')
    print('  REF   :',len(rr),'variante(s)')
    for j,v in enumerate(rr): print('    ',j,' -> '.join(seq(v)))
    print('  ACTIF :',len(aa),'variante(s)')
    for j,v in enumerate(aa): print('    ',j,' -> '.join(seq(v)))
    print('  IDENTIQUE SEQUENCES :', [seq(v) for v in rr]==[seq(v) for v in aa])
    base=rr or aa
    for v in base:
        s=seq(v)
        for a,b in zip(s,s[1:]):
            if a and b: required.append((num,a,b))

print('\n============================================================')
print(' GEOMETRIES LIVE UTILISEES PAR CES TGV')
print('============================================================')
seen=set()
for num,a,b in required:
    key=(norm(a),norm(b))
    tag=(a,b)
    if (num,tag) in seen: continue
    seen.add((num,tag))
    matches=by.get(key,[])
    rev=by.get((key[1],key[0]),[])
    direction='direct'
    if not matches and rev:
        matches=rev; direction='inverse'
    print(f'\n{num}: {a} -> {b} | {len(matches)} géométrie(s) [{direction}]')
    if not matches:
        print('   !!! AUCUNE PAIRE LIVE')
        continue
    for idx,x in matches:
        n,path,direct,ratio=metrics(x)
        sid=x.get('sectionId') or x.get('id') or x.get('section_id')
        src=x.get('source') or x.get('validationSource') or ''
        eng=x.get('validationEngine') or x.get('engine') or ''
        status=x.get('status') or ''
        extra=[]
        if path is not None: extra.append('rail=%.1fkm'%path)
        if direct is not None: extra.append('droit=%.1fkm'%direct)
        if ratio is not None: extra.append('ratio=%.2f'%ratio)
        print(f'   index={idx} sectionId={sid} coords={n} source={src} engine={eng} status={status} '+' '.join(extra))

print('\n============================================================')
print(' PAIRES LES PLUS DUPLIQUEES')
print('============================================================')
for (a,b),vals in sorted(by.items(),key=lambda kv:len(kv[1]),reverse=True)[:20]:
    if len(vals)>1: print(f'{len(vals):4d}x  {a} -> {b}')

print('\nAUDIT SEULEMENT : AUCUN FICHIER MODIFIE.')
