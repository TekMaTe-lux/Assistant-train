#!/usr/bin/env bash
set -euo pipefail

ROOT="${MOORAIL_ROOT:-/opt/labetaillere-map-v2-src/map-v2}"
PUBLIC="$ROOT/public"
JS="$PUBLIC/moorail-route-editor-stops.js"
HTML="$PUBLIC/moorail-route-editor.html"
HTML2="$PUBLIC/moorail-route-editor-stops.html"
API_FILE="$ROOT/server/route-editor-api.mjs"
NETWORK="$PUBLIC/data/moorail-network-v8/network.json"
STATE="$ROOT/data/route-editor/moorail-route-editor-state-v1.json"
LIVE="$PUBLIC/data/moorail-live-v1/sections.json"
BUILDER="$ROOT/scripts/build-moorail-network-v8.py"
GTFS="${MOORAIL_LIVE_GTFS_DIR:-/var/www/html/gtfs/static}"
SERVICE="labetaillere-map-v2.service"
TIMER="moorail-network-v8-refresh.timer"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$ROOT/backups/moorail-v11-production-$STAMP"
TMP="$(mktemp -d /tmp/moorail-v11.XXXXXX)"
SUCCESS=0
RESTARTED=0

cleanup(){ rm -rf "$TMP"; }
rollback(){
  [[ "$SUCCESS" == 1 ]] && return 0
  echo "ROLLBACK MOO RAIL V11..." >&2
  [[ -f "$BACKUP/moorail-route-editor-stops.js" ]] && cp -a "$BACKUP/moorail-route-editor-stops.js" "$JS" || true
  [[ -f "$BACKUP/moorail-route-editor.html" ]] && cp -a "$BACKUP/moorail-route-editor.html" "$HTML" || true
  [[ -f "$BACKUP/moorail-route-editor-stops.html" ]] && cp -a "$BACKUP/moorail-route-editor-stops.html" "$HTML2" || true
  [[ -f "$BACKUP/route-editor-api.mjs" ]] && cp -a "$BACKUP/route-editor-api.mjs" "$API_FILE" || true
  [[ -f "$BACKUP/network.json" ]] && cp -a "$BACKUP/network.json" "$NETWORK" || true
  if [[ "$RESTARTED" == 1 ]]; then systemctl restart "$SERVICE" >/dev/null 2>&1 || true; fi
}
finish(){ rc=$?; trap - EXIT; rollback; cleanup; exit "$rc"; }
trap finish EXIT

[[ ${EUID:-$(id -u)} -eq 0 ]] || { echo "ERREUR: lancer avec sudo/root" >&2; exit 2; }
for f in "$JS" "$HTML" "$API_FILE" "$NETWORK" "$STATE" "$LIVE" "$BUILDER" "$GTFS/trips.txt"; do
  [[ -f "$f" ]] || { echo "ERREUR fichier absent: $f" >&2; exit 3; }
done

echo "============================================================"
echo " MOO RAIL V11 — MODE PRODUCTION / VALIDER + SUIVANT"
echo "============================================================"
echo "But : arrêter les manipulations entre chaque brique."
echo "Après validation : STATE -> LIVE -> NETWORK -> UI -> SUIVANTE."
echo

echo "=== 0/10 PRE-FLIGHT ==="
systemctl is-active --quiet "$SERVICE"
systemctl is-active --quiet "$TIMER"
curl -fsS --max-time 5 http://127.0.0.1:3111/api/map-v2/health > "$TMP/health-before.json"
python3 - "$TMP/health-before.json" "$NETWORK" <<'PY'
import json,sys
h=json.load(open(sys.argv[1]));n=json.load(open(sys.argv[2]))
assert h.get('ok') is True,h
assert n.get('version')==8,n.get('version')
print('Health  :',h)
print('Network :',n.get('stats'))
PY
for marker in LB_MOORAIL_VALIDATED_SECTIONS_V8 LB_MOORAIL_UNIFIED_EDITOR_V10 LB_MOORAIL_PUBLISH_V101; do
  grep -qF "$marker" "$JS" || { echo "ERREUR marqueur JS absent: $marker" >&2; exit 4; }
