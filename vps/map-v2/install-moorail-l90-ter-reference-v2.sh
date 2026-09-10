#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="/opt/labetaillere-map-v2-src/map-v2"
RAILROOT="/opt/lb-rail-engine-v1"
DB="$RAILROOT/data/timetable-v3-france-preview.sqlite"
STATE="$ROOT/data/route-editor/moorail-route-editor-state-v1.json"
LIVE="$ROOT/public/data/moorail-live-v1/sections.json"
ENGINE="$RAILROOT/app/moorail_global_hs_v7.py"
SERVICE="labetaillere-map-v2.service"
API="http://127.0.0.1:3111/api/map-v2/route-editor/save"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$ROOT/backups/l90-ter-reference-v2-$STAMP"
TMP="$(mktemp -d /tmp/l90-ter-reference-v2.XXXXXX)"

cleanup(){ rm -rf "$TMP"; }
trap cleanup EXIT

[[ "${EUID:-$(id -u)}" -eq 0 ]] || { echo "ERREUR : lancer avec sudo/root" >&2; exit 2; }
for f in "$DB" "$STATE" "$ENGINE"; do
  [[ -f "$f" ]] || { echo "ERREUR fichier absent : $f" >&2; exit 3; }
done

mkdir -p "$BACKUP"
cp -a "$STATE" "$BACKUP/state-before.json"
[[ -f "$LIVE" ]] && cp -a "$LIVE" "$BACKUP/live-before.json" || true
sqlite3 "$DB" '.backup '"$BACKUP/timetable-before.sqlite"'' >/dev/null 2>&1 || cp -a "$DB" "$BACKUP/timetable-before.sqlite"

echo "======================================================================"
echo " MOO RAIL L90 V2 — LE TGV REUTILISE LE VRAI TRACE TER"
echo " Luxembourg <-> Thionville : extraction directe depuis trip_geometry TER"
echo "======================================================================"
echo "Backup : $BACKUP"
echo

python3 - "$DB" "$TMP" <<'PY'
import bisect, json, math, re, sqlite3, sys, unicodedata, zlib
from pathlib import Path

DB=Path(sys.argv[1]); TMP=Path(sys.argv[2])

def strip_accents(s):
    t=unicodedata.normalize('NFD',str(s or ''))
    return ''.join(c for c in t if unicodedata.category(c)!='Mn')

def key(s):
    t=strip_accents(s).upper()
    t=re.sub(r'[^A-Z0-9]+',' ',t).strip()
    return re.sub(r'\s+',' ',t)

def is_lux(s):
    k=key(s)
    return k=='LUXEMBOURG' or k.startswith('LUXEMBOURG GARE')

def is_thio(s):
    k=key(s)
    return k=='THIONVILLE' or k.startswith('THIONVILLE GARE')

def is_bett(s):
    k=key(s)
    return k=='BETTEMBOURG' or k.startswith('BETTEMBOURG GARE')

def hav(a,b):
    lon1,lat1=map(math.radians,a);lon2,lat2=map(math.radians,b)
    dlon=lon2-lon1;dlat=lat2-lat1
    h=math.sin(dlat/2)**2+math.cos(lat1)*math.cos(lat2)*math.sin(dlon/2)**2
    return 2*6371000.0*math.asin(min(1,math.sqrt(h)))

def cumulative(coords):
    cu=[0.0];total=0.0
    for a,b in zip(coords,coords[1:]):
        total+=hav(a,b);cu.append(total)
    return cu,total

def interp(coords,cu,d):
    if d<=0:return coords[0]
    if d>=cu[-1]:return coords[-1]
    i=max(0,min(len(coords)-2,bisect.bisect_right(cu,d)-1))
    span=cu[i+1]-cu[i];r=(d-cu[i])/span if span>0 else 0.0
    return (coords[i][0]+(coords[i+1][0]-coords[i][0])*r,
            coords[i][1]+(coords[i+1][1]-coords[i][1])*r)

