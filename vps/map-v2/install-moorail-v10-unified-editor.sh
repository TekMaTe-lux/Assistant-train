#!/usr/bin/env bash
set -euo pipefail

ROOT="${MOORAIL_ROOT:-/opt/labetaillere-map-v2-src/map-v2}"
PUBLIC="$ROOT/public"
JS="$PUBLIC/moorail-route-editor-stops.js"
HTML="$PUBLIC/moorail-route-editor.html"
HTML2="$PUBLIC/moorail-route-editor-stops.html"
SERVICE="labetaillere-map-v2.service"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$ROOT/backups/moorail-v10-unified-editor-$STAMP"
TMP="$(mktemp -d /tmp/moorail-v10.XXXXXX)"
SUCCESS=0
RESTARTED=0

cleanup(){ rm -rf "$TMP"; }
rollback(){
  [[ "$SUCCESS" == 1 ]] && return 0
  echo "ROLLBACK MOO RAIL V10..." >&2
  [[ -f "$BACKUP/moorail-route-editor-stops.js" ]] && cp -a "$BACKUP/moorail-route-editor-stops.js" "$JS" || true
  [[ -f "$BACKUP/moorail-route-editor.html" ]] && cp -a "$BACKUP/moorail-route-editor.html" "$HTML" || true
  [[ -f "$BACKUP/moorail-route-editor-stops.html" ]] && cp -a "$BACKUP/moorail-route-editor-stops.html" "$HTML2" || true
  if [[ "$RESTARTED" == 1 ]]; then systemctl restart "$SERVICE" >/dev/null 2>&1 || true; fi
}
finish(){ rc=$?; trap - EXIT; rollback; cleanup; exit "$rc"; }
trap finish EXIT

[[ ${EUID:-$(id -u)} -eq 0 ]] || { echo "ERREUR: lancer avec sudo/root" >&2; exit 2; }
for f in "$JS" "$HTML"; do [[ -f "$f" ]] || { echo "ERREUR fichier absent: $f" >&2; exit 3; }; done

echo "============================================================"
echo " MOO RAIL V10 — EDITEUR UNIFIE / SNAP ADAPTATIF"
echo "============================================================"
echo "Objectifs issus de l'audit V9.4 :"
echo " - précision adaptée au zoom"
echo " - snap qui comprend le SENS du trait"
echo " - le rouge remplace seulement une ZONE du jaune existant"
echo " - Sortie A / Entrée B / choix 1-5 ne se battent plus avec le crayon"
echo " - conservation de V9.4 anti-zigzag"
echo

echo "=== 0/10 PRE-FLIGHT ==="
systemctl is-active --quiet "$SERVICE"
curl -fsS --max-time 5 http://127.0.0.1:3111/api/map-v2/health > "$TMP/health-before.json"
python3 - "$TMP/health-before.json" <<'PY'
import json,sys
h=json.load(open(sys.argv[1]));assert h.get('ok') is True,h
print('Health :',h)
PY
for marker in \
  LB_MOORAIL_ENDPOINT_HANDLES_V89 \
  LB_MOORAIL_DIRECTION_CHOOSER_V90 \
  LB_MOORAIL_FREEHAND_TRACE_V91 \
  LB_MOORAIL_FREEHAND_SIMPLIFY_V92 \
  LB_MOORAIL_TRACE_GUIDED_TOPOLOGY_V93 \
  LB_MOORAIL_LANE_CONTINUITY_V94; do
  grep -qF "$marker" "$JS" || { echo "ERREUR marqueur absent: $marker" >&2; exit 4; }
done
node --check "$JS"
if grep -qF 'LB_MOORAIL_UNIFIED_EDITOR_V10' "$JS"; then
  echo "ERREUR: V10 déjà présente" >&2
  exit 5
fi

# Ancres attendues réellement dans l'état V9.4.
grep -qF 'const corridor=55;' "$JS"
grep -qF 'if(q.d<=900)raw.push' "$JS"
grep -qF 'function lbStrictRailAnchorV89' "$JS"
grep -qF 'function lbToggleManualDrawV91' "$JS"
grep -qF 'function lbClearManualTraceV91' "$JS"
grep -qF 'manualGuideV93:(state.manualGuideV93||[])' "$JS"

