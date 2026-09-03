#!/usr/bin/env bash
set -euo pipefail

NUMBER="${1:-2807}"
DATE="${2:-$(date +%Y%m%d)}"
PROXY="https://assistant-train-cx5u.vercel.app/api/train"
TMP="$(mktemp -d /tmp/lb-sncf-geojson.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

printf '\n============================================================\n'
printf 'AUDIT GEOJSON API SNCF / NAVITIA — TGV %s — %s\n' "$NUMBER" "$DATE"
printf 'AUCUNE MODIFICATION DU VPS NI DU LIVE\n'
printf '============================================================\n'

VJ="vehicle_journey:SNCF:${DATE}:${NUMBER}:1187:Train"
printf '\n=== 1. VEHICLE JOURNEY SNCF ===\n'
printf 'id attendu: %s\n' "$VJ"

curl -fsS --get "$PROXY" \
  --data-urlencode "id=vehicle_journeys/${VJ}" \
  -o "$TMP/vj.json"

python3 - "$TMP/vj.json" "$NUMBER" <<'PY'
import json,sys
p=sys.argv[1]; number=sys.argv[2]
o=json.load(open(p,encoding='utf-8'))
print('top keys:',list(o)[:30])
rows=o.get('vehicle_journeys') or []
print('vehicle_journeys:',len(rows))
if not rows:
    print(json.dumps(o,ensure_ascii=False)[:3000])
    raise SystemExit(10)
vj=rows[0]
print('id:',vj.get('id'))
print('name:',vj.get('name'))
print('headsign:',vj.get('headsign'))
print('trip:',(vj.get('trip') or {}).get('id'),(vj.get('trip') or {}).get('name'))
print('route:',(vj.get('route') or {}).get('id'),(vj.get('route') or {}).get('name'))
print('physical_mode:',(vj.get('physical_mode') or {}).get('name'))
st=vj.get('stop_times') or []
print('stop_times:',len(st))
for s in st:
    sp=s.get('stop_point') or {}
    sa=sp.get('stop_area') or {}
    print(' -',sp.get('name') or sa.get('name'),'|',s.get('arrival_time'),'->',s.get('departure_time'),'|',sp.get('id'),sa.get('id'))

def geo_summary(label,g):
    if not isinstance(g,dict): return False
    coords=g.get('coordinates')
    if not coords: return False
    flat=[]
    def rec(x):
        if isinstance(x,(list,tuple)):
            if len(x)>=2 and isinstance(x[0],(int,float)) and isinstance(x[1],(int,float)):
                flat.append((float(x[0]),float(x[1])))
            else:
                for y in x: rec(y)
    rec(coords)
    if not flat:return False
    xs=[x for x,y in flat]; ys=[y for x,y in flat]
    print(f'GEOJSON {label}: type={g.get("type")} points={len(flat)} bbox=({min(xs):.6f},{min(ys):.6f},{max(xs):.6f},{max(ys):.6f})')
    print('  debut=',flat[:3])
    print('  fin  =',flat[-3:])
    return True

found=False
for key in ('geojson','shape'):
    if geo_summary('vehicle_journey.'+key,vj.get(key)): found=True
for key,obj in (('route',vj.get('route')),('line',(vj.get('route') or {}).get('line')),('trip',vj.get('trip'))):
    if isinstance(obj,dict):
        for k in ('geojson','shape'):
            if geo_summary(f'{key}.{k}',obj.get(k)): found=True
print('geojson direct disponible:',found)
PY

printf '\n=== 2. RECHERCHE D UN JOURNEY SNCF PORTANT LE %s ===\n' "$NUMBER"

python3 - "$TMP/vj.json" "$TMP/query.txt" "$NUMBER" <<'PY'
import json,sys,urllib.parse,re
obj=json.load(open(sys.argv[1],encoding='utf-8'))
rows=obj.get('vehicle_journeys') or []
if not rows: raise SystemExit(10)
vj=rows[0]; sts=vj.get('stop_times') or []
if len(sts)<2: raise SystemExit('stop_times insuffisants')

def area_id(st):
    sp=st.get('stop_point') or {}
    sa=sp.get('stop_area') or {}
    return sa.get('id') or sp.get('id')
