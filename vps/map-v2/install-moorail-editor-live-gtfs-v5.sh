#!/usr/bin/env bash
set -euo pipefail

ROOT="${MOORAIL_ROOT:-/opt/labetaillere-map-v2-src/map-v2}"
PUBLIC="$ROOT/public"
API="$ROOT/server/route-editor-api.mjs"
HTML="$PUBLIC/moorail-route-editor.html"
JS="$PUBLIC/moorail-route-editor-stops.js"
BUILDER="$ROOT/scripts/build-moorail-live-gtfs-catalog-v1.py"
STORE="$ROOT/data/route-editor"
LIVE_CAT="$STORE/moorail-live-gtfs-trips-v1.json"
GTFS_DIR="${MOORAIL_LIVE_GTFS_DIR:-/var/www/html/gtfs/static}"
SERVICE="labetaillere-map-v2.service"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$ROOT/backups/moorail-editor-live-gtfs-v5-$STAMP"
TMP="$(mktemp -d /tmp/moorail-v5-livegtfs.XXXXXX)"
SUCCESS=0
RESTARTED=0

cleanup(){ rm -rf "$TMP"; }
rollback(){
  [[ "$SUCCESS" == 1 ]] && return 0
  echo "ROLLBACK MOO RAIL V5..." >&2
  [[ -f "$BACKUP/route-editor-api.mjs" ]] && cp -a "$BACKUP/route-editor-api.mjs" "$API" || true
  [[ -f "$BACKUP/moorail-route-editor.html" ]] && cp -a "$BACKUP/moorail-route-editor.html" "$HTML" || true
  [[ -f "$BACKUP/moorail-route-editor-stops.js" ]] && cp -a "$BACKUP/moorail-route-editor-stops.js" "$JS" || true
  if [[ -f "$BACKUP/builder.absent" ]]; then rm -f "$BUILDER"; elif [[ -f "$BACKUP/build-moorail-live-gtfs-catalog-v1.py" ]]; then cp -a "$BACKUP/build-moorail-live-gtfs-catalog-v1.py" "$BUILDER"; fi
  if [[ -f "$BACKUP/catalog.absent" ]]; then rm -f "$LIVE_CAT"; elif [[ -f "$BACKUP/moorail-live-gtfs-trips-v1.json" ]]; then cp -a "$BACKUP/moorail-live-gtfs-trips-v1.json" "$LIVE_CAT"; fi
  if [[ "$RESTARTED" == 1 ]]; then systemctl restart "$SERVICE" >/dev/null 2>&1 || true; fi
}
finish(){ rc=$?; trap - EXIT; rollback; cleanup; exit "$rc"; }
trap finish EXIT

[[ ${EUID:-$(id -u)} -eq 0 ]] || { echo "ERREUR: lancer avec sudo/root" >&2; exit 2; }
for f in "$API" "$HTML" "$JS" "$GTFS_DIR/trips.txt" "$GTFS_DIR/stop_times.txt" "$GTFS_DIR/stops.txt"; do
  [[ -f "$f" ]] || { echo "ERREUR fichier absent: $f" >&2; exit 3; }
done

SERVICE_USER="$(systemctl show -p User --value "$SERVICE" 2>/dev/null || true)"
SERVICE_GROUP="$(systemctl show -p Group --value "$SERVICE" 2>/dev/null || true)"
[[ -n "$SERVICE_USER" ]] || SERVICE_USER=root
[[ -n "$SERVICE_GROUP" ]] || SERVICE_GROUP="$(id -gn "$SERVICE_USER" 2>/dev/null || echo root)"

