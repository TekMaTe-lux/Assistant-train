#!/usr/bin/env bash
set -euo pipefail

ROOT="${MOORAIL_ROOT:-/opt/labetaillere-map-v2-src/map-v2}"
PUBLIC="$ROOT/public"
JS="$PUBLIC/moorail-route-editor-stops.js"
HTML="$PUBLIC/moorail-route-editor.html"
HTML2="$PUBLIC/moorail-route-editor-stops.html"
SERVICE="labetaillere-map-v2.service"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$ROOT/backups/moorail-v11_7-brick-$STAMP"
TMP="$(mktemp -d /tmp/moorail-v117.XXXXXX)"
SUCCESS=0

cleanup(){ rm -rf "$TMP"; }
rollback(){
  [[ "$SUCCESS" == 1 ]] && return 0
  echo "ROLLBACK MOO RAIL V11.7..." >&2
  [[ -f "$BACKUP/moorail-route-editor-stops.js" ]] && cp -a "$BACKUP/moorail-route-editor-stops.js" "$JS" || true
  [[ -f "$BACKUP/moorail-route-editor.html" ]] && cp -a "$BACKUP/moorail-route-editor.html" "$HTML" || true
  [[ -f "$BACKUP/moorail-route-editor-stops.html" && -f "$HTML2" ]] && cp -a "$BACKUP/moorail-route-editor-stops.html" "$HTML2" || true
}
finish(){ rc=$?; trap - EXIT; rollback; cleanup; exit "$rc"; }
trap finish EXIT

[[ ${EUID:-$(id -u)} -eq 0 ]] || { echo "ERREUR: lancer avec sudo/root" >&2; exit 2; }
[[ -f "$JS" && -f "$HTML" ]] || { echo "ERREUR fichiers editeur absents" >&2; exit 3; }

echo "============================================================"
echo " MOO RAIL V11.7 — MODE BRIQUE PAR BRIQUE"
echo "============================================================"
echo "Principe : 1 clic = 1 POST /save atomique, puis chargement direct"
echo "de la brique suivante. Aucun publish-preview, aucun rebuild réseau,"
echo "aucun second polling STATE/LIVE dans le chemin critique."
echo

echo "=== 0/7 PRE-FLIGHT ==="
systemctl is-active --quiet "$SERVICE"
curl -fsS --max-time 5 http://127.0.0.1:3111/api/map-v2/health > "$TMP/health.json"
cat "$TMP/health.json"; echo
for marker in LB_MOORAIL_PRODUCTION_V11 LB_MOORAIL_FAST_NEXT_FOREIGN_PROXY_V115; do
  grep -qF "$marker" "$JS" || { echo "ERREUR marqueur JS absent: $marker" >&2; exit 4; }
done
if grep -qF 'LB_MOORAIL_BRICK_BY_BRICK_V117' "$JS"; then
  echo "ERREUR V11.7 déjà installée" >&2; exit 5
fi
node --check "$JS"
echo "Pre-flight : OK"

echo "=== 1/7 BACKUP ==="
mkdir -p "$BACKUP"
cp -a "$JS" "$BACKUP/moorail-route-editor-stops.js"
cp -a "$HTML" "$BACKUP/moorail-route-editor.html"
[[ -f "$HTML2" ]] && cp -a "$HTML2" "$BACKUP/moorail-route-editor-stops.html" || true
echo "Backup : $BACKUP"

