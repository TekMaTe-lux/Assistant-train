#!/usr/bin/env bash
set -euo pipefail

ROOT="${MOORAIL_ROOT:-/opt/labetaillere-map-v2-src/map-v2}"
PUBLIC="$ROOT/public"
JS="$PUBLIC/moorail-route-editor-stops.js"
HTML="$PUBLIC/moorail-route-editor.html"
HTML2="$PUBLIC/moorail-route-editor-stops.html"
PREVIEW="$PUBLIC/france-v3-preview.html"
LIVE="$PUBLIC/data/moorail-live-v1/sections.json"
SERVICE="labetaillere-map-v2.service"
TIMER="moorail-network-v8-refresh.timer"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$ROOT/backups/moorail-v11_5-fast-next-$STAMP"
TMP="$(mktemp -d /tmp/moorail-v115.XXXXXX)"
SUCCESS=0

cleanup(){ rm -rf "$TMP"; }
rollback(){
  [[ "$SUCCESS" == 1 ]] && return 0
  echo "ROLLBACK MOO RAIL V11.5..." >&2
  [[ -f "$BACKUP/moorail-route-editor-stops.js" ]] && cp -a "$BACKUP/moorail-route-editor-stops.js" "$JS" || true
  [[ -f "$BACKUP/moorail-route-editor.html" ]] && cp -a "$BACKUP/moorail-route-editor.html" "$HTML" || true
  [[ -f "$BACKUP/moorail-route-editor-stops.html" && -f "$HTML2" ]] && cp -a "$BACKUP/moorail-route-editor-stops.html" "$HTML2" || true
}
finish(){ rc=$?; trap - EXIT; rollback; cleanup; exit "$rc"; }
trap finish EXIT

[[ ${EUID:-$(id -u)} -eq 0 ]] || { echo "ERREUR: lancer avec sudo/root" >&2; exit 2; }
for f in "$JS" "$HTML" "$PREVIEW" "$LIVE"; do [[ -f "$f" ]] || { echo "ERREUR fichier absent: $f" >&2; exit 3; }; done

echo "============================================================"
echo " MOO RAIL V11.5 — NEXT RAPIDE + PROXY ETRANGER DIRECT"
echo "============================================================"
echo "Deux corrections ciblées :"
echo " 1) ne plus re-poller STATE/LIVE après validateLeg original :"
echo "    celui-ci a déjà POSTé + relu STATE avant de rendre la main."
echo " 2) si une gare est hors du RFN français (>5 km du rail chargé),"
echo "    la brique devient temporairement une ligne droite A -> B."
echo

echo "=== 0/8 PRE-FLIGHT ==="
systemctl is-active --quiet "$SERVICE"
systemctl is-active --quiet "$TIMER"
curl -fsS --max-time 5 http://127.0.0.1:3111/api/map-v2/health > "$TMP/health.json"
cat "$TMP/health.json"; echo
for marker in LB_MOORAIL_PRODUCTION_V11 LB_MOORAIL_PRODUCTION_FINALIZER_V113 LB_MOORAIL_TURBO_VALIDATION_V1141; do
  grep -qF "$marker" "$JS" || { echo "ERREUR marqueur JS absent: $marker" >&2; exit 4; }
done
grep -qF 'const lbValidateLegOriginalV11=validateLeg;' "$JS" || { echo "ERREUR référence validation originale V11 absente" >&2; exit 4; }
grep -qF 'LB_MOORAIL_LIVE_PATH_V44' "$PREVIEW" || { echo "ERREUR France V3 ne contient pas l'override MooRail LIVE V4.4" >&2; exit 4; }
if grep -qF 'LB_MOORAIL_FAST_NEXT_FOREIGN_PROXY_V115' "$JS"; then echo "ERREUR V11.5 déjà installée" >&2; exit 5; fi
node --check "$JS"
echo "Pre-flight : OK"

echo "=== 1/8 BACKUP ==="
mkdir -p "$BACKUP"
cp -a "$JS" "$BACKUP/moorail-route-editor-stops.js"
cp -a "$HTML" "$BACKUP/moorail-route-editor.html"
[[ -f "$HTML2" ]] && cp -a "$HTML2" "$BACKUP/moorail-route-editor-stops.html" || true
echo "Backup : $BACKUP"

echo "=== 2/8 PATCH JS ==="
cp -a "$JS" "$TMP/editor.js"
python3 - "$TMP/editor.js" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1]);s=p.read_text(encoding='utf-8')
marker='/* LB_MOORAIL_FAST_NEXT_FOREIGN_PROXY_V115 */'
if marker in s: raise SystemExit('V11.5 déjà présente')
pos=s.rfind('})();')
if pos<0: raise SystemExit('ERREUR fin IIFE introuvable')