mkdir -p "$BACKUP" "$ROOT/scripts" "$STORE"
cp -a "$API" "$BACKUP/route-editor-api.mjs"
cp -a "$HTML" "$BACKUP/moorail-route-editor.html"
cp -a "$JS" "$BACKUP/moorail-route-editor-stops.js"
if [[ -f "$BUILDER" ]]; then cp -a "$BUILDER" "$BACKUP/build-moorail-live-gtfs-catalog-v1.py"; else touch "$BACKUP/builder.absent"; fi
if [[ -f "$LIVE_CAT" ]]; then cp -a "$LIVE_CAT" "$BACKUP/moorail-live-gtfs-trips-v1.json"; else touch "$BACKUP/catalog.absent"; fi

echo "============================================================"
echo " MOO RAIL V5 — TOUS LES TGV DU GTFS LIVE DANS L'EDITEUR"
echo "============================================================"
echo "GTFS actif   : $GTFS_DIR"
echo "Service user : $SERVICE_USER:$SERVICE_GROUP"
echo "Backup       : $BACKUP"

echo "=== 1/6 Installation du constructeur GTFS live ==="
cat > "$BUILDER" <<'PY'
#!/usr/bin/env python3
import argparse,csv,json,re,hashlib,datetime,os,tempfile
from pathlib import Path

FAST_RE=re.compile(r'(^|[^A-Z])(TGV|OUIGO|LYRIA|ICE|AVR|TRENITALIA|FRECCIAROSSA|OUI|OGO|TRN)([^A-Z]|$)')
NUM_RE=re.compile(r'^\s*(\d{3,6})\s*$')
ID_NUM_RE=re.compile(r'^OCESN(\d{3,6})',re.I)

def rows(path):
    with path.open('r',encoding='utf-8-sig',errors='replace',newline='') as f:
        yield from csv.DictReader(f)

def num_for(t):
    for k in ('trip_short_name','trip_headsign'):
        m=NUM_RE.match(str(t.get(k) or ''))
        if m:return m.group(1)
    m=ID_NUM_RE.search(str(t.get('trip_id') or ''))
    return m.group(1) if m else None

def is_fast(t,route):
    dump=' '.join(str(x or '') for x in (
        t.get('trip_id'),t.get('trip_short_name'),t.get('trip_headsign'),t.get('route_id'),
        route.get('route_short_name'),route.get('route_long_name'),route.get('route_desc')
    )).upper()
    return ':OUI:' in dump or ':OUIGO:' in dump or bool(FAST_RE.search(dump))

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
        stops[sid]={
            'name':str(s.get('stop_name') or sid),
            'lat':f(s.get('stop_lat')),
            'lon':f(s.get('stop_lon'))
        }

    candidates={}
    raw_trip_count=0
    for t in rows(src/'trips.txt'):
        raw_trip_count+=1
        rid=str(t.get('route_id') or '')
        if not is_fast(t,routes.get(rid,{}) ): continue
        n=num_for(t)
        if not n: continue
        tid=str(t.get('trip_id') or '')
        if not tid:continue
        candidates[tid]={**t,'_number':n}

    seq={tid:[] for tid in candidates}
    matched_stop_times=0
    for r in rows(src/'stop_times.txt'):
        tid=str(r.get('trip_id') or '')
        if tid not in candidates:continue
        try:order=int(float(r.get('stop_sequence') or 0))
        except:order=0
        sid=str(r.get('stop_id') or '')
        seq[tid].append((order,sid,str(r.get('arrival_time') or ''),str(r.get('departure_time') or '')))
        matched_stop_times+=1

    # Un objet synthétique par numéro + signature. Les dizaines de dates GTFS
    # d'un même train ne doivent pas remplir l'éditeur de doublons.
    synthetic={}
    signatures={}
    missing_coords=0
    for tid,t in candidates.items():
        items=sorted(seq.get(tid) or [],key=lambda x:x[0])
        if len(items)<2:continue
        ss=[]
        valid=True
        for _,sid,arr,dep in items:
            meta=stops.get(sid)
            if not meta or meta['lat'] is None or meta['lon'] is None:
                missing_coords+=1; valid=False; break
            tm=dep or arr
            ss.append({'name':meta['name'],'lat':meta['lat'],'lon':meta['lon'],'time':tm,'displayTime':tm})
        if not valid or len(ss)<2:continue
        signature=' → '.join(x['name'] for x in ss)
        number=str(t['_number'])
        dedup=number+'\0'+signature
        if dedup in signatures:continue
        h=hashlib.sha1(dedup.encode('utf-8')).hexdigest()[:18]
        sid='LIVEGTFS:'+number+':'+h
        route=routes.get(str(t.get('route_id') or ''),{})
        synthetic[sid]={
            'id':sid,
            'number':number,
            'category':'TGV_LIVE_GTFS',
            'routeName':str(route.get('route_long_name') or route.get('route_short_name') or 'GTFS SNCF live'),
            'routeShortName':str(route.get('route_short_name') or ''),
            'source':'SNCF_LIVE_GTFS',
            'liveGtfs':True,
            'stops':ss
        }
        signatures[dedup]=sid

    payload={
        'version':1,
        'generatedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'source':str(src),
        'stats':{
            'rawTrips':raw_trip_count,
            'highSpeedDatedTrips':len(candidates),
            'matchedStopTimes':matched_stop_times,
            'syntheticTrips':len(synthetic),
            'uniqueSignatures':len({ ' → '.join(s['name'] for s in t['stops']) for t in synthetic.values() }),
            'missingCoordinates':missing_coords
        },
        'trips':synthetic
    }
    out.parent.mkdir(parents=True,exist_ok=True)
    fd,tmp=tempfile.mkstemp(prefix='live-gtfs.',suffix='.json',dir=str(out.parent));os.close(fd)
    with open(tmp,'w',encoding='utf-8') as fobj: json.dump(payload,fobj,ensure_ascii=False,separators=(',',':'))
    os.chmod(tmp,0o644);os.replace(tmp,out)
    print(json.dumps(payload['stats'],ensure_ascii=False))