done
grep -qF 'async function validateLeg()' "$JS" || { echo "ERREUR validateLeg absente" >&2; exit 4; }
grep -qF 'function networkStatus(' "$JS" || { echo "ERREUR networkStatus absent" >&2; exit 4; }
grep -qF 'function runCompiler(' "$API_FILE" || { echo "ERREUR API V4 absente" >&2; exit 4; }
grep -qF 'execFileSync' "$API_FILE" || { echo "ERREUR execFileSync absent API" >&2; exit 4; }
node --check "$JS"
node --check "$API_FILE"
if grep -qF 'LB_MOORAIL_PRODUCTION_V11' "$JS" || grep -qF 'LB_MOORAIL_PRODUCTION_API_V11' "$API_FILE"; then
  echo "ERREUR: V11 déjà présente" >&2; exit 5
fi
echo "Pre-flight : OK"


echo "=== 1/10 BACKUP ==="
mkdir -p "$BACKUP"
cp -a "$JS" "$BACKUP/moorail-route-editor-stops.js"
cp -a "$HTML" "$BACKUP/moorail-route-editor.html"
[[ -f "$HTML2" ]] && cp -a "$HTML2" "$BACKUP/moorail-route-editor-stops.html" || true
cp -a "$API_FILE" "$BACKUP/route-editor-api.mjs"
cp -a "$NETWORK" "$BACKUP/network.json"
echo "Backup : $BACKUP"


echo "=== 2/10 API : REFRESH RESEAU EN UN APPEL ==="
cp -a "$API_FILE" "$TMP/api.mjs"
python3 - "$TMP/api.mjs" <<'PY'
from pathlib import Path
import re,sys
p=Path(sys.argv[1]);s=p.read_text(encoding='utf-8')
marker='/* LB_MOORAIL_PRODUCTION_API_V11 */'
if marker in s:raise SystemExit('V11 API déjà présente')

# Ajoute les chemins à côté des constantes du publisher V4.
pat=re.compile(r"(\s*const reportFile\s*=\s*path\.join\(storeDir,\s*'moorail-compile-preview-v2\.json'\);)")
m=pat.search(s)
if not m:raise SystemExit('ERREUR ancre reportFile API absente')
extra=m.group(1)+r'''
  /* LB_MOORAIL_PRODUCTION_API_V11 */
  const networkBuilderV11 = path.join(rootDir, 'scripts', 'build-moorail-network-v8.py');
  const networkFileV11 = path.join(rootDir, 'public', 'data', 'moorail-network-v8', 'network.json');
  const gtfsDirV11 = process.env.MOORAIL_LIVE_GTFS_DIR || '/var/www/html/gtfs/static';
'''
s=s[:m.start()]+extra+s[m.end():]

# Helper bloquant volontairement court : le builder tourne déjà via le timer avec le même utilisateur.
anchor='  function scheduleRestart() {'
pos=s.find(anchor)
if pos<0:raise SystemExit('ERREUR ancre scheduleRestart absente')
helper=r'''  function refreshNetworkV11() {
    if(!fs.existsSync(networkBuilderV11)) throw new Error(`Builder réseau absent: ${networkBuilderV11}`);
    const started=Date.now();
    const stdout=execFileSync('/usr/bin/python3',[
      networkBuilderV11,'--root',rootDir,'--gtfs',gtfsDirV11,'--output',networkFileV11
    ],{
      encoding:'utf8',maxBuffer:32*1024*1024,timeout:120000,
      env:{...process.env,MOORAIL_ROOT:rootDir,MOORAIL_LIVE_GTFS_DIR:gtfsDirV11}
    });
    const network=readJson(networkFileV11,null);
    if(!network||network.version!==8)throw new Error('network.json invalide après refresh');
    return {
      ok:true,durationMs:Date.now()-started,stats:network.stats||{},strictTripsToday:network.strictTripsToday||0,
      tail:String(stdout||'').trim().split(/\r?\n/).slice(-2)
    };
  }

'''
s=s[:pos]+helper+s[pos:]

