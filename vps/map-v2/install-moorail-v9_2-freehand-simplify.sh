#!/usr/bin/env bash
set -euo pipefail

ROOT="${MOORAIL_ROOT:-/opt/labetaillere-map-v2-src/map-v2}"
PUBLIC="$ROOT/public"
JS="$PUBLIC/moorail-route-editor-stops.js"
HTML="$PUBLIC/moorail-route-editor.html"
HTML2="$PUBLIC/moorail-route-editor-stops.html"
SERVICE="labetaillere-map-v2.service"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$ROOT/backups/moorail-v9_2-freehand-simplify-$STAMP"
TMP="$(mktemp -d /tmp/moorail-v92.XXXXXX)"
SUCCESS=0
RESTARTED=0

cleanup(){ rm -rf "$TMP"; }
rollback(){
  [[ "$SUCCESS" == 1 ]] && return 0
  echo "ROLLBACK MOO RAIL V9.2..." >&2
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
echo " MOO RAIL V9.2 — SIMPLIFICATION DU TRACE AU CRAYON"
echo "============================================================"
echo "Le rouge reste ton intention. A la fin du dessin, MooRail :"
echo "  1) simplifie les centaines de points souris,"
echo "  2) garde seulement les changements de direction utiles,"
echo "  3) les accroche au RFN,"
echo "  4) dessine UN SEUL tracé jaune propre sur le réseau."
echo

echo "=== 0/7 PRE-FLIGHT ==="
systemctl is-active --quiet "$SERVICE"
curl -fsS --max-time 5 http://127.0.0.1:3111/api/map-v2/health > "$TMP/health-before.json"
python3 - "$TMP/health-before.json" <<'PY'
import json,sys
h=json.load(open(sys.argv[1]));assert h.get('ok') is True,h
print('Health :',h)
PY
grep -qF 'LB_MOORAIL_FREEHAND_TRACE_V91' "$JS"
grep -qF 'function lbFinishManualDrawV91()' "$JS"
grep -qF 'state.manualGuideRawV91' "$JS"
grep -qF 'function lbStrictRailAnchorV89' "$JS"
grep -qF 'const c=routeAnchors(anchors[i],anchors[i+1]);' "$JS"
node --check "$JS"
if grep -qF 'LB_MOORAIL_FREEHAND_SIMPLIFY_V92' "$JS"; then
  echo "ERREUR: V9.2 déjà présente" >&2
  exit 4
fi

echo "=== 1/7 BACKUP ==="
mkdir -p "$BACKUP"
cp -a "$JS" "$BACKUP/moorail-route-editor-stops.js"
cp -a "$HTML" "$BACKUP/moorail-route-editor.html"
[[ -f "$HTML2" ]] && cp -a "$HTML2" "$BACKUP/moorail-route-editor-stops.html" || true
echo "Backup : $BACKUP"

echo "=== 2/7 PATCH MOTEUR : RDP + SNAP RFN + UN SEUL JAUNE ==="
cp -a "$JS" "$TMP/editor.js"
python3 - "$TMP/editor.js" <<'PY'
from pathlib import Path
import re,sys
p=Path(sys.argv[1]);s=p.read_text(encoding='utf-8')
marker='/* LB_MOORAIL_FREEHAND_SIMPLIFY_V92 */'
if marker in s:raise SystemExit('V9.2 déjà présente')

helper=marker+r'''
state.manualSimplifyStatsV92=null;

function lbXYMetersV92(pt,lat0){
  const lat=+pt[0],lon=+pt[1],c=Math.cos((lat0||lat)*Math.PI/180);
  return [lon*111320*c,lat*110540];
}
function lbPointSegDistanceV92(p,a,b){
  const lat0=(+p[0]+ +a[0]+ +b[0])/3;
  const P=lbXYMetersV92(p,lat0),A=lbXYMetersV92(a,lat0),B=lbXYMetersV92(b,lat0);
  const vx=B[0]-A[0],vy=B[1]-A[1],wx=P[0]-A[0],wy=P[1]-A[1];
  const den=vx*vx+vy*vy;
  let t=den?(wx*vx+wy*vy)/den:0;t=Math.max(0,Math.min(1,t));
  const dx=P[0]-(A[0]+vx*t),dy=P[1]-(A[1]+vy*t);
  return Math.hypot(dx,dy);
}
function lbRdpV92(points,eps){
  if(!Array.isArray(points)||points.length<=2)return (points||[]).slice();
  let best=-1,idx=-1;
  const a=points[0],b=points.at(-1);
  for(let i=1;i<points.length-1;i++){
    const d=lbPointSegDistanceV92(points[i],a,b);
    if(d>best){best=d;idx=i;}
  }
  if(best>eps&&idx>0){
    const l=lbRdpV92(points.slice(0,idx+1),eps),r=lbRdpV92(points.slice(idx),eps);
    return l.slice(0,-1).concat(r);
  }
  return [a,b];
}
function lbSnapSimplifiedManualV92(points){
  const out=[];
  for(const pt of points||[]){
    const x=lbStrictRailAnchorV89(L.latLng(+pt[0],+pt[1]));
    if(!x)continue;
    const v={lat:+x.railLat,lon:+x.railLon,segmentId:x.nearestSeg||null};
    const prev=out.at(-1);
    if(prev){
      const d=distanceLL([prev.lon,prev.lat],[v.lon,v.lat]);
      // Une ligne droite dessinée le long d'un faisceau ne doit surtout pas
      // devenir 15 accroches alternant entre des voies parallèles.
      if(prev.segmentId===v.segmentId)return out.length?out:[];
      if(d<70)continue;
    }
    out.push(v);
  }
  return out;
}
function lbSimplifyManualTraceV92(){
  const raw=(state.manualGuideRawV91||[])
    .map(p=>[+p[0],+p[1]])
    .filter(p=>Number.isFinite(p[0])&&Number.isFinite(p[1]));
  if(raw.length<2)return {raw:raw.length,simplified:0,anchors:0};

  // Tolérance progressive : on cherche une poignée de points structurants,
  // pas une succession de micro-contraintes tous les 20 mètres.
  let simplified=raw.slice();
  const tolerances=[18,28,40,55,75,100];
  for(const eps of tolerances){
    simplified=lbRdpV92(raw,eps);
    if(simplified.length<=9)break;
  }

  // Si le trait est très long/complexe, on borne encore le nombre de points
  // tout en conservant toujours le premier et le dernier.
  if(simplified.length>9){
    const keep=[simplified[0]],n=simplified.length;
    for(let k=1;k<8;k++)keep.push(simplified[Math.round(k*(n-1)/8)]);
    keep.push(simplified.at(-1));
    simplified=keep;
  }

  let snapped=[];
  for(const pt of simplified){
    const x=lbStrictRailAnchorV89(L.latLng(+pt[0],+pt[1]));
    if(!x)continue;
    const v={lat:+x.railLat,lon:+x.railLon,segmentId:x.nearestSeg||null};
    const prev=snapped.at(-1);
    if(prev){
      const d=distanceLL([prev.lon,prev.lat],[v.lon,v.lat]);
      if(prev.segmentId===v.segmentId)continue;
      if(d<70)continue;
    }
    snapped.push(v);
  }

  // Les extrémités du dessin sont importantes lorsqu'on ne corrige qu'une
  // petite zone. Si la simplification a été trop agressive, on garde au moins
  // deux accroches RFN distinctes.
  if(snapped.length<2){
    snapped=[];
    for(const pt of [raw[0],raw.at(-1)]){
      const x=lbStrictRailAnchorV89(L.latLng(+pt[0],+pt[1]));
      if(x)snapped.push({lat:+x.railLat,lon:+x.railLon,segmentId:x.nearestSeg||null});
    }
  }

  state.manualTraceV91=snapped;
  state.manualSimplifyStatsV92={raw:raw.length,simplified:simplified.length,anchors:snapped.length};
  return state.manualSimplifyStatsV92;
}
'''
anchor='function lbFinishManualDrawV91(){'
pos=s.find(anchor)
if pos<0:raise SystemExit('ERREUR: lbFinishManualDrawV91 introuvable')
s=s[:pos]+helper+'\n'+s[pos:]

# Simplifie AVANT d'orienter et de recalculer.
old="""  lbOrientManualTraceV91();
  if((state.manualTraceV91||[]).length<2){"""
new="""  const lbStatsV92=lbSimplifyManualTraceV92();
  lbOrientManualTraceV91();
  if((state.manualTraceV91||[]).length<2){"""
if old not in s:raise SystemExit('ERREUR: ancre finish/orient absente')
s=s.replace(old,new,1)

old_status="setStatus(`✏️ Tracé manuel capturé : ${state.manualTraceV91.length} accroches RFN strictes. ROUGE = ce que tu as dessiné, JAUNE = le chemin recalculé. S'ils se superposent, valide la brique V8.`,'ok');"
new_status="setStatus(`✏️ Tracé simplifié : ${lbStatsV92.raw} points souris → ${lbStatsV92.simplified} points utiles → ${lbStatsV92.anchors} accroches RFN. Le JAUNE est maintenant un seul chemin propre sur le réseau.`,'ok');"
if old_status not in s:raise SystemExit('ERREUR: status V9.1 absent')
s=s.replace(old_status,new_status,1)

# En mode manuel, le moteur garde les calculs par sous-parties en interne mais
# n'affiche plus 20 micro-polylignes : il dessine UNE polyline jaune finale.
needle="""  let all=[];
  for(let i=0;i<anchors.length-1;i++){
    const c=routeAnchors(anchors[i],anchors[i+1]);if(!c){state.routeErrors++;continue;}
    if(all.length&&distanceLL(all.at(-1),c[0])<5)c.shift();all.push(...c);
    const line=L.polyline(c.map(x=>[x[1],x[0]]),{pane:'route',color:'#ffd84d',weight:5,opacity:.96}).addTo(map);state.routeLayers.push(line);
  }
  state.routeCoords=all;for(let i=1;i<all.length;i++)state.routeKm+=distanceLL(all[i-1],all[i])/1000;
  updateMetrics(anchors.length-1,state.routeKm,state.routeErrors);"""
replacement="""  const lbManualCleanV92=(state.manualTraceV91||[]).length>0;
  let all=[];
  for(let i=0;i<anchors.length-1;i++){
    const c=routeAnchors(anchors[i],anchors[i+1]);if(!c){state.routeErrors++;continue;}
    if(all.length&&distanceLL(all.at(-1),c[0])<5)c.shift();all.push(...c);
    if(!lbManualCleanV92){
      const line=L.polyline(c.map(x=>[x[1],x[0]]),{pane:'route',color:'#ffd84d',weight:5,opacity:.96}).addTo(map);state.routeLayers.push(line);
    }
  }
  if(lbManualCleanV92&&all.length>=2){
    const line=L.polyline(all.map(x=>[x[1],x[0]]),{pane:'route',color:'#ffd84d',weight:6,opacity:.98,lineJoin:'round',lineCap:'round'}).addTo(map);state.routeLayers.push(line);
  }
  state.routeCoords=all;for(let i=1;i<all.length;i++)state.routeKm+=distanceLL(all[i-1],all[i])/1000;
  updateMetrics(lbManualCleanV92?(all.length?1:0):anchors.length-1,state.routeKm,state.routeErrors);"""
if needle not in s:raise SystemExit('ERREUR: boucle recompute attendue absente')
s=s.replace(needle,replacement,1)

# Le guide rouge après relâchement utilise les points simplifiés/snappés et non
# les centaines de points de souris : visuellement lui aussi devient lisible.
old="""function lbRenderManualGuideV91(){
  if(state.manualGuideLayerV91){try{map.removeLayer(state.manualGuideLayerV91)}catch(_){ }state.manualGuideLayerV91=null;}
  const pts=(state.manualTraceV91||[]).map(x=>[+x.lat,+x.lon]).filter(x=>Number.isFinite(x[0])&&Number.isFinite(x[1]));
  if(pts.length>=2){
    state.manualGuideLayerV91=L.polyline(pts,{pane:'route',color:'#ff3b30',weight:7,opacity:.72,dashArray:'10 7',interactive:false}).addTo(map);
  }
}"""
new="""function lbRenderManualGuideV91(){
  if(state.manualGuideLayerV91){try{map.removeLayer(state.manualGuideLayerV91)}catch(_){ }state.manualGuideLayerV91=null;}
  const pts=(state.manualTraceV91||[]).map(x=>[+x.lat,+x.lon]).filter(x=>Number.isFinite(x[0])&&Number.isFinite(x[1]));
  if(pts.length>=2){
    state.manualGuideLayerV91=L.polyline(pts,{pane:'route',color:'#ff3b30',weight:3,opacity:.55,dashArray:'8 8',interactive:false}).addTo(map);
  }
}"""
if old not in s:raise SystemExit('ERREUR: render manual guide V9.1 absent')
s=s.replace(old,new,1)

p.write_text(s,encoding='utf-8')
print('Patch moteur V9.2 préparé')
PY

node --check "$TMP/editor.js"

echo "=== 3/7 CONTROLES STRUCTURELS ==="
python3 - "$TMP/editor.js" <<'PY'
from pathlib import Path
import sys
js=Path(sys.argv[1]).read_text(encoding='utf-8')
checks={
 'marker':'LB_MOORAIL_FREEHAND_SIMPLIFY_V92' in js,
 'rdp':'function lbRdpV92' in js,
 'simplifier':'function lbSimplifyManualTraceV92' in js,
 'snap':'lbStrictRailAnchorV89' in js,
 'max-anchors':'simplified.length<=9' in js,
 'single-yellow':'const lbManualCleanV92=' in js and 'lineJoin:\'round\'' in js,
 'status':'points souris →' in js,
 'v91-kept':'LB_MOORAIL_FREEHAND_TRACE_V91' in js,
}
for k,v in checks.items():print(' ',k,':','OK' if v else 'FAIL')
assert all(checks.values()),checks
PY

echo "=== 4/7 CACHE HTML V9.2 ==="
for src in "$HTML" "$HTML2"; do
  [[ -f "$src" ]] || continue
  out="$TMP/$(basename "$src")"
  cp -a "$src" "$out"
  python3 - "$out" <<'PY'
from pathlib import Path
import re,sys
p=Path(sys.argv[1]);s=p.read_text(encoding='utf-8')
s=re.sub(r'/map-v2/moorail-route-editor-stops\.js\?v=[^"\']+', '/map-v2/moorail-route-editor-stops.js?v=9.2', s)
p.write_text(s,encoding='utf-8')
PY
done

echo "=== 5/7 INSTALLATION ==="
install -o root -g root -m 0644 "$TMP/editor.js" "$JS"
install -o root -g root -m 0644 "$TMP/$(basename "$HTML")" "$HTML"
if [[ -f "$HTML2" ]]; then install -o root -g root -m 0644 "$TMP/$(basename "$HTML2")" "$HTML2"; fi
node --check "$JS"

echo "=== 6/7 RESTART + PRODUIT SERVI ==="
RESTARTED=1
systemctl restart "$SERVICE"
for _ in $(seq 1 30); do
  if systemctl is-active --quiet "$SERVICE" && curl -fsS --max-time 2 http://127.0.0.1:3111/api/map-v2/health >/dev/null 2>&1; then break; fi
  sleep 1
done
systemctl is-active --quiet "$SERVICE"
curl -fsS --max-time 10 "http://127.0.0.1:3111/moorail-route-editor-stops.js?$(date +%s)" -o "$TMP/served.js"
grep -qF 'LB_MOORAIL_FREEHAND_SIMPLIFY_V92' "$TMP/served.js"
grep -qF 'function lbSimplifyManualTraceV92' "$TMP/served.js"
echo "Editeur V9.2 servi : OK"

echo "=== 7/7 HEALTH FINAL ==="
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
echo " MOO RAIL V9.2 INSTALLE ET VALIDE"
echo "============================================================"
echo " - dessin souris simplifié automatiquement (RDP)"
echo " - maximum ~9 accroches structurantes"
echo " - accroches replacées sur le RFN"
echo " - les micro-contraintes de 20-50 m sont supprimées"
echo " - en mode manuel : UN SEUL tracé jaune propre"
echo "Backup : $BACKUP"
echo "============================================================"