if __name__=='__main__':main()
PY
chmod 0755 "$BUILDER"
python3 -m py_compile "$BUILDER"

echo "=== 2/6 Construction du catalogue TGV live actuel ==="
python3 "$BUILDER" --source "$GTFS_DIR" --output "$LIVE_CAT" | tee "$TMP/builder.out"
chown "$SERVICE_USER:$SERVICE_GROUP" "$LIVE_CAT"
chmod 0644 "$LIVE_CAT"
python3 - "$LIVE_CAT" <<'PY'
import json,sys
p=json.load(open(sys.argv[1],encoding='utf-8'))
s=p.get('stats') or {}
assert s.get('syntheticTrips',0)>20,s
nums={str(t.get('number')) for t in (p.get('trips') or {}).values()}
print('TGV synthétiques :',s.get('syntheticTrips'))
print('Signatures       :',s.get('uniqueSignatures'))
print('5454 présent     :', '5454' in nums)
print('2509 présent     :', '2509' in nums)
assert '5454' in nums,'ERREUR: 5454 absent du GTFS live construit'
PY

echo "=== 3/6 Patch API : union data/generated + GTFS live ==="
python3 - "$API" "$GTFS_DIR" <<'PY'
from pathlib import Path
import sys,re
p=Path(sys.argv[1]);gtfs=sys.argv[2]
s=p.read_text(encoding='utf-8')
marker='// LB_MOORAIL_EDITOR_LIVE_GTFS_V5'
if marker not in s:
    anchor='  fs.mkdirSync(storeDir,{recursive:true});'
    if anchor not in s:
        anchor='  fs.mkdirSync(storeDir, { recursive:true });'
    if anchor not in s: raise SystemExit('ERREUR ancre fs.mkdirSync(storeDir) absente')
    block=r'''

  // LB_MOORAIL_EDITOR_LIVE_GTFS_V5
  const liveGtfsCatalogFile = path.join(storeDir, 'moorail-live-gtfs-trips-v1.json');
  const liveGtfsBuilder = path.join(rootDir, 'scripts', 'build-moorail-live-gtfs-catalog-v1.py');
  const liveGtfsSourceDir = process.env.MOORAIL_LIVE_GTFS_DIR || '__GTFS_DIR__';

  function ensureLiveGtfsCatalog() {
    const sourceTrips=path.join(liveGtfsSourceDir,'trips.txt');
    if(!fs.existsSync(sourceTrips) || !fs.existsSync(liveGtfsBuilder)) return;
    let stale=!fs.existsSync(liveGtfsCatalogFile);
    try {
      if(!stale) stale=fs.statSync(sourceTrips).mtimeMs > fs.statSync(liveGtfsCatalogFile).mtimeMs;
    } catch { stale=true; }
    if(!stale) return;
    execFileSync('/usr/bin/python3',[liveGtfsBuilder,'--source',liveGtfsSourceDir,'--output',liveGtfsCatalogFile],{
      encoding:'utf8',maxBuffer:32*1024*1024,env:{...process.env,MOORAIL_ROOT:rootDir}
    });
  }

  function liveGtfsTrips() {
    try { ensureLiveGtfsCatalog(); }
    catch(error) { console.warn('[MOO RAIL V5] refresh GTFS live impossible:',error.message); }
    const payload=readJson(liveGtfsCatalogFile,{trips:{}});
    return payload && typeof payload.trips==='object' ? payload.trips : {};
  }

  function mergedEditorTrips() {
    return Object.assign({}, trips || {}, liveGtfsTrips());
  }

  function mergedEditorCatalog(state) {
    const catalog=buildCatalog(mergedEditorTrips(),state);
    catalog.liveGtfs=true;
    catalog.liveGtfsStats=readJson(liveGtfsCatalogFile,{stats:{}}).stats || {};
    return catalog;
  }

  function liveRouteDistanceKm(route,state) {
    if(!route || !Array.isArray(route.sections)) return 0;
    const shared=buildSharedLookup(state);
    let km=0;
    for(const sec of route.sections) {
      let saved=state?.sections?.[sec.id];
      if(saved?.status!=='validated') {
        const hit=shared.get(pairKey(sec.from?.name,sec.to?.name));
        saved=hit?.sectionId ? state?.sections?.[hit.sectionId] : null;
      }
      const value=Number(saved?.distanceKm);
      if(Number.isFinite(value)) km+=value;
    }
    return km;
  }

  function liveRouteReport(routeId) {
    if(!routeId) return null;
    const state=loadState();
    const catalog=mergedEditorCatalog(state);
    const route=(catalog.routes||[]).find(r=>r.id===routeId);
    if(!route) return null;
    const missing=(route.sections||[]).filter(x=>x.status!=='validated').map(x=>`${x.from?.name||'?'} → ${x.to?.name||'?'}`);
    if(missing.length) {
      return {ok:true,candidates:[],skipped:[{routeId:route.id,signature:route.signature,missing}],totals:{routes:0,trips:0},liveGtfs:true};
    }
    const candidate={
      routeId:route.id,signature:route.signature,trips:Number(route.tripCount||0),
      km:liveRouteDistanceKm(route,state),sections:(route.sections||[]).length,
      numbers:route.trainNumbers||[],pathId:'MOORAIL_LIVE_SECTIONS',liveOnly:true
    };
    return {ok:true,candidates:[candidate],skipped:[],totals:{routes:1,trips:candidate.trips},liveGtfs:true,liveOnly:true};
  }

  function publicationPreviewV5(routeId) {
    let report=null;
    try { report=runCompiler({routeId,apply:false}); }
    catch(error) { report={ok:true,candidates:[],skipped:[],totals:{routes:0,trips:0},compilerError:error.message}; }
    if(Array.isArray(report?.candidates) && report.candidates.length) return report;
    return liveRouteReport(routeId) || report;
  }
'''.replace('__GTFS_DIR__',gtfs.replace('\\','\\\\').replace("'","\\'"))
    s=s.replace(anchor,anchor+block,1)