extra=r'''

/* LB_MOORAIL_FAST_NEXT_FOREIGN_PROXY_V115 */
// ---------------------------------------------------------------------------
// V11.5 A — fallback provisoire hors RFN français.
// Si l'une des gares est à plus de 5 km du rail RFN actuellement chargé,
// on refuse les grands détours artificiels vers Strasbourg/France et on relie
// directement les deux gares. Cette géométrie est ensuite sauvegardable comme
// n'importe quelle brique et sera remplaçable quand un réseau étranger sera branché.
// ---------------------------------------------------------------------------
const lbRecomputeBeforeV115=recompute;
recompute=async function(){
  state.lbForeignProxyV115=false;
  await lbRecomputeBeforeV115();
  try{
    const pair=stopPair();
    if(!pair || !pair[0] || !pair[1])return;
    const a=[Number(pair[0].lon),Number(pair[0].lat)];
    const b=[Number(pair[1].lon),Number(pair[1].lat)];
    if(!a.every(Number.isFinite)||!b.every(Number.isFinite))return;

    let A=null,B=null,snapA=Infinity,snapB=Infinity;
    if(state.graph){
      try{A=anchorAt(L.latLng(a[1],a[0]),'stop');}catch(_){}
      try{B=anchorAt(L.latLng(b[1],b[0]),'stop');}catch(_){}
      if(A&&Number.isFinite(Number(A.railLon))&&Number.isFinite(Number(A.railLat)))
        snapA=distanceLL(a,[Number(A.railLon),Number(A.railLat)]);
      if(B&&Number.isFinite(Number(B.railLon))&&Number.isFinite(Number(B.railLat)))
        snapB=distanceLL(b,[Number(B.railLon),Number(B.railLat)]);
    }

    const outsideFrenchRFN=!state.graph || !A || !B || Math.max(snapA,snapB)>5000;
    if(!outsideFrenchRFN)return;

    for(const l of state.routeLayers||[])try{map.removeLayer(l)}catch(_){}
    state.routeLayers=[];
    state.via=[];
    try{renderVia();}catch(_){}
    state.routeCoords=[a,b];
    state.routeKm=distanceLL(a,b)/1000;
    state.routeErrors=0;
    state.lbForeignProxyV115=true;
    const line=L.polyline([[a[1],a[0]],[b[1],b[0]]],{
      pane:'route',color:'#ffd84d',weight:5,opacity:.96,dashArray:'10 7'
    }).addTo(map);
    state.routeLayers.push(line);
    updateMetrics(1,state.routeKm,0);
    setStatus(`🌍 Proxy étranger temporaire : ${esc(pair[0].name)} → ${esc(pair[1].name)} relié directement (${state.routeKm.toFixed(1)} km).`,'warn');
  }catch(e){console.warn('[MOO RAIL V11.5 foreign proxy]',e)}
};

// ---------------------------------------------------------------------------
// V11.5 B — validation puis suivante SANS double attente.
// lbValidateLegOriginalV11 est la validation V8.4 originale : elle effectue déjà
// SAVE -> relecture STATE et met state.serverState à jour uniquement si le SAVE
// est confirmé. V11 rajoutait ensuite waitSaved + waitLive, donc deux fetch/polls
// redondants susceptibles de suspendre le bouton. On les supprime du chemin actif.
// ---------------------------------------------------------------------------
validateLeg=async function(){
  if(state?.productionV11?.busy)return;
  const secBefore=leg(),pairBefore=stopPair(),sid=secBefore?.id;
  if(!sid)return lbValidateLegOriginalV11();

  state.productionV11.busy=true;
  state.productionV11.busySince=Date.now();
  state.productionV11.activeSidV113=sid;
  lbProductionUpdateV11();
  const started=Date.now();
  let mayGoNext=false;

  try{
    await lbValidateLegOriginalV11();

    // La fonction originale ne jette pas toujours l'erreur : la vérité est STATE relu.
    const saved=state?.serverState?.sections?.[sid];
    if(saved?.status!=='validated'){
      setStatus('Validation non confirmée dans STATE : la brique reste affichée.','bad');
      return;
    }

    state.productionV11.lastValidated=sid;
    state.productionV11.lastRefreshMs=0;
    const local=(state.catalog||[]).find(r=>String(r?.sections?.[0]?.id||'')===String(sid));
    if(local){
      local.networkStatus='VALIDATED_V8';
      if(local.sections?.[0])local.sections[0].networkStatus='VALIDATED_V8';
    }
    if(state.route && String(state.route?.sections?.[0]?.id||'')===String(sid)){
      state.route.networkStatus='VALIDATED_V8';
      if(state.route.sections?.[0])state.route.sections[0].networkStatus='VALIDATED_V8';
    }
    mayGoNext=true;
  }catch(e){
    console.error('[MOO RAIL V11.5 validation]',e);
    setStatus(`Validation : ${esc(e.message||e)}`,'bad');
  }finally{
    state.productionV11.busy=false;
    state.productionV11.busySince=0;
    state.productionV11.activeSidV113=null;
    lbProductionUpdateV11();
  }

  if(!mayGoNext)return;
  setStatus(`✅ Enregistrée en ${Date.now()-started} ms. Brique suivante…`,'ok');
  await new Promise(r=>setTimeout(r,80));
  try{
    await lbProductionNextV11(sid);
  }catch(e){
    console.error('[MOO RAIL V11.5 next]',e);
    setStatus(`Brique enregistrée, mais chargement suivante impossible : ${esc(e.message||e)}`,'bad');
  }
};
'''
s=s[:pos]+extra+'\n'+s[pos:]
p.write_text(s,encoding='utf-8')
print('Patch V11.5 préparé :')
print(' - wrapper actif sans waitSaved/waitLive redondants')
print(' - STATE relu par validation originale = critère de succès')
print(' - busy libéré avant sélection suivante')
print(' - fallback ligne droite si gare >5 km du RFN français')
PY