orig=area_id(sts[0]); dest=area_id(sts[-1])
if not orig or not dest: raise SystemExit('origine/destination Navitia introuvable')
# departure_time est HHMMSS ; date fournie par l'id VJ.
m=re.search(r'SNCF:(\d{8}):',str(vj.get('id') or ''))
date=m.group(1) if m else ''
time=str(sts[0].get('departure_time') or sts[0].get('arrival_time') or '000000').replace(':','')[:6]
if len(time)<6: time=time.ljust(6,'0')
params={
  'from':orig,
  'to':dest,
  'datetime':date+'T'+time,
  'datetime_represents':'departure',
  'count':'10',
  'depth':'3',
  'data_freshness':'base_schedule',
}
rel='journeys?'+urllib.parse.urlencode(params)
open(sys.argv[2],'w',encoding='utf-8').write(rel)
print('from=',orig)
print('to  =',dest)
print('datetime=',params['datetime'])
print('relative query=',rel)
PY

REL="$(cat "$TMP/query.txt")"
curl -fsS --get "$PROXY" --data-urlencode "url=$REL" -o "$TMP/journeys.json"

python3 - "$TMP/journeys.json" "$NUMBER" <<'PY'
import json,sys,re,math
obj=json.load(open(sys.argv[1],encoding='utf-8')); wanted=str(sys.argv[2])
print('top keys journeys:',list(obj)[:30])
js=obj.get('journeys') or []
print('journeys:',len(js))

def coords_of(g):
    if not isinstance(g,dict): return []
    c=g.get('coordinates'); out=[]
    def rec(x):
        if isinstance(x,(list,tuple)):
            if len(x)>=2 and isinstance(x[0],(int,float)) and isinstance(x[1],(int,float)):
                out.append((float(x[0]),float(x[1])))
            else:
                for y in x: rec(y)
    rec(c); return out

def contains_number(sec):
    d=sec.get('display_informations') or {}
    vals=[d.get('code'),d.get('label'),d.get('headsign'),d.get('name')]
    for l in sec.get('links') or []:
        vals += [l.get('id'),l.get('value')]
    blob=' '.join(str(x or '') for x in vals)
    return bool(re.search(r'(?<!\d)'+re.escape(wanted)+r'(?!\d)',blob))

found=[]
for ji,j in enumerate(js):
    for si,s in enumerate(j.get('sections') or []):
        if s.get('type')!='public_transport': continue
        d=s.get('display_informations') or {}
        cs=coords_of(s.get('geojson'))
        print(f'PT journey={ji} section={si} code={d.get("code")} label={d.get("label")} headsign={d.get("headsign")} points={len(cs)}')
        if cs:
            xs=[x for x,y in cs]; ys=[y for x,y in cs]
            print(f'  bbox=({min(xs):.6f},{min(ys):.6f},{max(xs):.6f},{max(ys):.6f}) debut={cs[:2]} fin={cs[-2:]}')
        if contains_number(s) or str(d.get('code') or '')==wanted or str(d.get('label') or '')==wanted:
            found.append((ji,si,s,cs))
print('sections correspondant au numero:',len(found))
if not found:
    # On garde l'audit informatif : les réponses Navitia peuvent ne pas exposer le numéro dans display_informations.
    raise SystemExit(11)

# Repères pour voir si le GeoJSON reste sur la LGV puis passe à Pagny au lieu du détour Jaulny.
refs={
  'raccord_005341_ouest':(6.00214991102663,48.97062296888771),
  'raccord_005341_est':(6.027062006107198,48.980617830259646),
  'Metz':(6.176,49.119),
}
R=6371000
def dist(a,b):
    lon1,lat1=a; lon2,lat2=b
    p1=math.radians(lat1); p2=math.radians(lat2); dp=math.radians(lat2-lat1); dl=math.radians(lon2-lon1)
    h=math.sin(dp/2)**2+math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
    return 2*R*math.asin(min(1,math.sqrt(h)))
for ji,si,s,cs in found:
    print(f'\nMATCH journey={ji} section={si}:')
    if not cs:
        print('  PAS DE GEOJSON DANS CETTE SECTION')
        continue
    for name,p in refs.items():
        best=min((dist(c,p),idx,c) for idx,c in enumerate(cs))
        print(f'  plus proche {name}: {best[0]:.0f} m @ {best[1]} {best[2]}')
    out={'type':'Feature','properties':{'train':wanted,'journey':ji,'section':si},'geometry':s.get('geojson')}
    fn=f'/tmp/lb-sncf-{wanted}-geojson.json'
    json.dump(out,open(fn,'w',encoding='utf-8'),ensure_ascii=False)
    print('  geojson sauvegarde:',fn)
PY
RC=$?
if [[ $RC -eq 11 ]]; then
  echo "INFO : aucun numéro 2807 identifiable dans les sections du journey ; voir la liste ci-dessus."
elif [[ $RC -ne 0 ]]; then
  exit "$RC"
fi

printf '\n============================================================\n'
printf 'FIN AUDIT GEOJSON SNCF — AUCUNE MODIFICATION\n'
printf '============================================================\n'
