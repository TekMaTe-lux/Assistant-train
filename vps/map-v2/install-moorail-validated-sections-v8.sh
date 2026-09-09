#!/usr/bin/env bash
set -euo pipefail

ROOT="${MOORAIL_ROOT:-/opt/labetaillere-map-v2-src/map-v2}"
PUBLIC="$ROOT/public"
JS="$PUBLIC/moorail-route-editor-stops.js"
HTML="$PUBLIC/moorail-route-editor.html"
HTML2="$PUBLIC/moorail-route-editor-stops.html"
STATE="$ROOT/data/route-editor/moorail-route-editor-state-v1.json"
LIVE="$PUBLIC/data/moorail-live-v1/sections.json"
LIVE_CAT="$ROOT/data/route-editor/moorail-live-gtfs-trips-v1.json"
OLD_BUILDER="$ROOT/scripts/build-moorail-live-gtfs-catalog-v1.py"
NET_BUILDER="$ROOT/scripts/build-moorail-network-v8.py"
NET_DIR="$PUBLIC/data/moorail-network-v8"
NET_JSON="$NET_DIR/network.json"
GTFS="${MOORAIL_LIVE_GTFS_DIR:-/var/www/html/gtfs/static}"
SERVICE="labetaillere-map-v2.service"
TIMER_UNIT="/etc/systemd/system/moorail-network-v8-refresh.timer"
SERVICE_UNIT="/etc/systemd/system/moorail-network-v8-refresh.service"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$ROOT/backups/moorail-validated-sections-v8-$STAMP"
TMP="$(mktemp -d /tmp/moorail-v8.XXXXXX)"
BASE="https://raw.githubusercontent.com/TekMaTe-lux/Assistant-train/main/vps/map-v2"
SUCCESS=0
RESTARTED=0

cleanup(){ rm -rf "$TMP"; }
rollback(){
  [[ "$SUCCESS" == 1 ]] && return 0
  echo "ROLLBACK MOO RAIL V8..." >&2
  for name in moorail-route-editor.html moorail-route-editor-stops.html moorail-route-editor-stops.js carte-core-canonical-v4-preview.html carte-core-preview.html france-v3-preview.html; do
    [[ -f "$BACKUP/$name" ]] && cp -a "$BACKUP/$name" "$PUBLIC/$name" || true
  done
  [[ -f "$BACKUP/state.json" ]] && cp -a "$BACKUP/state.json" "$STATE" || true
  if [[ -f "$BACKUP/live.json" ]]; then cp -a "$BACKUP/live.json" "$LIVE"; fi
  if [[ -f "$BACKUP/live-cat.json" ]]; then cp -a "$BACKUP/live-cat.json" "$LIVE_CAT"; elif [[ -f "$BACKUP/live-cat.absent" ]]; then rm -f "$LIVE_CAT"; fi
  if [[ -f "$BACKUP/old-builder.py" ]]; then cp -a "$BACKUP/old-builder.py" "$OLD_BUILDER"; elif [[ -f "$BACKUP/old-builder.absent" ]]; then rm -f "$OLD_BUILDER"; fi
  if [[ -f "$BACKUP/net-builder.py" ]]; then cp -a "$BACKUP/net-builder.py" "$NET_BUILDER"; elif [[ -f "$BACKUP/net-builder.absent" ]]; then rm -f "$NET_BUILDER"; fi
  if [[ -d "$BACKUP/network-dir" ]]; then rm -rf "$NET_DIR"; cp -a "$BACKUP/network-dir" "$NET_DIR"; elif [[ -f "$BACKUP/network-dir.absent" ]]; then rm -rf "$NET_DIR"; fi
  if [[ -f "$BACKUP/refresh.service" ]]; then cp -a "$BACKUP/refresh.service" "$SERVICE_UNIT"; else rm -f "$SERVICE_UNIT"; fi
  if [[ -f "$BACKUP/refresh.timer" ]]; then cp -a "$BACKUP/refresh.timer" "$TIMER_UNIT"; else rm -f "$TIMER_UNIT"; fi
  systemctl daemon-reload >/dev/null 2>&1 || true
  systemctl disable --now moorail-network-v8-refresh.timer >/dev/null 2>&1 || true
  if [[ -f "$BACKUP/refresh.timer" ]]; then systemctl enable --now moorail-network-v8-refresh.timer >/dev/null 2>&1 || true; fi
  if [[ "$RESTARTED" == 1 ]]; then systemctl restart "$SERVICE" >/dev/null 2>&1 || true; fi
}
finish(){ rc=$?; trap - EXIT; rollback; cleanup; exit "$rc"; }
trap finish EXIT