# Endpoint avant le 404 final, sans toucher à SAVE/PUBLISH existants.
needle="    send(res,404,{error:'Route editor API: ressource introuvable'}); return true;"
if needle not in s:raise SystemExit('ERREUR ancre 404 API absente')
route=r'''    if(req.method==='POST'&&url.pathname===`${API_PREFIX}/production-refresh`) {
      try { return send(res,200,refreshNetworkV11()); }
      catch(e){ return send(res,500,{ok:false,error:e.message}); }
    }

'''
s=s.replace(needle,route+needle,1)
p.write_text(s,encoding='utf-8')
PY
node --check "$TMP/api.mjs"
grep -qF 'LB_MOORAIL_PRODUCTION_API_V11' "$TMP/api.mjs"
grep -qF '/production-refresh' "$TMP/api.mjs"
echo "API V11 préparée : OK"


echo "=== 3/10 JS : MODE PRODUCTION ==="
cp -a "$JS" "$TMP/editor.js"
python3 - "$TMP/editor.js" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1]);s=p.read_text(encoding='utf-8')
marker='/* LB_MOORAIL_PRODUCTION_V11 */'
if marker in s:raise SystemExit('V11 JS déjà présente')
pos=s.rfind('})();')
if pos<0:raise SystemExit('ERREUR fin IIFE absente')
extra=marker+r'''

// ---------------------------------------------------------------------------
// V11 — MODE PRODUCTION : 1 validation = sauvegarde + refresh + suivante
// ---------------------------------------------------------------------------
state.productionV11={busy:false,lastRefreshMs:null,lastValidated:null};
const lbValidateLegOriginalV11=validateLeg;

function lbProductionRankV11(r){
  const st=networkStatus(r);return st==='TODO'?0:st==='LEGACY'?1:2;
}
function lbProductionQueueV11(excludeSid=null){
  return (state.catalog||[]).filter(r=>{
    const sid=r?.sections?.[0]?.id;
    return sid&&sid!==excludeSid&&networkStatus(r)!=='VALIDATED_V8';
  }).sort((a,b)=>lbProductionRankV11(a)-lbProductionRankV11(b) || Number(b.tripCount||0)-Number(a.tripCount||0) || String(a.signature||'').localeCompare(String(b.signature||''),'fr'));
}
function lbProductionStatsV11(){
  const all=state.catalog||[];let validated=0,todo=0,legacy=0,impactTodo=0;
  for(const r of all){const st=networkStatus(r);if(st==='VALIDATED_V8')validated++;else if(st==='LEGACY')legacy++;else todo++;if(st!=='VALIDATED_V8')impactTodo+=Number(r.tripCount||0);}
  return {all:all.length,validated,todo,legacy,remaining:todo+legacy,impactTodo};
}
function lbProductionPanelV11(){
  let box=document.getElementById('lbProductionV11');
  if(box)return box;
  const anchor=document.getElementById('routeTitle')?.closest('.block')||document.querySelector('.block');
  if(!anchor)return null;
  box=document.createElement('div');box.id='lbProductionV11';box.className='block';
  box.style.borderColor='#36e8c3';
  box.innerHTML=`
    <h3 style="color:#63efff">⚡ MODE PRODUCTION V11</h3>
    <div id="lbProdStatsV11" class="status">Chargement…</div>
    <div class="row" style="margin-top:8px">
      <button id="lbProdNextV11" class="btn good">⏭ Brique suivante</button>
    </div>
    <div class="help" style="margin-top:7px">Validation = LIVE + refresh réseau + passage automatique à la brique la plus impactante suivante.</div>`;
  anchor.parentNode.insertBefore(box,anchor);
  box.querySelector('#lbProdNextV11').onclick=()=>lbProductionNextV11();
  return box;
}
function lbProductionUpdateV11(){
  const box=lbProductionPanelV11();if(!box)return;
  const x=lbProductionStatsV11(),cur=state.route,st=cur?networkStatus(cur):null;
  const current=cur&&st!=='VALIDATED_V8'?`<br>Actuelle : <b>${Number(cur.tripCount||0)}</b> train(s) impacté(s)`:' ';
  box.querySelector('#lbProdStatsV11').innerHTML=`✅ <b>${x.validated}/${x.all}</b> briques V8 · 🟠 <b>${x.todo}</b> TODO · ⚠️ <b>${x.legacy}</b> legacy${current}`;

  // Le bouton historique devient le bouton rapide. On le rebind explicitement
  // car l'ancien onclick peut avoir capturé la fonction validateLeg avant V11.
  const vb=[...document.querySelectorAll('button')].find(b=>/Valider cette brique V8|Valider \+ suivant/i.test(b.textContent||''));
  if(vb){
    vb.textContent=state.productionV11.busy?'⏳ Validation / synchronisation…':'✓ Valider + suivant';
    vb.disabled=!!state.productionV11.busy;
    if(vb.dataset.moorailProdV11!=='1'){
      vb.dataset.moorailProdV11='1';
      vb.onclick=()=>validateLeg();
    }
  }
}
async function lbProductionReloadV11(){
  const [net,sv]=await Promise.all([
    fetch(`/map-v2/data/moorail-network-v8/network.json?v=${Date.now()}`,{cache:'no-store'}).then(r=>{if(!r.ok)throw new Error(`network HTTP ${r.status}`);return r.json()}),
    fetch(`${API}/state?t=${Date.now()}`,{cache:'no-store'}).then(r=>{if(!r.ok)throw new Error(`state HTTP ${r.status}`);return r.json()})
  ]);
  state.network=net;state.serverState=sv||{sections:{}};
  state.catalog=(net.tasks||[]).map(task=>({
    id:`task-${task.sectionId}`,saveRouteId:task.routeId,origin:task.from?.name||'?',destination:task.to?.name||'?',
    signature:`${task.from?.name||'?'} → ${task.to?.name||'?'}`,stops:[task.from,task.to],
    sections:[{id:task.sectionId,from:task.from,to:task.to,sourceSectionId:task.sourceSectionId,networkStatus:task.status}],
    tripCount:Number(task.impactToday||0),trainNumbers:task.trainNumbers||[],corridor:task.corridor,corridorLabel:task.corridorLabel||task.corridor,
    networkStatus:task.status,sourceSectionId:task.sourceSectionId,validationEngine:task.validationEngine
  }));
  renderRoutes();lbProductionUpdateV11();
  return net;
}
async function lbProductionNextV11(excludeSid=null){
  if(state.productionV11.busy)return;
  const q=lbProductionQueueV11(excludeSid),next=q[0];
  if(!next){setStatus('🎉 File de validation terminée : aucune brique TODO/legacy restante.','ok');lbProductionUpdateV11();return;}
  await selectRoute(next);lbProductionUpdateV11();
  setStatus(`⚡ Suivante : ${esc(next.origin)} → ${esc(next.destination)} · impact ${Number(next.tripCount||0)} train(s).`,'warn');
}
async function lbProductionWaitSavedV11(sid){
  for(let i=0;i<24;i++){
    try{
      const sv=await fetch(`${API}/state?t=${Date.now()}`,{cache:'no-store'}).then(r=>r.json());
      const s=sv?.sections?.[sid];
      if(s?.status==='validated'){state.serverState=sv;return s;}
    }catch(_){ }
    await new Promise(r=>setTimeout(r,180));
  }
  return null;
}
async function lbProductionWaitLiveV11(sid){
  for(let i=0;i<24;i++){
    try{
      const lv=await fetch(`/map-v2/data/moorail-live-v1/sections.json?t=${Date.now()}`,{cache:'no-store'}).then(r=>r.json());
      if((lv?.pairs||[]).some(x=>String(x?.sectionId||'')===String(sid)))return true;
    }catch(_){ }
    await new Promise(r=>setTimeout(r,180));
  }
  return false;
}

validateLeg=async function(){
  if(state.productionV11.busy)return;
  const secBefore=leg(),pairBefore=stopPair(),sid=secBefore?.id;
  if(!sid)return lbValidateLegOriginalV11();
  state.productionV11.busy=true;lbProductionUpdateV11();
  try{
    // Toutes les protections / géométrie / tracé manuel V10 restent dans la fonction d'origine.
    await lbValidateLegOriginalV11();
    const saved=await lbProductionWaitSavedV11(sid);
    if(!saved){setStatus('La validation n’a pas été confirmée dans STATE : arrêt du mode production.','bad');return;}
    const live=await lbProductionWaitLiveV11(sid);
    if(!live){setStatus('Brique sauvegardée mais absente du LIVE : arrêt avant la suivante.','bad');return;}

    setStatus(`✓ LIVE. Synchronisation réseau de ${esc(pairBefore?.[0]?.name||'?')} → ${esc(pairBefore?.[1]?.name||'?')}…`,'warn');
    const rr=await fetch(`${API}/production-refresh`,{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
    const rd=await rr.json();if(!rr.ok||!rd?.ok)throw new Error(rd?.error||`refresh HTTP ${rr.status}`);
    state.productionV11.lastRefreshMs=rd.durationMs;state.productionV11.lastValidated=sid;
    await lbProductionReloadV11();

    const check=(state.catalog||[]).find(r=>r?.sections?.[0]?.id===sid);
    if(!check||networkStatus(check)!=='VALIDATED_V8'){
      setStatus('Brique LIVE mais network.json ne la classe pas VALIDATED_V8 : arrêt avant suivante.','bad');return;
    }

    // L'analyse publication est informative et ne bloque plus le rythme de validation.
    try{if(typeof refreshPublishPreview==='function')refreshPublishPreview();}catch(_){ }
    setStatus(`✅ VALIDÉE + LIVE + NETWORK (${Number(rd.durationMs||0)} ms). Passage à la suivante…`,'ok');
  }catch(e){
    console.error('[MOO RAIL V11 PRODUCTION]',e);
    setStatus(`MODE PRODUCTION : ${esc(e.message||e)}`,'bad');return;
  }finally{
    state.productionV11.busy=false;lbProductionUpdateV11();
  }
  await new Promise(r=>setTimeout(r,350));
  await lbProductionNextV11(sid);
};

function lbInitProductionV11(){
  lbProductionPanelV11();lbProductionUpdateV11();
  // Le panneau reste à jour même après les renderRoutes/renderLegs historiques.
  setInterval(()=>lbProductionUpdateV11(),1800);
}
setTimeout(lbInitProductionV11,700);
'''
s=s[:pos]+extra+'\n'+s[pos:]
p.write_text(s,encoding='utf-8')
PY
node --check "$TMP/editor.js"
for x in LB_MOORAIL_PRODUCTION_V11 lbProductionReloadV11 lbProductionNextV11 production-refresh 'Valider + suivant'; do
  grep -qF "$x" "$TMP/editor.js" || { echo "ERREUR contrôle JS: $x" >&2; exit 6; }
