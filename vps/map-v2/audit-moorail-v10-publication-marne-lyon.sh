#!/usr/bin/env bash
set +e

ROOT="${MOORAIL_ROOT:-/opt/labetaillere-map-v2-src/map-v2}"
PUBLIC="$ROOT/public"
JS="$PUBLIC/moorail-route-editor-stops.js"
HTML="$PUBLIC/moorail-route-editor.html"
STATE="$ROOT/data/route-editor/moorail-route-editor-state-v1.json"
LIVE="$PUBLIC/data/moorail-live-v1/sections.json"
NETWORK="$PUBLIC/data/moorail-network-v8/network.json"
COMPILER="$ROOT/scripts/compile-moorail-validations-v2.py"
TMP="$(mktemp -d /tmp/moorail-publish-audit.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

FROM="Marne-la-Vallée Chessy"
TO="Lyon Perrache"

echo "============================================================"
echo " MOO RAIL V10 — AUDIT PUBLICATION MARNE-LA-VALLEE / LYON"
echo " AUCUNE MODIFICATION"
echo "============================================================"

echo
echo "=== 1/8 SERVICE / PRODUIT SERVI ==="
systemctl is-active labetaillere-map-v2.service
curl -fsS --max-time 5 http://127.0.0.1:3111/api/map-v2/health || true
echo
curl -fsS --max-time 8 "http://127.0.0.1:3111/moorail-route-editor-stops.js?$(date +%s)" -o "$TMP/served.js" || true
curl -fsS --max-time 8 "http://127.0.0.1:3111/moorail-route-editor.html?$(date +%s)" -o "$TMP/served.html" || true
for x in publishCheck publishCurrent publishAll; do
  if grep -q "id=\"$x\"" "$TMP/served.html"; then echo "  ✅ bouton $x"; else echo "  ❌ bouton $x absent"; fi
done
for x in refreshPublishPreview publishReady; do
  if grep -q "function $x" "$TMP/served.js"; then echo "  ✅ fonction $x"; else echo "  ❌ fonction $x absente"; fi
done
for x in publishCheck publishCurrent publishAll; do
  if grep -qF "\$('$x').onclick" "$TMP/served.js"; then echo "  ✅ binding $x"; else echo "  ❌ binding $x absent"; fi
done

echo
echo "=== 2/8 ETAT DE LA BRIQUE MARNE ↔ LYON ==="
python3 - "$STATE" "$LIVE" "$NETWORK" <<'PY'
import json,sys,unicodedata
state=json.load(open(sys.argv[1],encoding='utf-8'))
live=json.load(open(sys.argv[2],encoding='utf-8'))
net=json.load(open(sys.argv[3],encoding='utf-8'))
FROM='Marne-la-Vallée Chessy';TO='Lyon Perrache'
def n(s):
    s=unicodedata.normalize('NFKD',str(s or ''))
    return ''.join(c for c in s if not unicodedata.combining(c)).strip().lower()
want={n(FROM),n(TO)}
print('STATE :')
found=[]
for sid,s in (state.get('sections') or {}).items():
    a=(s.get('stopFrom') or {}).get('name');b=(s.get('stopTo') or {}).get('name')
    if {n(a),n(b)}==want:
        found.append((sid,s))
        print('  sectionId       :',sid)
        print('  sens            :',a,'→',b)
        print('  status          :',s.get('status'))
        print('  routeId         :',s.get('routeId'))
        print('  source          :',s.get('source'))
        print('  engine          :',s.get('validationEngine'))
        print('  points          :',len(s.get('coordinates') or []))
        print('  distanceKm      :',s.get('distanceKm'))
        print('  updatedAt       :',s.get('updatedAt'))
if not found: print('  ❌ aucune section correspondante')

print('\nLIVE :')
rows=[]
for x in live.get('pairs') or []:
    if {n(x.get('from')),n(x.get('to'))}==want:
        rows.append(x)
        print(' ',x.get('from'),'→',x.get('to'),'|',x.get('sectionId'),'| points',len(x.get('coords') or []))
if not rows:print('  ❌ paire absente de sections.json')

print('\nNETWORK TASK :')
tasks=[]
for t in net.get('tasks') or []:
    a=(t.get('from') or {}).get('name');b=(t.get('to') or {}).get('name')
    if {n(a),n(b)}==want:
        tasks.append(t)
        print('  sectionId       :',t.get('sectionId'))
        print('  routeId         :',t.get('routeId'))
        print('  status          :',t.get('status'))
        print('  impactToday     :',t.get('impactToday'))
        print('  trains          :',', '.join(map(str,(t.get('trainNumbers') or [])[:30])))
if not tasks:print('  ❌ task V8 absent')

print('\nTRAIN ROUTES concernés :')
for num,vars in (net.get('trainRoutes') or {}).items():
    for v in vars or []:
        names=[(s or {}).get('name') for s in (v.get('stops') or [])]
        for i in range(len(names)-1):
            if {n(names[i]),n(names[i+1])}==want:
                print(' ',num,'|',' → '.join(names),'|',v.get('tripId'))
                break