echo "=== 2/7 PATCH JS ==="
cp -a "$JS" "$TMP/editor.js"
python3 - "$TMP/editor.js" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1]); s=p.read_text(encoding='utf-8')
marker='/* LB_MOORAIL_BRICK_BY_BRICK_V117 */'
if marker in s: raise SystemExit('V11.7 déjà présente')
pos=s.rfind('})();')
if pos<0: raise SystemExit('ERREUR fin IIFE introuvable')
extra=r'''

/* LB_MOORAIL_BRICK_BY_BRICK_V117 */
// V11.7 — mode volontairement minimal : UNE brique, UN save, puis la suivante.
function lbBrickSidV117(r){ return String(r?.sections?.[0]?.id||''); }
function lbBrickDoneV117(r){
  const sid=lbBrickSidV117(r);
  if(!sid)return true;
  if(state?.serverState?.sections?.[sid]?.status==='validated')return true;
  try{ if(networkStatus(r)==='VALIDATED_V8')return true; }catch(_){}
  return false;
}
function lbBrickNextCandidateV117(currentSid){
  const all=state.catalog||[];
  const idx=Math.max(0,all.findIndex(r=>lbBrickSidV117(r)===String(currentSid||'')));
  for(let step=1;step<=all.length;step++){
    const r=all[(idx+step)%all.length];
    if(!lbBrickDoneV117(r))return r;
  }
  return null;
}
async function lbBrickOpenV117(r){
  if(!r)return;
  state.route=r;
  state.legIndex=0;
  state.via=[];
  renderRoutes();
  renderLegs();
  setStatus(`⏭ Chargement : ${esc(r.origin)} → ${esc(r.destination)}…`,'warn');
  await activateLeg(0); // volontairement SANS selectRoute(): évite refreshPublishPreview()
  try{lbProductionUpdateV11();}catch(_){}
}

validateLeg=async function(){
  if(state?.productionV11?.busy)return;
  const sec=leg(),pair=stopPair();
  if(!sec||!pair){setStatus('Aucune brique sélectionnée.','bad');return;}
  if(state.routeErrors||!Array.isArray(state.routeCoords)||state.routeCoords.length<2){
    setStatus(`Impossible de valider : tracé non continu (${state.routeErrors||0} erreur(s)).`,'bad');return;
  }

  const sid=String(sec.id||'');
  const payload={
    routeId:(state.route.saveRouteId||state.route.id),
    sectionId:sid,
    status:'validated',
    source:'MOORAIL_VALIDATED_SECTIONS_V8',
    canonical:true,
    canonicalSectionId:sid,
    corridor:state.route.corridor,
    validationEngine:state.lbForeignProxyV115?'FOREIGN_PROXY_V115':'ROUTER_V6',
    route:{origin:'Réseau',destination:state.route.corridorLabel||state.route.corridor||'',signature:state.route.corridor||''},
    stopFrom:{name:pair[0].name,lat:+pair[0].lat,lon:+pair[0].lon},
    stopTo:{name:pair[1].name,lat:+pair[1].lat,lon:+pair[1].lon},
    waypoints:(state.via||[]).map(x=>({lat:x.lat,lon:x.lon})),
    coordinates:state.routeCoords,
    distanceKm:+Number(state.routeKm||0).toFixed(3)
  };

  state.productionV11.busy=true;
  state.productionV11.busySince=Date.now();
  try{lbProductionUpdateV11();}catch(_){}
  const started=performance.now();

  try{
    const ctl=new AbortController();
    const timer=setTimeout(()=>ctl.abort(),15000);
    let r,raw,d;
    try{
      r=await fetch(`${API}/save`,{
        method:'POST',
        headers:{'content-type':'application/json'},
        body:JSON.stringify(payload),
        signal:ctl.signal
      });
      raw=await r.text();
    }finally{ clearTimeout(timer); }
    try{d=JSON.parse(raw||'{}')}catch(_){d={error:raw||`HTTP ${r?.status||'?'}`}}
    if(!r?.ok||!d?.ok||d?.saved?.status!=='validated')throw new Error(d?.error||`HTTP ${r?.status||'?'}`);

    state.serverState=state.serverState||{sections:{}};
    state.serverState.sections=state.serverState.sections||{};
    state.serverState.sections[sid]=d.saved;

    const local=(state.catalog||[]).find(x=>lbBrickSidV117(x)===sid);
    if(local){
      local.networkStatus='VALIDATED_V8';
      if(local.sections?.[0])local.sections[0].networkStatus='VALIDATED_V8';
    }
    if(state.route&&lbBrickSidV117(state.route)===sid){
      state.route.networkStatus='VALIDATED_V8';
      if(state.route.sections?.[0])state.route.sections[0].networkStatus='VALIDATED_V8';
    }

    const elapsed=Math.round(performance.now()-started);
    const next=lbBrickNextCandidateV117(sid);

    state.productionV11.busy=false;
    state.productionV11.busySince=0;
    state.productionV11.activeSidV113=null;
    try{lbProductionUpdateV11();}catch(_){}

    if(!next){
      renderRoutes();renderLegs();
      setStatus(`✅ Brique enregistrée en ${elapsed} ms. File terminée.`,'ok');
      return;
    }

    setStatus(`✅ Brique enregistrée en ${elapsed} ms. Suivante…`,'ok');
    await lbBrickOpenV117(next);
  }catch(e){
    state.productionV11.busy=false;
    state.productionV11.busySince=0;
    state.productionV11.activeSidV113=null;
    try{lbProductionUpdateV11();}catch(_){}
    console.error('[MOO RAIL V11.7 brick save]',e);
    setStatus(`ÉCHEC sauvegarde : ${esc(e?.name==='AbortError'?'timeout 15 s':(e?.message||e))}`,'bad');
  }
};

function lbBindBrickV117(){
  const buttons=[...document.querySelectorAll('button')];
  const vb=buttons.find(b=>/Valider cette brique V8|Valider \+ suivant|Validation \/ synchronisation/i.test(b.textContent||''));
  if(!vb)return;
  vb.dataset.moorailBrickV117='1';
  if(!state?.productionV11?.busy)vb.textContent='✓ Valider cette brique → suivante';
  vb.onclick=(ev)=>{ev.preventDefault();ev.stopPropagation();validateLeg();};
}
setInterval(lbBindBrickV117,500);
setTimeout(lbBindBrickV117,0);
'''
s=s[:pos]+extra+'\n'+s[pos:]
p.write_text(s,encoding='utf-8')
print('Patch V11.7 préparé :')
print(' - 1 seul POST /save')
print(' - aucun waitSaved / waitLive / production-refresh')
print(' - aucun refreshPublishPreview pour passer à la suivante')
print(' - sélection directe de la prochaine brique non validée')
PY
node --check "$TMP/editor.js"
grep -qF 'LB_MOORAIL_BRICK_BY_BRICK_V117' "$TMP/editor.js"