done
echo "JS V11 préparé : OK"


echo "=== 4/10 CACHE HTML V11 ==="
cp -a "$HTML" "$TMP/editor.html"
python3 - "$TMP/editor.html" <<'PY'
from pathlib import Path
import re,sys
p=Path(sys.argv[1]);s=p.read_text(encoding='utf-8')
s=re.sub(r'/map-v2/moorail-route-editor-stops\.js\?v=[^"\']+','/map-v2/moorail-route-editor-stops.js?v=11',s)
p.write_text(s,encoding='utf-8')
PY


echo "=== 5/10 INSTALLATION ==="
install -o root -g root -m 0644 "$TMP/api.mjs" "$API_FILE"
install -o root -g root -m 0644 "$TMP/editor.js" "$JS"
install -o root -g root -m 0644 "$TMP/editor.html" "$HTML"
[[ -f "$HTML2" ]] && install -o root -g root -m 0644 "$TMP/editor.html" "$HTML2" || true


echo "=== 6/10 RESTART + PRODUIT SERVI ==="
RESTARTED=1
systemctl restart "$SERVICE"
for i in $(seq 1 30); do
  if systemctl is-active --quiet "$SERVICE" && curl -fsS --max-time 3 http://127.0.0.1:3111/api/map-v2/health > "$TMP/health-after.json" 2>/dev/null; then break; fi
  sleep 1