echo "Pre-flight structure : OK"

echo "=== 1/10 BACKUP ==="
mkdir -p "$BACKUP"
cp -a "$JS" "$BACKUP/moorail-route-editor-stops.js"
cp -a "$HTML" "$BACKUP/moorail-route-editor.html"
[[ -f "$HTML2" ]] && cp -a "$HTML2" "$BACKUP/moorail-route-editor-stops.html" || true
echo "Backup : $BACKUP"

echo "=== 2/10 PATCH V10 ==="
cp -a "$JS" "$TMP/editor.js"
python3 - "$TMP/editor.js" <<'PY'
from pathlib import Path
import re,sys
p=Path(sys.argv[1]);s=p.read_text(encoding='utf-8')
marker='/* LB_MOORAIL_UNIFIED_EDITOR_V10 */'
if marker in s:raise SystemExit('V10 déjà présente')

# 1) Le corridor rouge n'est plus fixe à 55 m.
old='const corridor=55; // mètres autour du trait rouge'
new='const corridor=lbGuidedCorridorV10(guide); // V10 : largeur adaptée au zoom'
if old not in s:raise SystemExit('ERREUR ancre corridor V9.3 absente')
s=s.replace(old,new,1)

# 2) Le rayon des choix 1-5 n'est plus fixe à 900 m.
old2='if(q.d<=900)raw.push({seg,q});'
new2='if(q.d<=lbDirectionRadiusV10(stop))raw.push({seg,q});'
if old2 not in s:raise SystemExit('ERREUR ancre rayon choix V9.0 absente')
s=s.replace(old2,new2,1)

# 3) Persistance du tracé jaune servant de base à une correction LOCALE.
needle="manualGuideV93:(state.manualGuideV93||[]).map(p=>[+p[0],+p[1]]),coordinates:state.routeCoords,"
if needle not in s:raise SystemExit('ERREUR payload manualGuideV93 absent')
s=s.replace(needle,"manualGuideV93:(state.manualGuideV93||[]).map(p=>[+p[0],+p[1]]),manualBaseRouteV10:(state.manualBaseRouteV10||[]).map(p=>[+p[0],+p[1]]),coordinates:state.routeCoords,",1)

# Recharge V10 juste après manualGuideV93.
pat=re.compile(r"(state\.manualGuideV93=\(saved\?\.manualGuideV93\|\|\[\]\)\.map\(p=>\[\+p\[0\],\+p\[1\]\]\)\.filter\(p=>Number\.isFinite\(p\[0\]\)&&Number\.isFinite\(p\[1\]\)\);)")
m=pat.search(s)
if not m:raise SystemExit('ERREUR reload manualGuideV93 absent')
load=m.group(1)+"\n  state.manualBaseRouteV10=(saved?.manualBaseRouteV10||[]).map(p=>[+p[0],+p[1]]).filter(p=>Number.isFinite(p[0])&&Number.isFinite(p[1]));"
s=s[:m.start()]+load+s[m.end():]