echo "=== 3/7 SELF-TEST STRUCTUREL ==="
python3 - "$TMP/editor.js" <<'PY'
from pathlib import Path
import sys
s=Path(sys.argv[1]).read_text(encoding='utf-8')
pos=s.rfind('/* LB_MOORAIL_BRICK_BY_BRICK_V117 */')
assert pos>=0
b=s[pos:]
assert "fetch(`${API}/save`" in b
assert 'lbProductionWaitSavedV11' not in b
assert 'lbProductionWaitLiveV11' not in b
assert 'production-refresh' not in b
assert 'await lbBrickOpenV117(next)' in b
assert 'await activateLeg(0)' in b
assert 'await selectRoute(next)' not in b
assert 'refreshPublishPreview' not in b
assert "setTimeout(()=>ctl.abort(),15000)" in b
print('SELF-TEST 1 POST /save             : OK')
print('SELF-TEST aucun double polling     : OK')
print('SELF-TEST aucun rebuild bloquant   : OK')
print('SELF-TEST suivante sans publication: OK')
print('SELF-TEST timeout SAVE 15 s        : OK')
PY

echo "=== 4/7 CACHE HTML ==="
python3 - "$HTML" "$HTML2" <<'PY'
from pathlib import Path
import re,sys
for raw in sys.argv[1:]:
    p=Path(raw)
    if not p.exists():continue
    s=p.read_text(encoding='utf-8')
    s,n=re.subn(r'moorail-route-editor-stops\.js(?:\?v=[^"\']*)?', 'moorail-route-editor-stops.js?v=11.7', s)
    if n==0: raise SystemExit(f'ERREUR référence JS absente: {p}')
    p.write_text(s,encoding='utf-8')
    print('cache:',p.name,'OK')
PY

echo "=== 5/7 INSTALLATION ==="
install -o root -g root -m 0644 "$TMP/editor.js" "$JS"
node --check "$JS"
echo "JS disque : OK"

echo "=== 6/7 PRODUIT SERVI ==="
curl -fsS --max-time 8 "http://127.0.0.1:3111/moorail-route-editor-stops.js?$(date +%s)" -o "$TMP/served.js"
node --check "$TMP/served.js"
grep -qF 'LB_MOORAIL_BRICK_BY_BRICK_V117' "$TMP/served.js"
grep -qF 'Valider cette brique → suivante' "$TMP/served.js"
echo "V11.7 servi : OK"

echo "=== 7/7 HEALTH / VERDICT ==="
systemctl is-active --quiet "$SERVICE"
curl -fsS --max-time 5 http://127.0.0.1:3111/api/map-v2/health; echo
SUCCESS=1
trap - EXIT
cleanup

echo
echo "============================================================"
echo " MOO RAIL V11.7 INSTALLE — BRIQUE PAR BRIQUE"
echo "============================================================"
echo " - 1 clic = 1 sauvegarde atomique"
echo " - puis chargement direct de la prochaine brique"
echo " - aucune publication/reconstruction dans le clic"
echo "Backup : $BACKUP"
echo "============================================================"