# Catalogue: fusionne les objets data/generated avec les TGV du GTFS statique réellement utilisé.
if 'mergedEditorCatalog(state)' not in s[s.find("url.pathname===`${API_PREFIX}/catalog`"):s.find("url.pathname===`${API_PREFIX}/catalog`")+500]:
    s2,n=re.subn(r'buildCatalog\(trips\s*,\s*state\)', 'mergedEditorCatalog(state)', s, count=1)
    if n!=1: raise SystemExit('ERREUR impossible de patcher GET /catalog')
    s=s2

# Analyse du bouton Publier : si le compilateur data/generated ne connaît pas la variante,
# l'état des sections live devient l'autorité.
s=s.replace('send(res,200,runCompiler({routeId,apply:false}));','send(res,200,publicationPreviewV5(routeId));',1)

# Publication d'une variante live-only : les sections sont déjà dans sections.json V4.5.
# On renvoie donc une vraie réussite au jeu et on redémarre Map V2 pour garantir la prise en compte.
old="""          const report=runCompiler({routeId,apply:true});\n          if(!report?.totals?.trips) return send(res,400,{ok:false,error:'Aucune circulation prête à publier',report});"""
new="""          let report=runCompiler({routeId,apply:true});\n          if(!report?.totals?.trips) {\n            const liveReport=liveRouteReport(routeId);\n            if(!liveReport?.candidates?.length) return send(res,400,{ok:false,error:'Aucune circulation prête à publier',report:liveReport||report});\n            report=liveReport;\n          }"""
if old in s:
    s=s.replace(old,new,1)