def slice_path(coords,cu,d0,d1):
    rev=d1<d0
    if rev:d0,d1=d1,d0
    d0=max(0.0,min(float(d0),cu[-1]));d1=max(0.0,min(float(d1),cu[-1]))
    out=[interp(coords,cu,d0)]
    lo=bisect.bisect_right(cu,d0);hi=bisect.bisect_left(cu,d1)
    for i in range(lo,hi+1):
        if 0<=i<len(coords) and d0<cu[i]<d1:out.append(coords[i])
    out.append(interp(coords,cu,d1))
    clean=[]
    for p in out:
        q=(round(float(p[0]),6),round(float(p[1]),6))
        if not clean or hav(clean[-1],q)>0.05:clean.append(q)
    if rev:clean.reverse()
    return clean

def decode(blob):
    obj=json.loads(zlib.decompress(blob))
    coords=obj.get('coordinates') if isinstance(obj,dict) else obj
    cu=obj.get('cumulative') if isinstance(obj,dict) else None
    if not isinstance(coords,list) or len(coords)<2:raise ValueError('payload sans coordinates')
    coords=[(float(p[0]),float(p[1])) for p in coords]
    if not isinstance(cu,list) or len(cu)!=len(coords):cu,_=cumulative(coords)
    else:cu=[float(x) for x in cu]
    return coords,cu

db=sqlite3.connect(f'file:{DB}?mode=ro',uri=True)

# Coordonnée réelle de Bettembourg si présente : sert uniquement de garde-fou géométrique.
bett=[]
for name,lon,lat in db.execute('SELECT name,lon,lat FROM stops WHERE lon IS NOT NULL AND lat IS NOT NULL'):
    if is_bett(name):bett.append((str(name),(float(lon),float(lat))))
print('Bettembourg dans stops :',bett[:5])

# Cherche tous les TER 887xx ayant Luxembourg + Thionville et une géométrie exploitable.
rows=db.execute("""
SELECT t.trip_pk,t.trip_id,t.number,g.offsets_json,p.payload_zlib,p.length_m
FROM trips t
JOIN trip_geometry g ON g.trip_pk=t.trip_pk
JOIN rail_paths p ON p.path_id=g.path_id
WHERE CAST(t.number AS TEXT) LIKE '887%'
ORDER BY CASE WHEN CAST(t.number AS TEXT)='88743' THEN 0 ELSE 1 END, CAST(t.number AS TEXT), t.trip_pk
""").fetchall()

candidates=[]
for pk,tid,num,offsets_json,blob,total_len in rows:
    stops=db.execute("""
      SELECT st.seq,s.name,s.lon,s.lat
      FROM stop_times st JOIN stops s ON s.stop_pk=st.stop_pk
      WHERE st.trip_pk=? ORDER BY st.seq
    """,(pk,)).fetchall()
    if len(stops)<2:continue
    try: offsets=[float(x) for x in json.loads(offsets_json)]
    except Exception:continue
    if len(offsets)!=len(stops):continue
    lux=[i for i,s in enumerate(stops) if is_lux(s[1])]
    th=[i for i,s in enumerate(stops) if is_thio(s[1])]
    if not lux or not th:continue
    i,j=lux[0],th[0]
    try:
        coords,cu=decode(blob)
        seg=slice_path(coords,cu,offsets[i],offsets[j])
    except Exception as e:
        continue
    if len(seg)<2:continue
    _,length=cumulative(seg)
    if not 18000 <= length <= 60000:continue
    bett_err=min((min(hav(p,xy) for p in seg) for _n,xy in bett),default=0.0)
    if bett and bett_err>5000:continue
    candidates.append({
      'pk':pk,'trip_id':str(tid),'number':str(num),'stops':[str(s[1]) for s in stops],
      'lux_name':str(stops[i][1]),'thio_name':str(stops[j][1]),'coords':seg,
      'km':length/1000,'bett_error_m':bett_err,
    })

if not candidates:
    print('\nAUCUN TER 887xx exploitable trouvé. Diagnostic des premiers 887xx :')
    for pk,tid,num,*_ in rows[:20]:
        ss=[r[0] for r in db.execute('SELECT s.name FROM stop_times st JOIN stops s ON s.stop_pk=st.stop_pk WHERE st.trip_pk=? ORDER BY st.seq',(pk,))]
        print(num,tid,' -> '.join(str(x) for x in ss))
    raise SystemExit('ERREUR : impossible d’extraire le vrai Luxembourg <-> Thionville depuis un TER 887xx')