[[ ${EUID:-$(id -u)} -eq 0 ]] || { echo "ERREUR: lancer avec sudo/root" >&2; exit 2; }
for f in "$JS" "$HTML" "$STATE" "$LIVE" "$GTFS/trips.txt" "$GTFS/stop_times.txt" "$GTFS/stops.txt"; do
  [[ -f "$f" ]] || { echo "ERREUR fichier absent: $f" >&2; exit 3; }
done

SERVICE_USER="$(systemctl show -p User --value "$SERVICE" 2>/dev/null || true)"
SERVICE_GROUP="$(systemctl show -p Group --value "$SERVICE" 2>/dev/null || true)"
[[ -n "$SERVICE_USER" ]] || SERVICE_USER=root
[[ -n "$SERVICE_GROUP" ]] || SERVICE_GROUP="$(id -gn "$SERVICE_USER" 2>/dev/null || echo root)"

echo "============================================================"
echo " MOO RAIL V8 — VALIDATED SECTIONS / RESEAU TGV"
echo "============================================================"
echo "Root         : $ROOT"
echo "GTFS         : $GTFS"
echo "Service user : $SERVICE_USER:$SERVICE_GROUP"
echo

echo "=== 0/10 PRE-FLIGHT : on ne touche à rien si la base n'est pas saine ==="
systemctl is-active --quiet "$SERVICE"
curl -fsS --max-time 5 http://127.0.0.1:3111/api/map-v2/health > "$TMP/health-before.json"
python3 - "$TMP/health-before.json" <<'PY'
import json,sys
h=json.load(open(sys.argv[1]));assert h.get('ok') is True,h
print('Health avant :',h)
PY
grep -qF 'LB_MOORAIL_LGV_ROUTER_V6' "$JS"
CORE_TARGETS=()
for name in carte-core-canonical-v4-preview.html carte-core-preview.html france-v3-preview.html; do
  f="$PUBLIC/$name"; [[ -f "$f" ]] || continue
  if grep -qF 'function lbMoorailPathBetweenStops(stopA,stopB)' "$f"; then CORE_TARGETS+=("$f"); fi