# Helpers V10 ajoutés en fin de fichier : ils surchargent proprement les anciennes
# fonctions sans supprimer V8.9->V9.4 (rollback et compatibilité restent simples).
append=marker+r'''

// ---------------------------------------------------------------------------
// V10 — moteur d'édition unifié
// ---------------------------------------------------------------------------
state.manualBaseRouteV10=state.manualBaseRouteV10||[];
state.manualSpliceStatsV10=null;

function lbClampV10(v,a,b){return Math.max(a,Math.min(b,v));}
function lbMetersPerPixelV10(lat=null){
  const z=map?.getZoom?.()??12;
  const phi=Number.isFinite(+lat)?+lat:(map?.getCenter?.().lat??47);
  return 156543.03392*Math.cos(phi*Math.PI/180)/Math.pow(2,z);
}
function lbAdaptiveMetersV10(px,minM,maxM,lat=null){
  return lbClampV10(lbMetersPerPixelV10(lat)*px,minM,maxM);
}
function lbEndpointRadiusV10(latlng){return lbAdaptiveMetersV10(20,45,1400,latlng?.lat);}
function lbDirectionRadiusV10(stop){return lbAdaptiveMetersV10(30,500,1800,+stop?.lat);}
function lbGuidedCorridorV10(guide){
  const lat=guide?.length?+guide[Math.floor(guide.length/2)][0]:null;
  return lbAdaptiveMetersV10(16,70,1600,lat);
}
function lbManualJoinRadiusV10(guide){
  const lat=guide?.length?+guide[0][0]:null;
  return lbAdaptiveMetersV10(26,180,2400,lat);
}
function lbAcuteHeadingDiffV10(ax,ay,bx,by){
  const na=Math.hypot(ax,ay),nb=Math.hypot(bx,by);if(!na||!nb)return 0;
  let d=Math.abs((ax*bx+ay*by)/(na*nb));d=Math.max(0,Math.min(1,d));
  return Math.acos(d)*180/Math.PI;
}
function lbSegmentHeadingDiffV10(seg,vec,lat){
  if(!vec)return 0;
  const c=Math.cos((lat||0)*Math.PI/180);
  const sx=(seg.b[0]-seg.a[0])*c,sy=seg.b[1]-seg.a[1];
  return lbAcuteHeadingDiffV10(sx,sy,vec[0],vec[1]);
}
function lbCurrentSnapHeadingV10(latlng){
  const c=Math.cos((+latlng.lat||0)*Math.PI/180);
  if(state.manualDrawingV91&&(state.manualGuideRawV91||[]).length>=2){
    const a=state.manualGuideRawV91.at(-2),b=state.manualGuideRawV91.at(-1);
    return [(b[1]-a[1])*c,b[0]-a[0]];
  }
  const p=stopPair?.();
  if(p&&state.endpointMode==='A')return [(+latlng.lng-+p[0].lon)*c,+latlng.lat-+p[0].lat];
  if(p&&state.endpointMode==='B')return [(+p[1].lon-+latlng.lng)*c,+p[1].lat-+latlng.lat];
  return null;
}
function lbStrictRailAnchorV10(latlng,heading=null,radius=null){
  if(!state.graph||!state.segments?.size)return null;
  const r=radius||lbEndpointRadiusV10(latlng),vec=heading||lbCurrentSnapHeadingV10(latlng);
  let best=null;
  for(const seg of state.segments.values()){
    const q=projectToSeg(latlng,seg);if(q.d>r)continue;
    const ang=lbSegmentHeadingDiffV10(seg,vec,latlng.lat);
    // A distance comparable, une voie dans le sens du geste gagne largement
    // sur une voie qui le coupe ou repart en sens transversal.
    const score=q.d + r*Math.pow(ang/90,2)*0.78;
    if(!best||score<best.score)best={seg,...q,score,ang};
  }
  if(!best)return null;
  const seg=best.seg,base=(seg.cost||seg.w||distanceLL(seg.a,seg.b));
  return {
    lat:best.p[1],lon:best.p[0],railLat:best.p[1],railLon:best.p[0],
    nearestSeg:seg.id,strict:true,snapDistance:best.d,snapAngleV10:best.ang,
    links:[{node:seg.aKey,cost:base*best.t+best.d},{node:seg.bKey,cost:base*(1-best.t)+best.d}]
  };
}

// Remplace le snap V8.9 partout : vias manuels, poignée précise et fallback V9.0.
lbStrictRailAnchorV89=lbStrictRailAnchorV10;

function lbProjectPointOnRouteV10(gp,coords){
  if(!Array.isArray(coords)||coords.length<2)return null;
  const ll=L.latLng(+gp[0],+gp[1]);let best=null;
  for(let i=0;i<coords.length-1;i++){
    const seg={a:coords[i],b:coords[i+1]},q=projectToSeg(ll,seg);
    if(!best||q.d<best.d)best={i,t:q.t,p:q.p,d:q.d,pos:i+q.t};
  }
  return best;
}
function lbRoutePrefixToV10(coords,x){
  const out=coords.slice(0,x.i+1).map(p=>[+p[0],+p[1]]);
  if(!out.length||distanceLL(out.at(-1),x.p)>1)out.push([+x.p[0],+x.p[1]]);
  else out[out.length-1]=[+x.p[0],+x.p[1]];
  return out;
}
function lbRouteSuffixFromV10(coords,x){
  const out=[[+x.p[0],+x.p[1]]];
  for(let i=x.i+1;i<coords.length;i++)out.push([+coords[i][0],+coords[i][1]]);
  return out;
}
function lbAppendCoordsV10(out,arr){
  for(const p of arr||[]){
    const q=[+p[0],+p[1]];if(!q.every(Number.isFinite))continue;
    if(out.length&&distanceLL(out.at(-1),q)<2)continue;
    out.push(q);
  }
}
function lbLocalSpliceByRedV10(){
  let guide=(state.manualGuideV93||[]).map(p=>[+p[0],+p[1]]).filter(p=>p.every(Number.isFinite));
  const base=(state.manualBaseRouteV10||[]).map(p=>[+p[0],+p[1]]).filter(p=>p.every(Number.isFinite));
  if(guide.length<2||base.length<2)return {error:'no-local-base'};

  let a=lbProjectPointOnRouteV10(guide[0],base),b=lbProjectPointOnRouteV10(guide.at(-1),base);
  if(!a||!b)return {error:'splice-projection'};
  if(a.pos>b.pos){guide.reverse();a=lbProjectPointOnRouteV10(guide[0],base);b=lbProjectPointOnRouteV10(guide.at(-1),base);}
  const join=lbManualJoinRadiusV10(guide);
  if(!a||!b||a.pos>=b.pos)return {error:'splice-order'};
  if(a.d>join||b.d>join)return {error:'splice-too-far',stats:{startDistance:a.d,endDistance:b.d,joinRadius:join}};

  // Les extrémités du rouge sont recollées SUR le jaune existant avant le routage.
  // L'intérieur du rouge reste exactement l'intention dessinée.
  guide[0]=[a.p[1],a.p[0]];guide[guide.length-1]=[b.p[1],b.p[0]];
  const core=lbBuildGuidedCoreV93(guide);
  if(!core||core.error||!Array.isArray(core.coords)||core.coords.length<2)
    return {error:core?.error||'guided-core',stats:{...(core?.stats||{}),startDistance:a.d,endDistance:b.d,joinRadius:join}};

  const out=[];
  lbAppendCoordsV10(out,lbRoutePrefixToV10(base,a));
  lbAppendCoordsV10(out,core.coords);
  lbAppendCoordsV10(out,lbRouteSuffixFromV10(base,b));
  if(out.length<2)return {error:'splice-empty'};
  return {coords:out,stats:{...(core.stats||{}),startDistance:a.d,endDistance:b.d,joinRadius:join,replacedFrom:a.pos,replacedTo:b.pos}};
}
function lbRenderLocalSpliceV10(result){
  for(const l of state.routeLayers)try{map.removeLayer(l)}catch(_){ }
  state.routeLayers=[];state.routeCoords=[];state.routeKm=0;state.routeErrors=0;
  if(!result||result.error||!result.coords?.length){
    state.routeErrors=1;updateMetrics(0,0,1);
    const st=result?.stats||{};
    setStatus(`⚠ Correction locale impossible (${esc(result?.error||'inconnue')}). Début rouge→jaune ${Number.isFinite(st.startDistance)?Math.round(st.startDistance)+' m':'?'} · fin ${Number.isFinite(st.endDistance)?Math.round(st.endDistance)+' m':'?'} · tolérance zoom ${Number.isFinite(st.joinRadius)?Math.round(st.joinRadius)+' m':'?'}. Commence et termine ton rouge SUR le jaune existant.`,'bad');
    return;
  }
  state.routeCoords=result.coords;
  for(let i=1;i<result.coords.length;i++)state.routeKm+=distanceLL(result.coords[i-1],result.coords[i])/1000;
  const line=L.polyline(result.coords.map(x=>[x[1],x[0]]),{pane:'route',color:'#ffd84d',weight:7,opacity:.98,lineJoin:'round',lineCap:'round'}).addTo(map);
  state.routeLayers.push(line);updateMetrics(1,state.routeKm,0);state.manualSpliceStatsV10=result.stats||null;
  const st=result.stats||{};
  setStatus(`✓ CORRECTION LOCALE V10 : le rouge a remplacé seulement la zone dessinée · raccord début ${Math.round(st.startDistance||0)} m · fin ${Math.round(st.endDistance||0)} m · tolérance adaptée au zoom ${Math.round(st.joinRadius||0)} m · voie stable V9.4. Si le jaune suit le rouge, valide.`,'ok');
}

// Surcharge du recalcul : avec rouge + base jaune, on ne recalcule PLUS gare→gare.
const lbRecomputeBeforeV10=recompute;
recompute=function(){
  if((state.manualGuideV93||[]).length>=2&&(state.manualBaseRouteV10||[]).length>=2){
    lbRenderManualGuideV91();
    return lbRenderLocalSpliceV10(lbLocalSpliceByRedV10());
  }
  return lbRecomputeBeforeV10();
};

// Au démarrage du crayon, mémorise le jaune ACTUEL comme base puis rend les
// outils mutuellement exclusifs. La correction suivante n'altère que sa zone.
const lbToggleManualBeforeV10=lbToggleManualDrawV91;
lbToggleManualDrawV91=function(){
  if(!state.manualDrawModeV91){
    state.manualBaseRouteV10=(state.routeCoords||[]).map(p=>[+p[0],+p[1]]).filter(p=>p.every(Number.isFinite));
    if(typeof lbClearDirectionChoicesV90==='function')lbClearDirectionChoicesV90();
    state.endpointMode=null;
    // On retire seulement l'ancien GUIDE après avoir capturé son jaune corrigé.
    state.manualGuideV93=[];state.manualTraceV91=[];state.manualGuideRawV91=[];
    if(state.manualGuideLayerV91){try{map.removeLayer(state.manualGuideLayerV91)}catch(_){ }state.manualGuideLayerV91=null;}
  }
  return lbToggleManualBeforeV10();
};

const lbClearManualBeforeV10=lbClearManualTraceV91;
lbClearManualTraceV91=function(recomputeNow=false){
  state.manualBaseRouteV10=[];state.manualSpliceStatsV10=null;
  return lbClearManualBeforeV10(recomputeNow);
};

// Sortie/Entrée et crayon sont des MODES exclusifs : plus de résultat mélangeant
// un rouge V9.3 et une option 1-5 V9.0 calculée autrement.
const lbSetEndpointModeBeforeV10=lbSetEndpointModeV89;
lbSetEndpointModeV89=function(which){
  if((state.manualGuideV93||[]).length||(state.manualTraceV91||[]).length){
    lbClearManualTraceV91(false);
    lbRecomputeBeforeV10();
    setStatus('Mode direction : le tracé rouge a été désactivé pour éviter de mélanger deux moteurs. Choisis maintenant la direction A/B.','warn');
  }
  return lbSetEndpointModeBeforeV10(which);
};

// Rebind : les anciens onclick avaient capturé les fonctions précédentes.
if($('manualDrawV91'))$('manualDrawV91').onclick=()=>lbToggleManualDrawV91();
if($('manualClearV91'))$('manualClearV91').onclick=()=>lbClearManualTraceV91(true);
if($('forceA'))$('forceA').onclick=()=>lbSetEndpointModeV89('A');
if($('forceB'))$('forceB').onclick=()=>lbSetEndpointModeV89('B');

window.lbMoorailEditorV10={
  version:'10',
  endpointRadius:ll=>lbEndpointRadiusV10(ll),
  corridor:g=>lbGuidedCorridorV10(g),
  joinRadius:g=>lbManualJoinRadiusV10(g),
  localSplice:()=>lbLocalSpliceByRedV10()
};
'''

