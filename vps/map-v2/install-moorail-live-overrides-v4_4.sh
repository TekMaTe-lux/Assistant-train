#!/usr/bin/env bash
set -euo pipefail

ROOT="${MOORAIL_ROOT:-/opt/labetaillere-map-v2-src/map-v2}"
PUBLIC="$ROOT/public"
STATE="$ROOT/data/route-editor/moorail-route-editor-state-v1.json"
API="$ROOT/server/route-editor-api.mjs"
LIVE_DIR="$PUBLIC/data/moorail-live-v1"
LIVE_JSON="$LIVE_DIR/sections.json"
SERVICE="labetaillere-map-v2.service"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$ROOT/backups/moorail-live-overrides-v4_4-$STAMP"
TMP="$(mktemp -d /tmp/moorail-live-v44.XXXXXX)"
SUCCESS=0
RESTARTED=0

cleanup(){ rm -rf "$TMP"; }
rollback(){
  [[ "$SUCCESS" == 1 ]] && return 0
  echo "ROLLBACK MOO RAIL LIVE V4.4..." >&2
  [[ -f "$BACKUP/route-editor-api.mjs" ]] && cp -a "$BACKUP/route-editor-api.mjs" "$API"
  for f in "$BACKUP"/*.html; do
    [[ -f "$f" ]] || continue
    cp -a "$f" "$PUBLIC/$(basename "$f")"
  done
  if [[ -f "$BACKUP/sections.json" ]]; then
    mkdir -p "$LIVE_DIR"; cp -a "$BACKUP/sections.json" "$LIVE_JSON"
  elif [[ -f "$BACKUP/live-json.absent" ]]; then
    rm -f "$LIVE_JSON"
  fi
  if [[ "$RESTARTED" == 1 ]]; then systemctl restart "$SERVICE" >/dev/null 2>&1 || true; fi
}
finish(){ rc=$?; trap - EXIT; rollback; cleanup; exit "$rc"; }
trap finish EXIT

[[ ${EUID:-$(id -u)} -eq 0 ]] || { echo "ERREUR: lancer avec sudo/root" >&2; exit 2; }
[[ -f "$STATE" ]] || { echo "ERREUR état MooRail absent: $STATE" >&2; exit 3; }
[[ -f "$API" ]] || { echo "ERREUR API absente: $API" >&2; exit 3; }

SERVICE_USER="$(systemctl show -p User --value "$SERVICE" 2>/dev/null || true)"
SERVICE_GROUP="$(systemctl show -p Group --value "$SERVICE" 2>/dev/null || true)"
[[ -n "$SERVICE_USER" ]] || SERVICE_USER=root
[[ -n "$SERVICE_GROUP" ]] || SERVICE_GROUP="$(id -gn "$SERVICE_USER" 2>/dev/null || echo root)"

mkdir -p "$BACKUP"
cp -a "$API" "$BACKUP/route-editor-api.mjs"
if [[ -f "$LIVE_JSON" ]]; then cp -a "$LIVE_JSON" "$BACKUP/sections.json"; else touch "$BACKUP/live-json.absent"; fi

echo "============================================================"
echo " MOO RAIL V4.4 — VALIDATIONS -> MOUVEMENT LIVE FRANCE V3"
echo "============================================================"
echo "Service user : $SERVICE_USER:$SERVICE_GROUP"
echo "Backup       : $BACKUP"

echo "=== 1/6 Détection du moteur réellement utilisé par France V3 ==="
TARGETS=()
for name in france-v3-preview.html carte-core-canonical-v4-preview.html carte-core-preview.html; do
  f="$PUBLIC/$name"
  [[ -f "$f" ]] || continue
  if grep -qF 'function pathBetweenStops(stopA, stopB)' "$f"; then
    TARGETS+=("$f")
    cp -a "$f" "$BACKUP/$name"
    echo "Moteur détecté : $f"
  fi
done
[[ ${#TARGETS[@]} -gt 0 ]] || { echo "ERREUR: aucun pathBetweenStops trouvé dans les previews" >&2; exit 4; }

echo "=== 2/6 Export initial des sections validées ==="
mkdir -p "$LIVE_DIR"
chown "$SERVICE_USER:$SERVICE_GROUP" "$LIVE_DIR"
chmod 0755 "$LIVE_DIR"
python3 - "$STATE" "$LIVE_JSON" <<'PY'
import json,sys,unicodedata,datetime,os,tempfile
state_path,out_path=sys.argv[1:3]
state=json.load(open(state_path,encoding='utf-8'))

def norm(s):
    s=unicodedata.normalize('NFKD',str(s or ''))
    return ''.join(c for c in s if not unicodedata.combining(c)).strip().lower()

def key(a,b): return norm(a)+'|'+norm(b)

def clean(raw):
    out=[]
    for c in raw or []:
        if not isinstance(c,(list,tuple)) or len(c)<2: continue
        try: lon=float(c[0]); lat=float(c[1])
        except: continue
        if not (-180<=lon<=180 and -90<=lat<=90): continue
        p=[lat,lon]
        if not out or p!=out[-1]: out.append(p)
    return out

best={}
for sid,s in (state.get('sections') or {}).items():
    if not isinstance(s,dict) or s.get('status')!='validated': continue
    a=(s.get('stopFrom') or {}).get('name'); b=(s.get('stopTo') or {}).get('name')
    coords=clean(s.get('coordinates'))
    if not a or not b or len(coords)<2: continue
    updated=str(s.get('updatedAt') or '')
    item={'from':a,'to':b,'coords':coords,'sectionId':sid,'updatedAt':updated,'reversed':False}
    k=key(a,b)
    if k not in best or updated>=best[k]['updatedAt']: best[k]=item
    rev={'from':b,'to':a,'coords':list(reversed(coords)),'sectionId':sid,'updatedAt':updated,'reversed':True}
    rk=key(b,a)
    if rk not in best or updated>=best[rk]['updatedAt']: best[rk]=rev
payload={'version':1,'generatedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'pairs':list(best.values())}
os.makedirs(os.path.dirname(out_path),exist_ok=True)
fd,tmp=tempfile.mkstemp(prefix='sections.',suffix='.json',dir=os.path.dirname(out_path)); os.close(fd)
with open(tmp,'w',encoding='utf-8') as f: json.dump(payload,f,ensure_ascii=False,separators=(',',':'))
os.chmod(tmp,0o644); os.replace(tmp,out_path)
print('Sections orientées exportées :',len(payload['pairs']))
for p in payload['pairs']:
    txt=(p['from']+' → '+p['to']).lower()
    if ('paris' in txt and ('champagne' in txt or 'nancy' in txt)) or ('champagne' in txt and 'nancy' in txt):
        print('  ',p['from'],'→',p['to'],'|',len(p['coords']),'points','| reverse=',p['reversed'])
PY
chown "$SERVICE_USER:$SERVICE_GROUP" "$LIVE_JSON"
chmod 0644 "$LIVE_JSON"

echo "=== 3/6 API : régénération automatique après chaque validation ==="
python3 - "$API" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1]); s=p.read_text(encoding='utf-8')
marker='// LB_MOORAIL_LIVE_OVERRIDES_V44'
if marker not in s:
    anchor="  const reportFile = path.join(storeDir, 'moorail-compile-preview-v2.json');"
    if anchor not in s: raise SystemExit('ERREUR ancre reportFile absente')
    s=s.replace(anchor,anchor+"\n  const liveOverridesFile = path.join(rootDir, 'public', 'data', 'moorail-live-v1', 'sections.json');\n  "+marker,1)

    func=r'''

  function writeLiveOverrides(state) {
    const norm = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
    const key = (a,b) => `${norm(a)}|${norm(b)}`;
    const best = new Map();
    const keep = (k,v) => {
      const old=best.get(k);
      if(!old || String(v.updatedAt||'') >= String(old.updatedAt||'')) best.set(k,v);
    };
    for(const [sectionId,sec] of Object.entries(state?.sections || {})) {
      if(!sec || sec.status!=='validated' || !Array.isArray(sec.coordinates) || sec.coordinates.length<2) continue;
      const from=sec.stopFrom?.name, to=sec.stopTo?.name;
      if(!from || !to) continue;
      const coords=[];
      for(const c of sec.coordinates) {
        if(!Array.isArray(c) || c.length<2) continue;
        const lon=Number(c[0]),lat=Number(c[1]);
        if(!Number.isFinite(lon)||!Number.isFinite(lat)||Math.abs(lon)>180||Math.abs(lat)>90) continue;
        const pt=[lat,lon];
        if(!coords.length || coords.at(-1)[0]!==pt[0] || coords.at(-1)[1]!==pt[1]) coords.push(pt);
      }
      if(coords.length<2) continue;
      const updatedAt=String(sec.updatedAt||'');
      keep(key(from,to),{from,to,coords,sectionId,updatedAt,reversed:false});
      keep(key(to,from),{from:to,to:from,coords:[...coords].reverse(),sectionId,updatedAt,reversed:true});
    }
    atomicWrite(liveOverridesFile,{version:1,generatedAt:new Date().toISOString(),pairs:[...best.values()]});
  }
'''
    anchor2='  function writeDerived(state) {'
    if anchor2 not in s: raise SystemExit('ERREUR ancre writeDerived absente')
    s=s.replace(anchor2,func+'\n'+anchor2,1)

    # Toujours régénérer après save/delete via writeDerived.
    needle="    atomicWrite(templatesFile,{version:1,updatedAt:state.updatedAt,routes:templates});"
    if needle not in s:
        needle="    atomicWrite(templatesFile, { version: 1, updatedAt: state.updatedAt, routes: templates });"
    if needle not in s: raise SystemExit('ERREUR ancre templatesFile absente')
    s=s.replace(needle,needle+'\n    writeLiveOverrides(state);',1)
    p.write_text(s,encoding='utf-8')
PY
node --check "$API"

echo "=== 4/6 Preview : priorité MooRail dans pathBetweenStops ==="
for f in "${TARGETS[@]}"; do
python3 - "$f" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1]); s=p.read_text(encoding='utf-8')
marker='/* LB_MOORAIL_LIVE_PATH_V44 */'
if marker in s:
    print('Déjà patché :',p)
    raise SystemExit(0)

helper=r'''

  /* LB_MOORAIL_LIVE_PATH_V44 */
  const lbMoorailLivePairs = new Map();
  let lbMoorailLiveLoaded = false;
  function lbMoorailNormName(value){
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
  }
  function lbMoorailPairKey(a,b){ return `${lbMoorailNormName(a)}|${lbMoorailNormName(b)}`; }
  function lbMoorailStopName(stop){ return stop?.name || stop?.stop_name || stop?.label || ''; }
  async function lbLoadMoorailOverrides(){
    try{
      const res=await fetch(`/map-v2/data/moorail-live-v1/sections.json?v=${Date.now()}`,{cache:'no-store'});
      if(!res.ok) throw new Error(`HTTP ${res.status}`);
      const payload=await res.json();
      lbMoorailLivePairs.clear();
      for(const item of payload?.pairs || []){
        if(!item?.from || !item?.to || !Array.isArray(item.coords) || item.coords.length<2) continue;
        lbMoorailLivePairs.set(lbMoorailPairKey(item.from,item.to),item);
      }
      lbMoorailLiveLoaded=true;
      console.info('[MOO RAIL LIVE] sections chargées :',lbMoorailLivePairs.size);
    }catch(error){
      lbMoorailLiveLoaded=false;
      console.warn('[MOO RAIL LIVE] overrides indisponibles',error);
    }
  }
  function lbMoorailPathBetweenStops(stopA,stopB){
    if(!lbMoorailLiveLoaded || !stopA || !stopB) return null;
    const item=lbMoorailLivePairs.get(lbMoorailPairKey(lbMoorailStopName(stopA),lbMoorailStopName(stopB)));
    if(!item || !Array.isArray(item.coords) || item.coords.length<2) return null;
    const path=makePath(item.coords.map(c=>[Number(c[0]),Number(c[1])]),false);
    if(!path || !path.totalDist) return null;
    path.moorailValidated=true;
    path.moorailSectionId=item.sectionId || null;
    return path;
  }
'''
anchor='  function pathBetweenStops(stopA, stopB){'
if anchor not in s: raise SystemExit('ERREUR ancre pathBetweenStops absente')
s=s.replace(anchor,helper+'\n'+anchor,1)
needle='  function pathBetweenStops(stopA, stopB){\n    if (!stopA || !stopB) return null;'
repl="  function pathBetweenStops(stopA, stopB){\n    if (!stopA || !stopB) return null;\n    const moorail=lbMoorailPathBetweenStops(stopA,stopB);\n    if(moorail) return moorail;"
if needle not in s: raise SystemExit('ERREUR corps pathBetweenStops inattendu')
s=s.replace(needle,repl,1)

# Garantit que la bibliothèque est chargée avant tout calcul GTFS/mouvement.
load='  async function loadGTFS(){\n    try {'
if load not in s: raise SystemExit('ERREUR ancre loadGTFS absente')
s=s.replace(load,"  async function loadGTFS(){\n    try {\n      await lbLoadMoorailOverrides();",1)
p.write_text(s,encoding='utf-8')
print('Patché :',p)
PY
done

echo "=== 5/6 Contrôles + redémarrage ==="
python3 - "$LIVE_JSON" <<'PY'
import json,sys
p=json.load(open(sys.argv[1],encoding='utf-8'))
assert p.get('version')==1,p
pairs=p.get('pairs') or []
assert len(pairs)>=20,len(pairs)
assert all(isinstance(x.get('coords'),list) and len(x['coords'])>=2 for x in pairs), 'coordonnées invalides'
print('JSON live :',len(pairs),'sections orientées')
PY
for f in "${TARGETS[@]}"; do
  grep -qF 'LB_MOORAIL_LIVE_PATH_V44' "$f"
  grep -qF 'const moorail=lbMoorailPathBetweenStops(stopA,stopB)' "$f"
done

RESTARTED=1
systemctl restart "$SERVICE"
for _ in $(seq 1 30); do
  if systemctl is-active --quiet "$SERVICE" && curl -fsS --max-time 2 http://127.0.0.1:3111/api/map-v2/health >/dev/null 2>&1; then break; fi
  sleep 1
done
systemctl is-active --quiet "$SERVICE"

curl -fsS --max-time 5 "http://127.0.0.1:3111/data/moorail-live-v1/sections.json?v=$STAMP" -o "$TMP/live.json"
python3 - "$TMP/live.json" <<'PY'
import json,sys
p=json.load(open(sys.argv[1],encoding='utf-8'))
print('Servi par Map V2 :',len(p.get('pairs') or []),'sections orientées')
PY

for f in "${TARGETS[@]}"; do
  name="$(basename "$f")"
  curl -fsS --max-time 5 "http://127.0.0.1:3111/$name?v=$STAMP" | grep -qF 'LB_MOORAIL_LIVE_PATH_V44'
done

echo "=== 6/6 Terminé ==="
SUCCESS=1
trap - EXIT
cleanup
cat > "$BACKUP/ROLLBACK.sh" <<EOF
#!/usr/bin/env bash
set -euo pipefail
cp -a '$BACKUP/route-editor-api.mjs' '$API'
EOF
for f in "${TARGETS[@]}"; do
  name="$(basename "$f")"
  printf "cp -a '%s/%s' '%s'\n" "$BACKUP" "$name" "$f" >> "$BACKUP/ROLLBACK.sh"
done
cat >> "$BACKUP/ROLLBACK.sh" <<EOF
if [ -f '$BACKUP/sections.json' ]; then mkdir -p '$LIVE_DIR'; cp -a '$BACKUP/sections.json' '$LIVE_JSON'; else rm -f '$LIVE_JSON'; fi
systemctl restart '$SERVICE'
EOF
chmod 0755 "$BACKUP/ROLLBACK.sh"

echo
echo "============================================================"
echo " MOO RAIL V4.4 INSTALLE — OVERRIDE LIVE ACTIF"
echo "============================================================"
echo "Les sections validées sont maintenant prioritaires dans"
echo "pathBetweenStops() de France V3 Preview."
echo ""
echo "Conséquence :"
echo " - les TGV absents de data/generated (ex. 2509) peuvent utiliser"
echo "   les mêmes sections validées Paris/Champagne/Nancy"
echo " - le sens inverse est déjà exporté"
echo " - toute nouvelle validation régénère automatiquement le JSON live"
echo ""
echo "JSON   : /map-v2/data/moorail-live-v1/sections.json"
echo "Carte  : https://vps.labetaillere.fr/map-v2/france-v3-preview.html"
echo "Backup : $BACKUP"
echo "============================================================"