node --check "$TMP/editor.js"
grep -qF 'LB_MOORAIL_FAST_NEXT_FOREIGN_PROXY_V115' "$TMP/editor.js"

echo "=== 3/8 SELF-TEST STRUCTUREL ==="
python3 - "$TMP/editor.js" <<'PY'
from pathlib import Path
import sys
s=Path(sys.argv[1]).read_text(encoding='utf-8')
pos=s.rfind('/* LB_MOORAIL_FAST_NEXT_FOREIGN_PROXY_V115 */')
assert pos>=0
blk=s[pos:]
assert 'await lbValidateLegOriginalV11();' in blk
assert 'lbProductionWaitSavedV11(sid)' not in blk
assert 'lbProductionWaitLiveV11(sid)' not in blk
assert 'production-refresh' not in blk
assert "saved?.status!=='validated'" in blk
assert 'state.productionV11.busy=false;' in blk
assert 'await lbProductionNextV11(sid);' in blk
assert 'setTimeout(r,80)' in blk
assert 'Math.max(snapA,snapB)>5000' in blk
assert 'state.routeCoords=[a,b]' in blk
print('SELF-TEST next sans double polling : OK')
print('SELF-TEST busy libéré avant next   : OK')
print('SELF-TEST proxy étranger direct    : OK')
PY

echo "=== 4/8 CACHE HTML ==="
python3 - "$HTML" "$HTML2" <<'PY'
from pathlib import Path
import re,sys
for raw in sys.argv[1:]:
    p=Path(raw)
    if not p.exists():continue
    s=p.read_text(encoding='utf-8')
    s,n=re.subn(r'moorail-route-editor-stops\.js(?:\?v=[^"\']*)?', 'moorail-route-editor-stops.js?v=11.5', s)
    if n==0: raise SystemExit(f'ERREUR référence JS absente: {p}')
    p.write_text(s,encoding='utf-8')
    print('cache:',p.name,'OK')
PY

echo "=== 5/8 INSTALLATION ==="
install -o root -g root -m 0644 "$TMP/editor.js" "$JS"
node --check "$JS"
echo "JS disque : OK"

echo "=== 6/8 PRODUIT SERVI ==="
curl -fsS --max-time 8 "http://127.0.0.1:3111/moorail-route-editor-stops.js?$(date +%s)" -o "$TMP/served.js"
node --check "$TMP/served.js"
grep -qF 'LB_MOORAIL_FAST_NEXT_FOREIGN_PROXY_V115' "$TMP/served.js"
grep -qF 'state.routeCoords=[a,b]' "$TMP/served.js"
echo "V11.5 servi : OK"

echo "=== 7/8 PREUVE FRANCE V3 UTILISE LES VALIDATIONS ==="
curl -fsS --max-time 8 "http://127.0.0.1:3111/france-v3-preview.html?$(date +%s)" -o "$TMP/preview.html"
grep -qF 'LB_MOORAIL_LIVE_PATH_V44' "$TMP/preview.html"
grep -qF 'const moorail=lbMoorailPathBetweenStops(stopA,stopB)' "$TMP/preview.html"
python3 - "$LIVE" <<'PY'
import json,sys
p=json.load(open(sys.argv[1],encoding='utf-8'))
pairs=p.get('pairs') or []
assert pairs, 'aucune section live'
print('France V3 override MooRail : ACTIF')
print('Sections LIVE orientées    :',len(pairs))
PY

echo "=== 8/8 HEALTH / VERDICT ==="
systemctl is-active --quiet "$SERVICE"
systemctl is-active --quiet "$TIMER"
curl -fsS --max-time 5 http://127.0.0.1:3111/api/map-v2/health; echo
SUCCESS=1
trap - EXIT
cleanup

echo
echo "============================================================"
echo " MOO RAIL V11.5 INSTALLE"
echo "============================================================"
echo " - validation : SAVE + STATE puis suivante, sans double polling"
echo " - proxy hors RFN français : ligne droite A -> B"
echo " - France V3 Preview : override MooRail contrôlé actif"
echo " - network.json continue sa consolidation via le timer V8"
echo "Backup : $BACKUP"
echo "============================================================"