done
[[ ${#CORE_TARGETS[@]} -gt 0 ]] || { echo "ERREUR: moteur MooRail live absent de France V3" >&2; exit 4; }
for f in "${CORE_TARGETS[@]}"; do
  grep -qF 'LB_MOORAIL_LIVE_PATH_V44' "$f"
  if grep -qF 'LB_MOORAIL_COMPOSED_PATH_V53' "$f"; then
    echo "ERREUR: V5.3 libre détectée dans $f. V8 refuse de superposer deux moteurs de composition." >&2
    exit 4
  fi
done

echo "=== 1/10 Téléchargement + validation des deux constructeurs V8 ==="
curl -fsSL "$BASE/build-moorail-live-gtfs-catalog-v2.py?$STAMP" -o "$TMP/live-builder.py"
curl -fsSL "$BASE/build-moorail-network-v8.py?$STAMP" -o "$TMP/network-builder.py"
python3 -m py_compile "$TMP/live-builder.py" "$TMP/network-builder.py"

echo "--- Test constructeur GTFS strict dans /tmp ---"
python3 "$TMP/live-builder.py" --source "$GTFS" --output "$TMP/live-cat.json" > "$TMP/live-builder.out"
cat "$TMP/live-builder.out"
python3 - "$TMP/live-cat.json" <<'PY'
import json,sys
p=json.load(open(sys.argv[1])); c=p['controls'];s=p['stats']
assert all(c['mustBePresent'].values()),c
assert all(c['mustBeAbsent'].values()),c
assert s['syntheticTrips']>100,s
assert set(p['allowedTokens'])=={'EUR','ICE','LYR','OGO','OUI','TGV','THA','TRN'},p['allowedTokens']
print('GTFS STRICT OK :',s['syntheticTrips'],'signatures synthétiques')
print('Présents :',c['mustBePresent'])
print('Exclus   :',c['mustBeAbsent'])
PY

echo "--- Test réseau V8 sans migration ---"
python3 "$TMP/network-builder.py" --root "$ROOT" --gtfs "$GTFS" --output "$TMP/network.json" > "$TMP/network-builder.out"
cat "$TMP/network-builder.out"
python3 - "$TMP/network.json" <<'PY'
import json,sys
p=json.load(open(sys.argv[1]));c=p['controls'];s=p['stats']
assert all(c['mustBePresent'].values()),c
assert all(c['mustBeAbsent'].values()),c
assert 400 <= p['strictTripsToday'] <= 1000,p['strictTripsToday']
assert s['tasks']>30,s
ids={x['id'] for x in p['spines']}
for x in ('LGV_EST','INTERCONNEXION_EST','LGV_ATLANTIQUE_BPL','LGV_ATLANTIQUE_SEA','LGV_SUD_EST'):
    assert x in ids,(x,ids)
print('RESEAU V8 DRY-RUN OK :',p['strictTripsToday'],'trips GV /',s['tasks'],'briques')
PY

echo "=== 2/10 Backup complet AVANT toute modification ==="
mkdir -p "$BACKUP"
cp -a "$HTML" "$BACKUP/moorail-route-editor.html"
[[ -f "$HTML2" ]] && cp -a "$HTML2" "$BACKUP/moorail-route-editor-stops.html" || true
cp -a "$JS" "$BACKUP/moorail-route-editor-stops.js"
cp -a "$STATE" "$BACKUP/state.json"
cp -a "$LIVE" "$BACKUP/live.json"
[[ -f "$LIVE_CAT" ]] && cp -a "$LIVE_CAT" "$BACKUP/live-cat.json" || touch "$BACKUP/live-cat.absent"
[[ -f "$OLD_BUILDER" ]] && cp -a "$OLD_BUILDER" "$BACKUP/old-builder.py" || touch "$BACKUP/old-builder.absent"
[[ -f "$NET_BUILDER" ]] && cp -a "$NET_BUILDER" "$BACKUP/net-builder.py" || touch "$BACKUP/net-builder.absent"
[[ -d "$NET_DIR" ]] && cp -a "$NET_DIR" "$BACKUP/network-dir" || touch "$BACKUP/network-dir.absent"
[[ -f "$SERVICE_UNIT" ]] && cp -a "$SERVICE_UNIT" "$BACKUP/refresh.service" || true
[[ -f "$TIMER_UNIT" ]] && cp -a "$TIMER_UNIT" "$BACKUP/refresh.timer" || true
for f in "${CORE_TARGETS[@]}"; do cp -a "$f" "$BACKUP/$(basename "$f")"; done
echo "Backup : $BACKUP"

echo "=== 3/10 Préparation UI V8 EN COPIE + node --check ==="
cp -a "$JS" "$TMP/editor.js"
cp -a "$HTML" "$TMP/editor.html"
python3 - "$TMP/editor.js" <<'PY'
from pathlib import Path
import re,sys
p=Path(sys.argv[1]);s=p.read_text(encoding='utf-8')
marker='/* LB_MOORAIL_VALIDATED_SECTIONS_V8 */'
if marker in s: raise SystemExit('V8 déjà présente dans JS actif')
assert 'LB_MOORAIL_LGV_ROUTER_V6' in s
s=s.replace("  catalog:[], serverState:{sections:{}}, route:null, legIndex:0,", "  catalog:[], network:null, serverState:{sections:{}}, route:null, legIndex:0,",1)

old=re.search(r"async function boot\(\)\{.*?\n\}\n\nfunction norm",s,re.S)
if not old:raise SystemExit('ancre boot absente')
boot=r'''async function boot(){
  try{
    setStatus('Chargement du réseau TGV MooRail V8…');
    const [net,sv,mf]=await Promise.all([
      fetch(`/map-v2/data/moorail-network-v8/network.json?v=${Date.now()}`,{cache:'no-store'}).then(r=>{if(!r.ok)throw new Error('network '+r.status);return r.json()}),
      fetch(`${API}/state`,{cache:'no-cache'}).then(r=>r.ok?r.json():({sections:{}})),
      fetch(`${RFN}/manifest.json?v=8`,{cache:'no-cache'}).then(r=>{if(!r.ok)throw new Error('RFN '+r.status);return r.json()})
    ]);
    state.network=net;state.serverState=sv||{sections:{}};state.manifest=mf;state.cellSize=+mf.cellSize||.2;
    state.catalog=(net.tasks||[]).map(task=>({
      id:`task-${task.sectionId}`,saveRouteId:task.routeId,origin:task.from?.name||'?',destination:task.to?.name||'?',
      signature:`${task.from?.name||'?'} → ${task.to?.name||'?'}`,stops:[task.from,task.to],
      sections:[{id:task.sectionId,from:task.from,to:task.to,sourceSectionId:task.sourceSectionId,networkStatus:task.status}],
      tripCount:Number(task.impactToday||0),trainNumbers:task.trainNumbers||[],corridor:task.corridor,corridorLabel:task.corridorLabel||task.corridor,
      networkStatus:task.status,sourceSectionId:task.sourceSectionId,validationEngine:task.validationEngine
    }));
    el.rfnInfo.textContent=`RFN détaillé : ${mf.features||'?'} objets · V8 Validated Sections · V6 LGV actif`;
    renderRoutes();
    const preferred=state.catalog.find(r=>r.networkStatus==='TODO')||state.catalog.find(r=>r.networkStatus==='LEGACY')||state.catalog[0];
    if(preferred)await selectRoute(preferred); else setStatus('Aucune section TGV à traiter.','bad');
  }catch(e){console.error(e);setStatus(`Erreur initialisation V8 : ${e.message}`,'bad');}
}

/* LB_MOORAIL_VALIDATED_SECTIONS_V8 */
function networkStatus(r){
  const sid=r?.sections?.[0]?.id, saved=sid?state.serverState.sections?.[sid]:null;
  if(saved?.status==='validated' && (saved?.validationEngine==='ROUTER_V6' || String(saved?.source||'')==='MOORAIL_VALIDATED_SECTIONS_V8')) return 'VALIDATED_V8';
  return r?.networkStatus||'TODO';
}

function norm'''
s=s[:old.start()]+boot+s[old.end():]

m=re.search(r"function renderRoutes\(\)\{.*?\n\}\n\nasync function selectRoute",s,re.S)
if not m:raise SystemExit('ancre renderRoutes absente')
render=r'''function renderRoutes(){
  const q=norm(el.search.value);el.routes.innerHTML='';
  let rs=state.catalog.filter(r=>!q||norm(`${r.origin} ${r.destination} ${r.corridorLabel} ${(r.trainNumbers||[]).join(' ')}`).includes(q));
  rs.sort((a,b)=>{
    const rank={TODO:0,LEGACY:1,VALIDATED_V8:2};
    return (rank[networkStatus(a)]??9)-(rank[networkStatus(b)]??9) || (b.tripCount||0)-(a.tripCount||0) || String(a.corridorLabel).localeCompare(String(b.corridorLabel),'fr');
  });
  rs=rs.slice(0,140);let last='';
  for(const r of rs){
    const group=r.corridorLabel||r.corridor||'Autre';
    if(group!==last){const h=document.createElement('div');h.className='network-group';h.textContent=group;el.routes.appendChild(h);last=group;}
    const st=networkStatus(r),label=st==='VALIDATED_V8'?'✅ V8':st==='LEGACY'?'⚠️ pré-V8':'🟠 à valider';
    const b=document.createElement('button');b.className='route'+(state.route?.id===r.id?' active':'')+(st==='VALIDATED_V8'?' saved':'');
    b.innerHTML=`<b>${esc(r.origin)} ↔ ${esc(r.destination)}</b><span>${label} · impact aujourd’hui ${r.tripCount||0} train(s)${(r.trainNumbers||[]).length?` · ${(r.trainNumbers||[]).slice(0,7).join(', ')}`:''}</span>`;
    b.onclick=()=>selectRoute(r);el.routes.appendChild(b);
  }
  if(!rs.length)el.routes.innerHTML='<div class="help">Aucune section correspondante.</div>';
}

async function selectRoute'''
s=s[:m.start()]+render+s[m.end():]

m=re.search(r"function renderLegs\(\)\{.*?\n\}\n\nasync function activateLeg",s,re.S)
if not m:raise SystemExit('ancre renderLegs absente')
renderlegs=r'''function renderLegs(){
  if(!state.route)return;
  const st=networkStatus(state.route),label=st==='VALIDATED_V8'?'✅ validée V8':st==='LEGACY'?'⚠️ ancienne validation à recalculer V6':'🟠 à contrôler';
  el.routeTitle.textContent=`${state.route.origin} ↔ ${state.route.destination}`;
  el.routeMeta.textContent=`${state.route.corridorLabel||state.route.corridor} · ${label} · impact aujourd’hui ${state.route.tripCount||0} train(s)`;
  el.legs.innerHTML='';
  const sec=state.route.sections?.[0];if(!sec)return;
  const b=document.createElement('button');b.className='leg active'+(st==='VALIDATED_V8'?' saved':'');
  b.innerHTML=`<b>${esc(state.route.origin)} → ${esc(state.route.destination)}</b><span>${label}${state.route.sourceSectionId&&state.route.sourceSectionId!==sec.id?` · migration ${esc(state.route.sourceSectionId)}`:''}</span>`;
  b.onclick=()=>activateLeg(0);el.legs.appendChild(b);
}

async function activateLeg'''
s=s[:m.start()]+renderlegs+s[m.end():]

s=s.replace("  const saved=state.serverState.sections?.[sec.id];", "  const saved=state.serverState.sections?.[sec.id] || (sec.sourceSectionId?state.serverState.sections?.[sec.sourceSectionId]:null);",1)
s=s.replace("Départ et arrivée sont fixes. V6 privilégie automatiquement les LGV (jaune vif). Ajoute un passage seulement pour imposer un raccordement précis si nécessaire.", "Brique canonique <b>${esc(state.route.corridorLabel||state.route.corridor)}</b>. V6 recalcule le chemin sur le RFN et privilégie les LGV en jaune vif. Une ancienne validation n'est jamais considérée V8 tant que tu ne la revalides pas.")
s=s.replace("Départ et arrivée sont fixes. Si le chemin jaune est faux, clique seulement sur un point de passage obligatoire (par exemple le raccord de Pagny).", "Brique canonique <b>${esc(state.route.corridorLabel||state.route.corridor)}</b>. V6 recalcule le chemin sur le RFN et privilégie les LGV en jaune vif. Une ancienne validation n'est jamais considérée V8 tant que tu ne la revalides pas.")

s=s.replace("    routeId:state.route.id,sectionId:sec.id,status:'validated',source:'MOORAIL_STOP_TO_STOP_V3',", "    routeId:(state.route.saveRouteId||state.route.id),sectionId:sec.id,status:'validated',source:'MOORAIL_VALIDATED_SECTIONS_V8',canonical:true,canonicalSectionId:sec.id,corridor:state.route.corridor,validationEngine:'ROUTER_V6',",1)
s=s.replace("state.serverState.sections[sec.id]={...payload,updatedAt:new Date().toISOString()};renderRoutes();renderLegs();setStatus(`✓ Étape validée :", "state.serverState.sections[sec.id]={...payload,updatedAt:new Date().toISOString()};state.route.networkStatus='VALIDATED_V8';renderRoutes();renderLegs();setStatus(`✓ Brique V8 active sur France V3 :",1)

p.write_text(s,encoding='utf-8')
PY
node --check "$TMP/editor.js"
grep -qF 'LB_MOORAIL_VALIDATED_SECTIONS_V8' "$TMP/editor.js"
grep -qF 'LB_MOORAIL_LGV_ROUTER_V6' "$TMP/editor.js"
grep -qF "validationEngine:'ROUTER_V6'" "$TMP/editor.js"

python3 - "$TMP/editor.html" <<'PY'
from pathlib import Path
import re,sys
p=Path(sys.argv[1]);s=p.read_text(encoding='utf-8')
s=re.sub(r'<title>.*?</title>','<title>MooRail — Validated Sections V8</title>',s,1)
s=re.sub(r'<span class="tag">.*?</span>','<span class="tag">V8 · VALIDATED SECTIONS</span>',s,1)
s=re.sub(r'<div class="sub">.*?</div>','<div class="sub">Tu valides des briques ferroviaires réutilisables, pas des trains. Une brique validée alimente immédiatement France V3 dans les deux sens.</div>',s,1,flags=re.S)
s=s.replace('<h3>Parcours TGV</h3>','<h3>Réseau TGV — briques à valider</h3>')
s=s.replace('placeholder="Paris → Strasbourg, Nancy, Metz…"','placeholder="LGV Est, Rennes, Massy, Bordeaux, Strasbourg…"')
s=s.replace('<h3 id="routeTitle">Étapes du parcours</h3>','<h3 id="routeTitle">Section canonique</h3>')
s=s.replace('✓ Valider cette étape','✓ Valider cette brique V8')
s=s.replace('<b>Principe</b><br>Gare A → calcul automatique → Gare B<br>Chemin faux ? Ajoute seulement un point obligatoire.','<b>Validated Sections V8</b><br>1 brique correcte = tous les TGV qui l’utilisent<br>V6 privilégie les LGV · aucun routage par numéro de train')
s=s.replace('.separator{height:1px', '.network-group{font-size:10px;font-weight:900;letter-spacing:.08em;color:#ffd84d;margin:12px 2px 5px;text-transform:uppercase}.separator{height:1px',1)
s=re.sub(r'/map-v2/moorail-route-editor-stops\.js\?v=[^"\']+','/map-v2/moorail-route-editor-stops.js?v=8',s)
p.write_text(s,encoding='utf-8')
PY
grep -qF 'V8 · VALIDATED SECTIONS' "$TMP/editor.html"

echo "=== 4/10 Préparation moteur France V3 V8 : composition UNIQUEMENT par spine ==="
mkdir -p "$TMP/cores"
for f in "${CORE_TARGETS[@]}"; do
  cp -a "$f" "$TMP/cores/$(basename "$f")"
  python3 - "$TMP/cores/$(basename "$f")" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1]);s=p.read_text(encoding='utf-8')
marker='/* LB_MOORAIL_VALIDATED_NETWORK_V8 */'
if marker in s:raise SystemExit('V8 déjà présente')
required=['let lbMoorailLiveLoaded = false;','function lbMoorailPathBetweenStops(stopA,stopB)','function pathBetweenStops(stopA, stopB)']
for x in required:
    if x not in s:raise SystemExit(f'ancre absente: {x}')
s=s.replace('    const moorail=lbMoorailPathBetweenStops(stopA,stopB);','    const moorail=lbMoorailResolvedPathBetweenStops(stopA,stopB);',1)
s=s.replace('      const path=lbMoorailPathBetweenStops(stopA,stopB);','      const path=lbMoorailResolvedPathBetweenStops(stopA,stopB);',1)
s=s.replace('  let lbMoorailLiveLoaded = false;','  let lbMoorailLiveLoaded = false;\n  let lbMoorailV8Spines = [];',1)
needle='      lbMoorailLiveLoaded=true;'
if needle not in s:raise SystemExit('ancre lbMoorailLiveLoaded=true absente')
s=s.replace(needle,'      await lbLoadMoorailV8Network();\n      lbMoorailLiveLoaded=true;',1)
helper=r'''

  /* LB_MOORAIL_VALIDATED_NETWORK_V8 */
  async function lbLoadMoorailV8Network(){
    try{
      const r=await fetch(`/map-v2/data/moorail-network-v8/network.json?v=${Date.now()}`,{cache:'no-store'});
      if(!r.ok) throw new Error(`HTTP ${r.status}`);
      const p=await r.json();
      lbMoorailV8Spines=Array.isArray(p?.spines)?p.spines:[];
      console.info('[MOO RAIL V8] spines chargées :',lbMoorailV8Spines.length);
    }catch(e){lbMoorailV8Spines=[];console.warn('[MOO RAIL V8] réseau indisponible',e);}
  }
  function lbMoorailV8NodeMatches(name,node){
    const n=lbMoorailNormName(name);
    for(const a of node?.aliases||[]){if(lbMoorailNormName(a)===n)return true;}
    return lbMoorailNormName(node?.label)===n;
  }
  function lbMoorailV8PairForNodes(a,b){
    const aa=[a?.label,...(a?.aliases||[])].filter(Boolean),bb=[b?.label,...(b?.aliases||[])].filter(Boolean);
    for(const x of aa)for(const y of bb){const hit=lbMoorailLivePairs.get(lbMoorailPairKey(x,y));if(hit)return hit;}
    return null;
  }
  function lbMoorailResolvedPathBetweenStops(stopA,stopB){
    const direct=lbMoorailPathBetweenStops(stopA,stopB);if(direct)return direct;
    if(!lbMoorailLiveLoaded||!stopA||!stopB)return null;
    const an=lbMoorailStopName(stopA),bn=lbMoorailStopName(stopB);
    let best=null;
    for(const spine of lbMoorailV8Spines||[]){
      const nodes=spine?.nodes||[];
      const ai=[],bi=[];
      nodes.forEach((n,i)=>{if(lbMoorailV8NodeMatches(an,n))ai.push(i);if(lbMoorailV8NodeMatches(bn,n))bi.push(i);});
      for(const i of ai)for(const j of bi)if(i!==j){const d=Math.abs(j-i);if(!best||d<best.d)best={spine,nodes,i,j,d};}
    }
    if(!best)return null;
    const coords=[],ids=[],via=[an];const step=best.j>best.i?1:-1;
    for(let i=best.i;i!==best.j;i+=step){
      const item=lbMoorailV8PairForNodes(best.nodes[i],best.nodes[i+step]);
      if(!item||!Array.isArray(item.coords)||item.coords.length<2)return null;
      for(const raw of item.coords){const pt=[Number(raw[0]),Number(raw[1])];if(!Number.isFinite(pt[0])||!Number.isFinite(pt[1]))continue;const last=coords.at(-1);if(!last||last[0]!==pt[0]||last[1]!==pt[1])coords.push(pt);}
      ids.push(item.sectionId||`${item.from}→${item.to}`);via.push(best.nodes[i+step]?.label||item.to);
    }
    if(coords.length<2)return null;
    const path=makePath(coords,false);if(!path||!path.totalDist)return null;
    path.moorailValidated=true;path.moorailComposed=true;path.moorailSectionIds=ids;path.moorailViaNames=via;path.moorailCorridor=best.spine?.id||null;
    console.info('[MOO RAIL V8] composition sûre',an,'→',bn,best.spine?.id,via);
    return path;
  }
'''
anchor='  function pathBetweenStops(stopA, stopB){'
s=s.replace(anchor,helper+'\n'+anchor,1)
p.write_text(s,encoding='utf-8')
PY
  grep -qF 'LB_MOORAIL_VALIDATED_NETWORK_V8' "$TMP/cores/$(basename "$f")"
  grep -qF 'const moorail=lbMoorailResolvedPathBetweenStops(stopA,stopB)' "$TMP/cores/$(basename "$f")"
  if grep -qF 'LB_MOORAIL_SELECTED_ROUTE_V52' "$TMP/cores/$(basename "$f")"; then
    grep -qF 'const path=lbMoorailResolvedPathBetweenStops(stopA,stopB)' "$TMP/cores/$(basename "$f")"
  fi
done

echo "=== 5/10 Installation constructeurs + catalogue strict ==="
install -o root -g root -m 0755 "$TMP/live-builder.py" "$OLD_BUILDER"
install -o root -g root -m 0755 "$TMP/network-builder.py" "$NET_BUILDER"
python3 "$OLD_BUILDER" --source "$GTFS" --output "$LIVE_CAT"
chown "$SERVICE_USER:$SERVICE_GROUP" "$LIVE_CAT";chmod 0644 "$LIVE_CAT"
python3 - "$LIVE_CAT" <<'PY'
import json,sys
p=json.load(open(sys.argv[1]));c=p['controls'];assert all(c['mustBePresent'].values()) and all(c['mustBeAbsent'].values()),c
print('Catalogue strict installé :',p['stats'])
PY

echo "=== 6/10 Migration non destructive des validations vers IDs canoniques ==="
mkdir -p "$NET_DIR";chown "$SERVICE_USER:$SERVICE_GROUP" "$NET_DIR";chmod 0755 "$NET_DIR"
python3 "$NET_BUILDER" --root "$ROOT" --gtfs "$GTFS" --output "$NET_JSON" --migrate-state | tee "$TMP/network-installed.out"
chown "$SERVICE_USER:$SERVICE_GROUP" "$STATE" "$NET_JSON";chmod 0664 "$STATE";chmod 0644 "$NET_JSON"
python3 - "$STATE" "$NET_JSON" <<'PY'
import json,sys,re
st=json.load(open(sys.argv[1]));net=json.load(open(sys.argv[2]));
canon=[(k,v) for k,v in (st.get('sections') or {}).items() if re.fullmatch(r'sec-[0-9a-f]{16}',k)]
assert len(canon)>=20,len(canon)
assert net.get('version')==8,net.get('version')
assert all(net['controls']['mustBePresent'].values()),net['controls']
assert all(net['controls']['mustBeAbsent'].values()),net['controls']
print('Sections canoniques :',len(canon))
print('Réseau :',net['stats'])
for c in sorted(net.get('corridors') or [],key=lambda x:-x.get('total',0))[:12]:
    print(' ',c['label'],':',c['validated'],'V8 /',c['legacy'],'legacy /',c['todo'],'todo')
PY

echo "=== 7/10 Installation UI + moteur France V3 ==="
install -o root -g root -m 0644 "$TMP/editor.js" "$JS"
install -o root -g root -m 0644 "$TMP/editor.html" "$HTML"
[[ -f "$HTML2" ]] && install -o root -g root -m 0644 "$TMP/editor.html" "$HTML2"
for f in "${CORE_TARGETS[@]}"; do install -o root -g root -m 0644 "$TMP/cores/$(basename "$f")" "$f"; done

echo "=== 8/10 Refresh automatique du réseau (30 min) ==="
cat > "$SERVICE_UNIT" <<EOF
[Unit]
Description=MooRail V8 network demand refresh
After=network.target

[Service]
Type=oneshot
User=$SERVICE_USER
Group=$SERVICE_GROUP
ExecStart=/usr/bin/python3 $NET_BUILDER --root $ROOT --gtfs $GTFS --output $NET_JSON
EOF
cat > "$TIMER_UNIT" <<'EOF'
[Unit]
Description=Refresh MooRail V8 network every 30 minutes

[Timer]
OnBootSec=2min
OnUnitActiveSec=30min
AccuracySec=2min
Persistent=true

[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable --now moorail-network-v8-refresh.timer >/dev/null
systemctl start moorail-network-v8-refresh.service
systemctl is-active --quiet moorail-network-v8-refresh.timer

echo "=== 9/10 Redémarrage + tests HTTP du PRODUIT SERVI ==="
RESTARTED=1
systemctl restart "$SERVICE"
for _ in $(seq 1 30); do
  if systemctl is-active --quiet "$SERVICE" && curl -fsS --max-time 2 http://127.0.0.1:3111/api/map-v2/health >/dev/null 2>&1; then break; fi
  sleep 1
done
systemctl is-active --quiet "$SERVICE"
curl -fsS --max-time 5 http://127.0.0.1:3111/api/map-v2/health > "$TMP/health-after.json"
curl -fsS --max-time 8 "http://127.0.0.1:3111/moorail-route-editor.html?v=$STAMP" > "$TMP/served-editor.html"
curl -fsS --max-time 8 "http://127.0.0.1:3111/moorail-route-editor-stops.js?v=$STAMP" > "$TMP/served-editor.js"
curl -fsS --max-time 8 "http://127.0.0.1:3111/data/moorail-network-v8/network.json?v=$STAMP" > "$TMP/served-network.json"
grep -qF 'V8 · VALIDATED SECTIONS' "$TMP/served-editor.html"
grep -qF 'LB_MOORAIL_VALIDATED_SECTIONS_V8' "$TMP/served-editor.js"
grep -qF 'LB_MOORAIL_LGV_ROUTER_V6' "$TMP/served-editor.js"
python3 - "$TMP/health-after.json" "$TMP/served-network.json" <<'PY'
import json,sys
h=json.load(open(sys.argv[1]));n=json.load(open(sys.argv[2]));assert h.get('ok') is True,h;assert n.get('version')==8,n
assert all(n['controls']['mustBePresent'].values()) and all(n['controls']['mustBeAbsent'].values()),n['controls']
print('Health après :',h)
print('Network servi :',n['strictTripsToday'],'trips GV /',n['stats']['tasks'],'briques')
PY
for f in "${CORE_TARGETS[@]}"; do
  name="$(basename "$f")"
  curl -fsS --max-time 8 "http://127.0.0.1:3111/$name?v=$STAMP" > "$TMP/served-$name"
  grep -qF 'LB_MOORAIL_VALIDATED_NETWORK_V8' "$TMP/served-$name"
  grep -qF 'lbMoorailResolvedPathBetweenStops' "$TMP/served-$name"
done

echo "=== 10/10 Tests fonctionnels : réseau réel + composition sûre ==="
python3 - "$LIVE" "$NET_JSON" <<'PY'
import json,sys,unicodedata
live=json.load(open(sys.argv[1]));net=json.load(open(sys.argv[2]))
def norm(s):
 s=unicodedata.normalize('NFKD',str(s or ''));return ''.join(c for c in s if not unicodedata.combining(c)).strip().lower()
pairs={(norm(x.get('from')),norm(x.get('to'))):x for x in live.get('pairs') or []}
spines=net.get('spines') or []
def node_match(name,node):return norm(name)==norm(node.get('label')) or any(norm(name)==norm(a) for a in node.get('aliases') or [])
def edge(a,b):
 for x in [a.get('label'),*(a.get('aliases') or [])]:
  for y in [b.get('label'),*(b.get('aliases') or [])]:
   if (norm(x),norm(y)) in pairs:return True
 return False
def resolve(a,b):
 if (norm(a),norm(b)) in pairs:return ('direct',[])
 cand=[]
 for sp in spines:
  ns=sp.get('nodes') or [];ai=[i for i,n in enumerate(ns) if node_match(a,n)];bi=[i for i,n in enumerate(ns) if node_match(b,n)]
  for i in ai:
   for j in bi:
    if i!=j:cand.append((abs(j-i),sp,i,j))
 if not cand:return None
 _,sp,i,j=min(cand,key=lambda z:(z[0],z[1].get('id','')));step=1 if j>i else -1;via=[]
 for k in range(i,j,step):
  if not edge(sp['nodes'][k],sp['nodes'][k+step]):return None
  via.append(sp['nodes'][k+step]['label'])
 return (sp['id'],via)

def check_seq(label,seq,required=True):
 print('\n',label)
 ok=True
 for a,b in zip(seq,seq[1:]):
  r=resolve(a,b);print(' ',('✅' if r else '❌'),a,'→',b,(' | '+str(r) if r else ''));ok &= bool(r)
 if required:assert ok,label
 return ok

check_seq('5460 Rennes → Strasbourg',[
 'Rennes','Massy TGV','Marne-la-Vallée Chessy','Aéroport Charles de Gaulle 2 TGV','Champagne-Ardenne TGV','Meuse TGV','Lorraine TGV','Strasbourg'
])
check_seq('9577 Paris → Karlsruhe',['Paris Est','Strasbourg','Karlsruhe Hbf'])
print('\nCOMPOSITION SURE V8 : OK')
PY

SUCCESS=1
trap - EXIT
cleanup

echo
echo "============================================================"
echo " MOO RAIL V8 INSTALLE ET VALIDE"
echo "============================================================"
echo "URL éditeur : https://vps.labetaillere.fr/map-v2/moorail-route-editor.html"
echo "France V3   : https://vps.labetaillere.fr/map-v2/france-v3-preview.html"
echo "Backup      : $BACKUP"
echo
echo "Garanties vérifiées par l'installateur :"
echo " - filtre exact OUI/OGO/LYR/ICE/TRN (+ tokens GV réservés)"
echo " - faux TER 879303/839654/68230/427250 exclus"
echo " - migrations canoniques sec-* non destructives"
echo " - routeur LGV V6 toujours présent"
echo " - composition V8 uniquement sur spines ordonnées, jamais BFS national libre"
echo " - éditeur V8 servi"
echo " - France V3 V8 servie"
echo " - 5460 Rennes→Strasbourg résolvable"
echo " - 9577 Paris→Karlsruhe résolvable"
echo " - refresh réseau automatique toutes les 30 min"
echo "============================================================"