elif 'const liveReport=liveRouteReport(routeId);' not in s:
    raise SystemExit('ERREUR ancre POST /publish absente')

p.write_text(s,encoding='utf-8')
PY
node --check "$API"

echo "=== 4/6 Interface V5 ==="
python3 - "$HTML" "$JS" <<'PY'
from pathlib import Path
import sys,re
html=Path(sys.argv[1]); js=Path(sys.argv[2])
h=html.read_text(encoding='utf-8')
h=h.replace('V4 · PARTAGE + PUBLICATION','V5 · GTFS LIVE + PARTAGE')
h=h.replace('V4.2 · PARTAGE + PUBLICATION','V5 · GTFS LIVE + PARTAGE')
# Cache-bust du JS sans supposer la version actuellement installée.
h=re.sub(r'/map-v2/moorail-route-editor-stops\.js\?v=[^"\']+', '/map-v2/moorail-route-editor-stops.js?v=5', h)
html.write_text(h,encoding='utf-8')

s=js.read_text(encoding='utf-8')
# La recherche contient déjà les numéros fournis par le catalogue; aucune nouvelle logique lourde côté navigateur.
# On ajoute seulement une indication discrète si la route provient du catalogue GTFS live.
needle="el.routeMeta.textContent=`${state.route.tripCount||0} circulations · trains ${(state.route.trainNumbers||[]).slice(0,12).join(', ')}`;"
repl="el.routeMeta.textContent=`${state.route.tripCount||0} circulation(s) / variante(s) · trains ${(state.route.trainNumbers||[]).slice(0,12).join(', ')}${state.route.liveGtfsCount?' · GTFS LIVE':''}`;"
if needle in s:s=s.replace(needle,repl,1)
js.write_text(s,encoding='utf-8')
PY
node --check "$JS"

echo "=== 5/6 Redémarrage + contrôle catalogue 5454 / 2509 ==="
chown "$SERVICE_USER:$SERVICE_GROUP" "$LIVE_CAT"
chmod 0644 "$LIVE_CAT"
RESTARTED=1
systemctl restart "$SERVICE"
for _ in $(seq 1 30); do
  if systemctl is-active --quiet "$SERVICE" && curl -fsS --max-time 2 http://127.0.0.1:3111/api/map-v2/health >/dev/null 2>&1; then break; fi
  sleep 1