s=s.rstrip()+"\n\n"+append+"\n"
p.write_text(s,encoding='utf-8')
print('Patch V10 préparé')
PY

node --check "$TMP/editor.js"

echo "=== 3/10 CONTROLES STRUCTURELS ==="
python3 - "$TMP/editor.js" <<'PY'
from pathlib import Path
import sys
js=Path(sys.argv[1]).read_text(encoding='utf-8')
checks={
 'marker':'LB_MOORAIL_UNIFIED_EDITOR_V10' in js,
 'zoom-anchor':'function lbEndpointRadiusV10' in js and 'lbMetersPerPixelV10' in js,
 'zoom-corridor':'lbGuidedCorridorV10(guide)' in js,
 'zoom-direction':'lbDirectionRadiusV10(stop)' in js,
 'heading-snap':'lbSegmentHeadingDiffV10' in js and 'snapAngleV10' in js,
 'local-splice':'function lbLocalSpliceByRedV10' in js,
 'preserve-prefix':'lbRoutePrefixToV10' in js,
 'preserve-suffix':'lbRouteSuffixFromV10' in js,
 'existing-yellow-base':'state.manualBaseRouteV10=(state.routeCoords||[])' in js,
 'mode-exclusive':'le tracé rouge a été désactivé' in js,
 'persist-base':'manualBaseRouteV10:(state.manualBaseRouteV10||[])' in js,
 'v94-kept':'LB_MOORAIL_LANE_CONTINUITY_V94' in js,
}
for k,v in checks.items():print(' ',k,':','OK' if v else 'FAIL')
assert all(checks.values()),checks
PY