PY

echo
echo "=== 3/8 CE QUE L'EDITEUR V8 ENVOIE AU PUBLISHER V4 ==="
python3 - "$TMP/served.js" "$NETWORK" <<'PY'
from pathlib import Path
import json,re,sys,unicodedata
s=Path(sys.argv[1]).read_text(encoding='utf-8',errors='replace')
net=json.load(open(sys.argv[2],encoding='utf-8'))
FROM='Marne-la-Vallée Chessy';TO='Lyon Perrache'
def n(x):
    x=unicodedata.normalize('NFKD',str(x or ''))
    return ''.join(c for c in x if not unicodedata.combining(c)).strip().lower()
want={n(FROM),n(TO)}
task=next((t for t in net.get('tasks') or [] if {n((t.get('from') or {}).get('name')),n((t.get('to') or {}).get('name'))}==want),None)
if not task:
    print('Task absente');raise SystemExit
print('task.sectionId =',task.get('sectionId'))
print('ID UI V8       = task-'+str(task.get('sectionId')))
print('saveRouteId    =',task.get('routeId'))
print()
print('refreshPublishPreview utilise state.route.id :', 'state.route.id' in (re.search(r'async function refreshPublishPreview\(\).*?\n\}',s,re.S).group(0) if re.search(r'async function refreshPublishPreview\(\).*?\n\}',s,re.S) else ''))
print('publishReady utilise state.route.id          :', "payload.routeId=state.route.id" in s)
print('UI V8 construit id task-*                    :', 'id:`task-${task.sectionId}`' in s)
print('UI V8 garde saveRouteId network-*             :', 'saveRouteId:task.routeId' in s)
PY

echo
echo "=== 4/8 API CATALOG : IDS DE VRAIES VARIANTES GTFS ==="
curl -fsS --max-time 30 \
  "http://127.0.0.1:3111/api/map-v2/route-editor/catalog?t=$(date +%s)" \
  -o "$TMP/catalog.json" || true
python3 - "$TMP/catalog.json" <<'PY'
import json,sys,unicodedata,os
p=sys.argv[1]
if not os.path.exists(p) or os.path.getsize(p)==0:
    print('catalog API indisponible');raise SystemExit
cat=json.load(open(p,encoding='utf-8'))
FROM='Marne-la-Vallée Chessy';TO='Lyon Perrache'
def n(x):
    x=unicodedata.normalize('NFKD',str(x or ''))
    return ''.join(c for c in x if not unicodedata.combining(c)).strip().lower()
want=(n(FROM),n(TO))
rows=[]
for r in cat.get('routes') or []:
    names=[n((s or {}).get('name')) for s in (r.get('stops') or [])]
    hit=any((names[i],names[i+1])==want or (names[i],names[i+1])==want[::-1] for i in range(len(names)-1))
    if hit:rows.append(r)
print('Vraies variantes contenant la paire :',len(rows))
for r in rows[:20]:
    print(' ',r.get('id'),'|',r.get('origin'),'→',r.get('destination'),'| trains',','.join(map(str,(r.get('trainNumbers') or [])[:12])),'| progress',r.get('progress'))
PY

echo
echo "=== 5/8 PUBLISH-PREVIEW AVEC LES IDS ACTUELS DE L'UI ==="
python3 - "$NETWORK" "$TMP/ids.txt" <<'PY'
import json,sys,unicodedata
net=json.load(open(sys.argv[1],encoding='utf-8'))
def n(x):
    x=unicodedata.normalize('NFKD',str(x or ''))
    return ''.join(c for c in x if not unicodedata.combining(c)).strip().lower()
want={n('Marne-la-Vallée Chessy'),n('Lyon Perrache')}
t=next((x for x in net.get('tasks') or [] if {n((x.get('from') or {}).get('name')),n((x.get('to') or {}).get('name'))}==want),None)
if t:
    open(sys.argv[2],'w').write('task-'+str(t.get('sectionId'))+'\n'+str(t.get('routeId') or '')+'\n')
PY
while IFS= read -r RID; do
  [ -n "$RID" ] || continue
  echo "--- routeId=$RID"
  curl -fsS --max-time 60 \
    "http://127.0.0.1:3111/api/map-v2/route-editor/publish-preview?routeId=$(python3 -c 'import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))' "$RID")&t=$(date +%s)" \
    -o "$TMP/preview-one.json" || true
  python3 - "$TMP/preview-one.json" <<'PY'
import json,sys,os
p=sys.argv[1]
if not os.path.exists(p) or os.path.getsize(p)==0:print('  API indisponible');raise SystemExit
x=json.load(open(p,encoding='utf-8'))
print('  ok=',x.get('ok'),' candidates=',len(x.get('candidates') or []),' skipped=',len(x.get('skipped') or []),' totals=',x.get('totals'))
for c in (x.get('candidates') or [])[:5]:print('   CANDIDAT',c.get('routeId'),c.get('signature'))
for s in (x.get('skipped') or [])[:5]:print('   SKIP',s.get('routeId'),s.get('signature'),'manque',s.get('missing'))
PY
done < "$TMP/ids.txt"