done
systemctl is-active --quiet "$SERVICE"
python3 - "$TMP/health-after.json" <<'PY'
import json,sys
h=json.load(open(sys.argv[1]));assert h.get('ok') is True,h;print('Health :',h)
PY
curl -fsS --max-time 8 "http://127.0.0.1:3111/moorail-route-editor-stops.js?$STAMP" -o "$TMP/served.js"
grep -qF 'LB_MOORAIL_PRODUCTION_V11' "$TMP/served.js"
echo "Editeur V11 servi : OK"


echo "=== 7/10 TEST API REFRESH REEL ==="
HTTP="$(curl -sS -o "$TMP/refresh.json" -w '%{http_code}' -X POST -H 'content-type: application/json' --data '{}' http://127.0.0.1:3111/api/map-v2/route-editor/production-refresh)"
cat "$TMP/refresh.json"; echo
[[ "$HTTP" == "200" ]]
python3 - "$TMP/refresh.json" <<'PY'
import json,sys
x=json.load(open(sys.argv[1]));assert x.get('ok') is True,x;print('Refresh API V11 : OK |',x.get('durationMs'),'ms')
PY


echo "=== 8/10 CONTROLE STATE / LIVE / NETWORK ==="
python3 - "$STATE" "$LIVE" "$NETWORK" <<'PY'
import json,sys
st=json.load(open(sys.argv[1]));lv=json.load(open(sys.argv[2]));net=json.load(open(sys.argv[3]))
valid=[(k,v) for k,v in (st.get('sections') or {}).items() if v.get('status')=='validated' and str(k).startswith('sec-')]
liveids={str(x.get('sectionId')) for x in lv.get('pairs') or []}
tasks=net.get('tasks') or []
nt={str(x.get('sectionId')):x for x in tasks}
coherent=0
for sid,_ in valid:
    if sid in liveids and nt.get(sid,{}).get('status')=='VALIDATED_V8':coherent+=1