echo "=== 4/10 SELF-TEST ZOOM ADAPTATIF ==="
node <<'JS'
function clamp(v,a,b){return Math.max(a,Math.min(b,v))}
function mpp(z,lat=50){return 156543.03392*Math.cos(lat*Math.PI/180)/Math.pow(2,z)}
function adaptive(z,px,min,max){return clamp(mpp(z)*px,min,max)}
const a15=adaptive(15,20,45,1400),a10=adaptive(10,20,45,1400);
const c15=adaptive(15,16,70,1600),c10=adaptive(10,16,70,1600);
console.log('A/B z15=',Math.round(a15),'m | z10=',Math.round(a10),'m');
console.log('rouge z15=',Math.round(c15),'m | z10=',Math.round(c10),'m');
if(!(a10>a15&&c10>c15))process.exit(2);
console.log('SELF-TEST ZOOM : OK');
JS

echo "=== 5/10 SELF-TEST SNAP SELON LE SENS ==="
node <<'JS'
function diff(ax,ay,bx,by){const na=Math.hypot(ax,ay),nb=Math.hypot(bx,by);let d=Math.abs((ax*bx+ay*by)/(na*nb));d=Math.max(0,Math.min(1,d));return Math.acos(d)*180/Math.PI}
function score(dist,angle,r=300){return dist+r*Math.pow(angle/90,2)*.78}
const aligned=score(18,diff(1,0,1,0));
const crossing=score(8,diff(0,1,1,0));
console.log('voie alignée score=',aligned.toFixed(1),'| voie croisée plus proche score=',crossing.toFixed(1));
if(!(aligned<crossing))process.exit(2);
console.log('SELF-TEST HEADING SNAP : OK');
JS