done
systemctl is-active --quiet "$SERVICE"
curl -fsS --max-time 10 "http://127.0.0.1:3111/api/map-v2/route-editor/catalog?t=$STAMP" -o "$TMP/catalog.json"
python3 - "$TMP/catalog.json" <<'PY'
import json,sys
cat=json.load(open(sys.argv[1],encoding='utf-8'))
routes=cat.get('routes') or []
print('Routes catalogue :',len(routes))
print('Shared pairs     :',cat.get('sharedPairCount'))
print('GTFS stats       :',cat.get('liveGtfsStats'))
for number in ('5454','2509'):
    hits=[r for r in routes if number in [str(x) for x in (r.get('trainNumbers') or [])]]
    print()
    print('TGV',number,':',len(hits),'variante(s)')
    for r in hits[:8]:
        p=r.get('progress') or {}
        print(' ',r.get('id'),'|',p.get('validated'), '/',p.get('total'),'|',r.get('signature'))
        for sec in r.get('sections') or []:
            if sec.get('status')!='validated':
                print('    🟡',sec.get('from',{}).get('name'),'→',sec.get('to',{}).get('name'))
assert any('5454' in [str(x) for x in (r.get('trainNumbers') or [])] for r in routes),'ERREUR: 5454 toujours absent du catalogue éditeur'
PY

echo "=== 6/6 Contrôle page servie ==="
curl -fsS --max-time 5 "http://127.0.0.1:3111/moorail-route-editor.html?t=$STAMP" -o "$TMP/editor.html"
grep -F 'V5 · GTFS LIVE + PARTAGE' "$TMP/editor.html" >/dev/null
curl -fsS --max-time 5 http://127.0.0.1:3111/api/map-v2/health > "$TMP/health.json"
cat "$TMP/health.json"; echo

SUCCESS=1
trap - EXIT
cleanup

cat > "$BACKUP/ROLLBACK.sh" <<EOF
#!/usr/bin/env bash
set -euo pipefail
cp -a '$BACKUP/route-editor-api.mjs' '$API'
cp -a '$BACKUP/moorail-route-editor.html' '$HTML'
cp -a '$BACKUP/moorail-route-editor-stops.js' '$JS'
if [ -f '$BACKUP/build-moorail-live-gtfs-catalog-v1.py' ]; then cp -a '$BACKUP/build-moorail-live-gtfs-catalog-v1.py' '$BUILDER'; else rm -f '$BUILDER'; fi
if [ -f '$BACKUP/moorail-live-gtfs-trips-v1.json' ]; then cp -a '$BACKUP/moorail-live-gtfs-trips-v1.json' '$LIVE_CAT'; else rm -f '$LIVE_CAT'; fi
systemctl restart '$SERVICE'
EOF
chmod 0755 "$BACKUP/ROLLBACK.sh"

echo
echo "============================================================"
echo " MOO RAIL V5 INSTALLE — CATALOGUE TGV LIVE NATIONAL"
echo "============================================================"
echo "Le jeu utilise maintenant l'union :"
echo " - data/generated (moteur Map V2)"
echo " - /var/www/html/gtfs/static (GTFS réellement chargé par France V3)"
echo ""
echo "Les variantes datées identiques sont dédupliquées :"
echo "un même 5454 sur 20 dates n'apparaît pas 20 fois."
echo ""
echo "Le catalogue live est reconstruit automatiquement si trips.txt change."
echo "Une route live-only entièrement couverte peut aussi être publiée depuis le bouton."
echo ""
echo "Editeur : https://vps.labetaillere.fr/map-v2/moorail-route-editor.html"
echo "Carte   : https://vps.labetaillere.fr/map-v2/france-v3-preview.html"
echo "Backup  : $BACKUP"
echo "============================================================"