print('validées STATE   :',len(valid))
print('cohérentes LIVE+NETWORK :',coherent)
print('stats network    :',net.get('stats'))
assert coherent>0,'aucune validation cohérente'
# Contrôle du cas déjà confirmé auparavant.
sid='sec-70c31b02dc818e00'
if sid in nt:
    print('Haute-Picardie↔CDG :',nt[sid].get('status'))
    assert nt[sid].get('status')=='VALIDATED_V8'
PY


echo "=== 9/10 FILE PRODUCTION : TOP 15 ==="
python3 - "$NETWORK" <<'PY'
import json,sys
n=json.load(open(sys.argv[1]));rows=[]
for t in n.get('tasks') or []:
    if t.get('status')=='VALIDATED_V8':continue
    rank=0 if t.get('status')=='TODO' else 1
    rows.append((rank,-int(t.get('impactToday') or 0),t))
rows.sort(key=lambda z:(z[0],z[1],str((z[2].get('from') or {}).get('name',''))))
for _,__,t in rows[:15]:
    print(f"{str(t.get('status')):8} | impact {int(t.get('impactToday') or 0):3d} | {(t.get('from') or {}).get('name')} → {(t.get('to') or {}).get('name')}")
print('restantes :',len(rows))
PY


echo "=== 10/10 NON-REGRESSION ==="
for marker in LB_MOORAIL_UNIFIED_EDITOR_V10 LB_MOORAIL_PUBLISH_V101 LB_MOORAIL_PRODUCTION_V11; do
  grep -qF "$marker" "$JS" && echo "  $marker : OK"
done
systemctl is-active --quiet "$TIMER"
curl -fsS --max-time 5 http://127.0.0.1:3111/api/map-v2/health

echo
SUCCESS=1
trap - EXIT
cleanup

echo "============================================================"
echo " MOO RAIL V11 INSTALLE — MODE PRODUCTION ACTIF"
echo "============================================================"
echo " - bouton historique => ✓ Valider + suivant"
echo " - validation d'origine V10 conservée"
echo " - vérification STATE puis LIVE"
echo " - refresh network automatique côté serveur"
echo " - contrôle VALIDATED_V8 après refresh"
echo " - prochaine brique choisie automatiquement par impact"
echo " - bouton ⏭ Brique suivante pour passer une section"
echo " - aucune publication automatique : les variantes restent contrôlées"
echo "Backup : $BACKUP"
echo "============================================================"