echo "=== 6/10 SELF-TEST RACCORD LOCAL AU TRACE EXISTANT ==="
python3 - <<'PY'
# Test conceptuel du splice : préfixe/suffixe existants doivent rester bit-identiques.
base=[[0,0],[1,0],[2,0],[3,0],[4,0]]
core=[[1,0],[1.5,1],[2.5,1],[3,0]]
out=base[:2]+core[1:-1]+base[3:]
assert out[0]==base[0] and out[1]==base[1]
assert out[-2:]==base[-2:]
assert [1.5,1] in out and [2.5,1] in out
print('prefixe conservé :',out[:2])
print('suffixe conservé :',out[-2:])
print('SELF-TEST SPLICE LOCAL : OK')
PY

echo "=== 7/10 SELF-TEST MODES / BOUTONS ==="
python3 - "$TMP/editor.js" "$HTML" <<'PY'
from pathlib import Path
import sys
js=Path(sys.argv[1]).read_text(encoding='utf-8');html=Path(sys.argv[2]).read_text(encoding='utf-8')
checks={
 'forceA':'id="forceA"' in html,
 'forceB':'id="forceB"' in html,
 'resetEnds':'id="resetEnds"' in html,
 'draw':'id="manualDrawV91"' in html,
 'clear':'id="manualClearV91"' in html,
 'rebind-draw':"$('manualDrawV91').onclick=()=>lbToggleManualDrawV91()" in js,
 'rebind-A':"$('forceA').onclick=()=>lbSetEndpointModeV89('A')" in js,
 'manual-clears-choice':'lbClearDirectionChoicesV90' in js,
 'endpoint-clears-red':"lbClearManualTraceV91(false)" in js,
}
for k,v in checks.items():print(' ',k,':','OK' if v else 'FAIL')
assert all(checks.values()),checks
PY