echo
echo "=== 6/8 PUBLISH-PREVIEW GLOBAL, SANS ECRITURE ==="
curl -fsS --max-time 120 \
  "http://127.0.0.1:3111/api/map-v2/route-editor/publish-preview?t=$(date +%s)" \
  -o "$TMP/preview-all.json" || true
python3 - "$TMP/preview-all.json" <<'PY'
import json,sys,unicodedata,os
p=sys.argv[1]
if not os.path.exists(p) or os.path.getsize(p)==0:
    print('preview global indisponible');raise SystemExit
x=json.load(open(p,encoding='utf-8'))
def n(v):
    v=unicodedata.normalize('NFKD',str(v or ''))
    return ''.join(c for c in v if not unicodedata.combining(c)).strip().lower()
a=n('Marne-la-Vallée Chessy');b=n('Lyon Perrache')
print('totals =',x.get('totals'))
print('sharedPairs =',x.get('sharedPairs'))
rows=[]
for kind in ('candidates','skipped'):
    for r in x.get(kind) or []:
        sig=n(r.get('signature'))
        if a in sig and b in sig:rows.append((kind,r))
print('Variantes globales contenant les deux gares :',len(rows))
for kind,r in rows[:30]:
    print(' ',kind.upper(),r.get('routeId'),'|',r.get('signature'),'| trains',','.join(map(str,(r.get('numbers') or [])[:20])))
    if kind=='skipped':print('   manque:',r.get('missing'))
PY

echo
echo "=== 7/8 VERIFICATION FRANCE V3 : SECTION LIVE DEJA CONSOMMABLE ==="
for F in carte-core-canonical-v4-preview.html carte-core-preview.html; do
  P="$PUBLIC/$F"
  [ -f "$P" ] || continue
  echo "--- $F"
  grep -qF 'LB_MOORAIL_LIVE_PATH_V44' "$P" && echo "  ✅ live sections actif" || echo "  ❌ live sections absent"
  grep -qF 'lbMoorailPathBetweenStops' "$P" && echo "  ✅ resolver par paire actif" || echo "  ❌ resolver par paire absent"
done

echo
echo "=== 8/8 VERDICT AUTOMATIQUE ==="
python3 - "$STATE" "$LIVE" "$NETWORK" "$TMP/served.js" "$TMP/preview-all.json" <<'PY'
import json,sys,unicodedata,re,os
state=json.load(open(sys.argv[1],encoding='utf-8'));live=json.load(open(sys.argv[2],encoding='utf-8'));net=json.load(open(sys.argv[3],encoding='utf-8'))
js=open(sys.argv[4],encoding='utf-8',errors='replace').read()
preview=json.load(open(sys.argv[5],encoding='utf-8')) if os.path.exists(sys.argv[5]) and os.path.getsize(sys.argv[5]) else {}
def n(x):
    x=unicodedata.normalize('NFKD',str(x or ''))
    return ''.join(c for c in x if not unicodedata.combining(c)).strip().lower()
want={n('Marne-la-Vallée Chessy'),n('Lyon Perrache')}
secs=[s for s in (state.get('sections') or {}).values() if {n((s.get('stopFrom') or {}).get('name')),n((s.get('stopTo') or {}).get('name'))}==want]
liverows=[x for x in live.get('pairs') or [] if {n(x.get('from')),n(x.get('to'))}==want]
tasks=[t for t in net.get('tasks') or [] if {n((t.get('from') or {}).get('name')),n((t.get('to') or {}).get('name'))}==want]
validated=any(s.get('status')=='validated' and len(s.get('coordinates') or [])>=2 for s in secs)
liveok=bool(liverows)
id_mismatch=('id:`task-${task.sectionId}`' in js and 'payload.routeId=state.route.id' in js)
print('section validée :',validated)
print('section LIVE     :',liveok)
print('task V8          :',bool(tasks))
print('mismatch UI V8 / publisher V4 :',id_mismatch)
if validated and liveok and id_mismatch:
    print('\nRESULTAT : ❌ LE BOUTON "PUBLIER CETTE VARIANTE" EST HERITE DE V4 ET N\'EST PLUS COMPATIBLE AVEC LES TASKS V8.')
    print('La brique elle-même est déjà sauvegardée/LIVE ; c\'est le ciblage du vieux publisher qui est cassé.')
    print('Il faut republier par SECTION CANONIQUE -> variantes GTFS impactées, et non par state.route.id task-sec-*.')
elif not validated:
    print('\nRESULTAT : ❌ la brique n\'est pas réellement validée dans STATE.')
elif validated and not liveok:
    print('\nRESULTAT : ❌ la sauvegarde existe mais la brique n\'est pas dans LIVE sections.json.')
else:
    print('\nRESULTAT : ⚠️ cas non tranché automatiquement ; lire les sections 5/6 ci-dessus.')
PY

echo
echo "AUCUNE MODIFICATION EFFECTUEE."