# Favorise 88743, puis davantage de points et proximité Bettembourg.
candidates.sort(key=lambda x:(x['number']!='88743',x['bett_error_m'],-len(x['coords'])))
ref=candidates[0]
print('\nREFERENCE TER RETENUE')
print(' train   :',ref['number'],ref['trip_id'])
print(' stops   :',' -> '.join(ref['stops']))
print(' section :',ref['lux_name'],'<->',ref['thio_name'])
print(' points  :',len(ref['coords']))
print(' km      :',round(ref['km'],3))
print(' erreur Bettembourg :',round(ref['bett_error_m'],1),'m')

# Trouve tous les libellés réellement utilisés pour une paire adjacente Lux<->Thionville.
aliases=set()
for pk, in db.execute('SELECT trip_pk FROM trips'):
    ss=[r[0] for r in db.execute('SELECT s.name FROM stop_times st JOIN stops s ON s.stop_pk=st.stop_pk WHERE st.trip_pk=? ORDER BY st.seq',(pk,))]
    for a,b in zip(ss,ss[1:]):
        if is_lux(a) and is_thio(b):aliases.add((str(a),str(b)))
        elif is_thio(a) and is_lux(b):aliases.add((str(b),str(a)))
if not aliases:aliases.add(('Luxembourg','Thionville'))
print('\nLibellés Lux->Thionville rencontrés :',sorted(aliases))

# Géométrie extraite orientée Luxembourg -> Thionville.
coords=ref['coords']
if not is_lux(ref['lux_name']) or not is_thio(ref['thio_name']):raise SystemExit('orientation TER incohérente')
# slice_path suit l'ordre offsets[i] -> offsets[j] et gère déjà l'inversion.

payloads=[]
for n,(lux_name,thio_name) in enumerate(sorted(aliases),1):
    sid=f'sec-l90-ter-reference-v2-{n}'
    payload={
      'routeId':'L90_TER_REFERENCE_V2',
      'sectionId':sid,
      'status':'validated',
      'source':'MOORAIL_L90_TER_REFERENCE_V2',
      'validationEngine':'TER_TRIP_GEOMETRY_REUSE_V2',
      'corridor':'L90_LUX_THIONVILLE',
      'stopFrom':{'name':lux_name,'lat':coords[0][1],'lon':coords[0][0]},
      'stopTo':{'name':thio_name,'lat':coords[-1][1],'lon':coords[-1][0]},
      'waypoints':[],
      'coordinates':[[p[0],p[1]] for p in coords],
      'distanceKm':round(ref['km'],3),
    }
    payloads.append(payload)
    (TMP/f'payload-{n}.json').write_text(json.dumps(payload,ensure_ascii=False,indent=2),encoding='utf-8')

(TMP/'manifest.json').write_text(json.dumps({
 'reference':{k:v for k,v in ref.items() if k!='coords'},
 'payloads':[p['sectionId'] for p in payloads],
 'aliases':sorted(aliases)
},ensure_ascii=False,indent=2),encoding='utf-8')
print('\nPayloads :',len(payloads))
db.close()
PY

cp -a "$TMP/manifest.json" "$BACKUP/manifest.json"
cp -a "$TMP"/payload-*.json "$BACKUP/"

echo
echo "=== PUBLICATION DES SECTIONS VALIDÉES ==="
for payload in "$TMP"/payload-*.json; do
  echo "-> $(basename "$payload")"
  curl -fsS -X POST -H 'content-type: application/json' --data @"$payload" "$API"
  echo
done

sleep 1
curl -fsS "http://127.0.0.1:3111/data/moorail-live-v1/sections.json?v=$STAMP" -o "$TMP/live-after.json"
cp -a "$TMP/live-after.json" "$BACKUP/live-after.json"

python3 - "$TMP/live-after.json" "$TMP/manifest.json" <<'PY'
import json,re,sys,unicodedata