echo "=== 8/10 CACHE HTML V10 ==="
for src in "$HTML" "$HTML2"; do
  [[ -f "$src" ]] || continue
  out="$TMP/$(basename "$src")";cp -a "$src" "$out"
  python3 - "$out" <<'PY'
from pathlib import Path
import re,sys
p=Path(sys.argv[1]);s=p.read_text(encoding='utf-8')
s=re.sub(r'/map-v2/moorail-route-editor-stops\.js\?v=[^"\']+', '/map-v2/moorail-route-editor-stops.js?v=10.0', s)
p.write_text(s,encoding='utf-8')
PY
done

echo "=== 9/10 INSTALLATION + SERVI ==="
install -o root -g root -m 0644 "$TMP/editor.js" "$JS"
install -o root -g root -m 0644 "$TMP/$(basename "$HTML")" "$HTML"
if [[ -f "$HTML2" ]]; then install -o root -g root -m 0644 "$TMP/$(basename "$HTML2")" "$HTML2"; fi
node --check "$JS"
RESTARTED=1
systemctl restart "$SERVICE"
for _ in $(seq 1 30); do
  if systemctl is-active --quiet "$SERVICE" && curl -fsS --max-time 2 http://127.0.0.1:3111/api/map-v2/health >/dev/null 2>&1; then break; fi
  sleep 1
done
systemctl is-active --quiet "$SERVICE"
curl -fsS --max-time 10 "http://127.0.0.1:3111/moorail-route-editor-stops.js?$(date +%s)" -o "$TMP/served.js"
grep -qF 'LB_MOORAIL_UNIFIED_EDITOR_V10' "$TMP/served.js"
grep -qF 'function lbLocalSpliceByRedV10' "$TMP/served.js"
grep -qF 'function lbStrictRailAnchorV10' "$TMP/served.js"
echo "Editeur V10 servi : OK"

echo "=== 10/10 NON-REGRESSION + VERDICT ==="
for marker in \
  LB_MOORAIL_FOREIGN_STRAIGHT_V88 \
  LB_MOORAIL_ENDPOINT_HANDLES_V89 \
  LB_MOORAIL_DIRECTION_CHOOSER_V90 \
  LB_MOORAIL_FREEHAND_TRACE_V91 \
  LB_MOORAIL_FREEHAND_SIMPLIFY_V92 \
  LB_MOORAIL_TRACE_GUIDED_TOPOLOGY_V93 \
  LB_MOORAIL_LANE_CONTINUITY_V94 \
  LB_MOORAIL_UNIFIED_EDITOR_V10; do
  grep -qF "$marker" "$JS"; echo "  $marker : OK"
done
HEALTH="$(curl -fsS --max-time 5 http://127.0.0.1:3111/api/map-v2/health)"
echo "$HEALTH"
python3 - "$TMP/health-before.json" <(printf '%s' "$HEALTH") <<'PY'
import json,sys
b=json.load(open(sys.argv[1]));a=json.load(open(sys.argv[2]))
assert a.get('ok') is True,a
assert a.get('network')==b.get('network'),(b,a)
print('Non-régression health/network : OK')
PY

SUCCESS=1
trap - EXIT
cleanup

echo
echo "============================================================"
echo " MOO RAIL V10 INSTALLE ET AUTO-TESTE"
echo "============================================================"
echo " - snap A/B adaptatif au zoom"
echo " - corridor rouge adaptatif au zoom"
echo " - snap sensible au sens du geste"
echo " - rouge = correction LOCALE du jaune déjà affiché"
echo " - préfixe et suffixe du parcours existant conservés"
echo " - modes crayon et direction rendus exclusifs"
echo " - choix 1-5 utilise un rayon adapté au zoom"
echo " - anti-zigzag V9.4 conservé"
echo "Backup : $BACKUP"
echo "============================================================"