def key(s):
 t=unicodedata.normalize('NFD',str(s or ''));t=''.join(c for c in t if unicodedata.category(c)!='Mn').upper();return re.sub(r'\s+',' ',re.sub(r'[^A-Z0-9]+',' ',t).strip())
def lux(s):return key(s)=='LUXEMBOURG' or key(s).startswith('LUXEMBOURG GARE')
def thio(s):return key(s)=='THIONVILLE' or key(s).startswith('THIONVILLE GARE')
live=json.load(open(sys.argv[1],encoding='utf-8')); man=json.load(open(sys.argv[2],encoding='utf-8'))
rows=[x for x in live.get('pairs') or [] if lux(x.get('from')) and thio(x.get('to'))]
print('Live Luxembourg -> Thionville :',len(rows))
for x in rows: print(' ',x.get('from'),'->',x.get('to'),'|',x.get('sectionId'),'| points',len(x.get('coords') or []))
want=set(man.get('payloads') or []); got={str(x.get('sectionId') or '') for x in rows}
missing=want-got
if missing: raise SystemExit('ERREUR sections publiées absentes du live: '+str(sorted(missing)))
print('Publication live : OK')
PY

echo
echo "=== RECALCUL GLOBAL HIGH-SPEED ==="
python3 -u "$ENGINE" --apply | tee "$BACKUP/global-hs-v7.log"

echo
echo "=== REDEMARRAGE SERVEUR CARTE ==="
systemctl restart "$SERVICE"
for _ in $(seq 1 30); do
  if systemctl is-active --quiet "$SERVICE" && curl -fsS --max-time 2 http://127.0.0.1:3111/api/map-v2/health >/dev/null 2>&1; then break; fi
  sleep 1
done
systemctl is-active --quiet "$SERVICE"

echo
echo "=== CONTROLE TGV LUXEMBOURG / THIONVILLE DANS SQLITE ==="
python3 - "$DB" <<'PY'
import bisect,json,math,re,sqlite3,sys,unicodedata,zlib

def key(s):
 t=unicodedata.normalize('NFD',str(s or ''));t=''.join(c for c in t if unicodedata.category(c)!='Mn').upper();return re.sub(r'\s+',' ',re.sub(r'[^A-Z0-9]+',' ',t).strip())
def lux(s):return key(s)=='LUXEMBOURG' or key(s).startswith('LUXEMBOURG GARE')
def thio(s):return key(s)=='THIONVILLE' or key(s).startswith('THIONVILLE GARE')
def hav(a,b):
 lon1,lat1=map(math.radians,a);lon2,lat2=map(math.radians,b);h=math.sin((lat2-lat1)/2)**2+math.cos(lat1)*math.cos(lat2)*math.sin((lon2-lon1)/2)**2;return 2*6371000*math.asin(min(1,math.sqrt(h)))
db=sqlite3.connect(f'file:{sys.argv[1]}?mode=ro',uri=True)
for num in ('2872','2870','2871','9898'):
 rows=db.execute('''SELECT t.trip_pk,t.trip_id,g.path_id,g.offsets_json,p.payload_zlib FROM trips t JOIN trip_geometry g ON g.trip_pk=t.trip_pk JOIN rail_paths p ON p.path_id=g.path_id WHERE CAST(t.number AS TEXT)=?''',(num,)).fetchall()
 for pk,tid,pid,offj,blob in rows:
  ss=[r[0] for r in db.execute('SELECT s.name FROM stop_times st JOIN stops s ON s.stop_pk=st.stop_pk WHERE st.trip_pk=? ORDER BY st.seq',(pk,))]
  pairs=list(zip(ss,ss[1:]))
  if any((lux(a) and thio(b)) or (thio(a) and lux(b)) for a,b in pairs):
   print(num,'|',tid,'| path',pid,'|',' -> '.join(ss))
print('Contrôle fini. Recharge maintenant france-v3-preview.html avec Ctrl+F5.')
db.close()
PY

echo
echo "======================================================================"
echo " FIN OK — L90 TER REUTILISEE PAR LE MOTEUR TGV"
echo " Backup : $BACKUP"
echo " Recharge : https://vps.labetaillere.fr/map-v2/france-v3-preview.html"
echo "======================================================================"
