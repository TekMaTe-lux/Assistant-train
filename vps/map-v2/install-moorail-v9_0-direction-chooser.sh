#!/usr/bin/env bash
set -euo pipefail

ROOT="${MOORAIL_ROOT:-/opt/labetaillere-map-v2-src/map-v2}"
PUBLIC="$ROOT/public"
JS="$PUBLIC/moorail-route-editor-stops.js"
HTML="$PUBLIC/moorail-route-editor.html"
HTML2="$PUBLIC/moorail-route-editor-stops.html"
SERVICE="labetaillere-map-v2.service"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$ROOT/backups/moorail-v9_0-direction-chooser-$STAMP"
TMP="$(mktemp -d /tmp/moorail-v90.XXXXXX)"
SUCCESS=0
RESTARTED=0

cleanup(){ rm -rf "$TMP"; }
rollback(){
  [[ "$SUCCESS" == 1 ]] && return 0
  echo "ROLLBACK MOO RAIL V9.0..." >&2
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
echo " MOO RAIL V9.0 — CHOIX VISUEL DE LA DIRECTION"
echo "============================================================"
echo "Au lieu de viser une voie minuscule dans un faisceau de gare,"
echo "Sortie A / Entrée B proposent maintenant plusieurs PARCOURS complets"
echo "numérotés. Tu cliques simplement sur celui qui part du bon côté."
echo

echo "=== 0/7 PRE-FLIGHT ==="
systemctl is-active --quiet "$SERVICE"
curl -fsS --max-time 5 http://127.0.0.1:3111/api/map-v2/health > "$TMP/health-before.json"
python3 - "$TMP/health-before.json" <<'PY'
import json,sys
h=json.load(open(sys.argv[1]));assert h.get('ok') is True,h
print('Health :',h)
PY
grep -qF 'LB_MOORAIL_ENDPOINT_HANDLES_V89' "$JS"
grep -qF 'LB_MOORAIL_FOREIGN_STRAIGHT_V88' "$JS"
grep -qF 'function lbSetEndpointModeV89(which)' "$JS"
grep -qF "map.on('click',e=>{if(state.endpointMode)lbSetEndpointOverrideV89(state.endpointMode,e.latlng);else addVia(e.latlng);});" "$JS"
node --check "$JS"
if grep -qF 'LB_MOORAIL_DIRECTION_CHOOSER_V90' "$JS"; then
  echo "ERREUR: V9.0 déjà présente" >&2
  exit 4
fi

echo "=== 1/7 BACKUP ==="
mkdir -p "$BACKUP"
cp -a "$JS" "$BACKUP/moorail-route-editor-stops.js"
cp -a "$HTML" "$BACKUP/moorail-route-editor.html"
[[ -f "$HTML2" ]] && cp -a "$HTML2" "$BACKUP/moorail-route-editor-stops.html" || true
echo "Backup : $BACKUP"

echo "=== 2/7 PATCH MOTEUR : ALTERNATIVES COMPLETES DE DIRECTION ==="
cp -a "$JS" "$TMP/editor.js"
python3 - "$TMP/editor.js" <<'PY'
from pathlib import Path
import re,sys
p=Path(sys.argv[1]);s=p.read_text(encoding='utf-8')
marker='/* LB_MOORAIL_DIRECTION_CHOOSER_V90 */'
if marker in s:raise SystemExit('V9.0 déjà présente')

# La persistance V8.9 ne conservait que lat/lon. V9.0 garde aussi l'identifiant
# exact du segment choisi afin de ne pas resnapper sur une voie parallèle.
old="const cleanEnd=v=>v&&Number.isFinite(+v.lat)&&Number.isFinite(+v.lon)?{lat:+v.lat,lon:+v.lon}:null;"
new="const cleanEnd=v=>v&&Number.isFinite(+v.lat)&&Number.isFinite(+v.lon)?{lat:+v.lat,lon:+v.lon,segmentId:v.segmentId||null}:null;"
if old not in s:raise SystemExit('ERREUR ancre cleanEnd V8.9 absente')
s=s.replace(old,new,1)

# Le clic précis et le drag d'une poignée mémorisent désormais le segment exact.
old_assign="state.endpointOverrides[which]={lat:x.railLat,lon:x.railLon};"
count=s.count(old_assign)
if count < 2:raise SystemExit(f'ERREUR assign endpointOverrides inattendu: {count}')
s=s.replace(old_assign,"state.endpointOverrides[which]={lat:x.railLat,lon:x.railLon,segmentId:x.nearestSeg||null};")

# Si un segmentId est mémorisé, il gagne sur la recherche du segment le plus proche.
old="const strict=lbStrictRailAnchorV89(L.latLng(+ov.lat,+ov.lon));"
new="const strict=lbStrictRailAnchorForOverrideV90(ov);"
if old not in s:raise SystemExit('ERREUR ancre strict override V8.9 absente')
s=s.replace(old,new,1)

# En mode choix visuel, un clic perdu sur la carte ne doit surtout pas ajouter un via.
old="map.on('click',e=>{if(state.endpointMode)lbSetEndpointOverrideV89(state.endpointMode,e.latlng);else addVia(e.latlng);});"
new="map.on('click',e=>{if(state.directionChoiceWhichV90){setStatus('Choisis une des directions numérotées sur la carte. Reclique Sortie A / Entrée B pour revenir au clic précis.','warn');return;}if(state.endpointMode)lbSetEndpointOverrideV89(state.endpointMode,e.latlng);else addVia(e.latlng);});"
if old not in s:raise SystemExit('ERREUR ancre map click V8.9 absente')
s=s.replace(old,new,1)

# Nettoyage des alternatives au changement de brique.
old="function clearMapWork(){"
new="function clearMapWork(){\n  if(typeof lbClearDirectionChoicesV90==='function')lbClearDirectionChoicesV90();"
if old not in s:raise SystemExit('ERREUR ancre clearMapWork absente')
s=s.replace(old,new,1)

helper=marker+r'''
state.directionChoiceLayersV90=[];
state.directionChoiceWhichV90=null;
state.directionChoiceDataV90=[];

function lbClearDirectionChoicesV90(){
  for(const l of state.directionChoiceLayersV90||[]){try{map.removeLayer(l)}catch(_){}}
  state.directionChoiceLayersV90=[];
  state.directionChoiceDataV90=[];
  state.directionChoiceWhichV90=null;
}
function lbStrictRailAnchorForOverrideV90(ov){
  if(ov?.segmentId&&state.segments?.has(ov.segmentId)){
    const seg=state.segments.get(ov.segmentId);
    const q=projectToSeg(L.latLng(+ov.lat,+ov.lon),seg);
    const base=(seg.cost||seg.w||distanceLL(seg.a,seg.b));
    return {
      lat:q.p[1],lon:q.p[0],railLat:q.p[1],railLon:q.p[0],nearestSeg:seg.id,strict:true,
      links:[
        {node:seg.aKey,cost:base*q.t+q.d},
        {node:seg.bKey,cost:base*(1-q.t)+q.d}
      ]
    };
  }
  return lbStrictRailAnchorV89(L.latLng(+ov.lat,+ov.lon));
}
function lbCandidateAnchorV90(stop,c){
  const seg=c.seg,q=c.q,base=(seg.cost||seg.w||distanceLL(seg.a,seg.b));
  return {
    lat:+stop.lat,lon:+stop.lon,railLat:q.p[1],railLon:q.p[0],nearestSeg:seg.id,strict:true,
    links:[
      {node:seg.aKey,cost:base*q.t+q.d},
      {node:seg.bKey,cost:base*(1-q.t)+q.d}
    ]
  };
}
function lbBuildWholeRouteV90(which,c){
  const p=stopPair();if(!p||!state.graph)return null;
  const A=which==='A'?lbCandidateAnchorV90(p[0],c):lbEndpointAnchorV89(p[0],'A');
  const B=which==='B'?lbCandidateAnchorV90(p[1],c):lbEndpointAnchorV89(p[1],'B');
  if(!A||!B)return null;
  const anchors=[A];
  for(const v of state.via){const x=anchorAt(L.latLng(v.lat,v.lon),'via');if(x)anchors.push(x);}
  anchors.push(B);
  let all=[];
  for(let i=0;i<anchors.length-1;i++){
    const part=routeAnchors(anchors[i],anchors[i+1]);
    if(!part)return null;
    if(all.length&&distanceLL(all.at(-1),part[0])<5)part.shift();
    all.push(...part);
  }
  if(all.length<2)return null;
  let km=0;for(let i=1;i<all.length;i++)km+=distanceLL(all[i-1],all[i])/1000;
  return {coords:all,km,A,B};
}
function lbChoiceSignatureV90(coords,which){
  const arr=which==='A'?coords:[...coords].reverse();
  let travelled=0,next=350,out=[];
  for(let i=1;i<arr.length&&travelled<5000;i++){
    travelled+=distanceLL(arr[i-1],arr[i]);
    if(travelled>=next){out.push(`${arr[i][0].toFixed(3)},${arr[i][1].toFixed(3)}`);next+=650;}
  }
  return out.join('|');
}
function lbChoiceLabelPointV90(coords,which){
  const arr=which==='A'?coords:[...coords].reverse();
  let travelled=0;
  for(let i=1;i<arr.length;i++){
    travelled+=distanceLL(arr[i-1],arr[i]);
    if(travelled>=1400)return arr[i];
  }
  return arr[Math.min(arr.length-1,Math.max(1,Math.floor(arr.length/3)))];
}
function lbShowDirectionChoicesV90(which){
  const p=stopPair();if(!p||!state.graph)return false;
  if(typeof lbForeignProxyPairV88==='function'&&lbForeignProxyPairV88(p))return false;

  // Deuxième clic sur le même bouton = ancien mode précis V8.9.
  if(state.directionChoiceWhichV90===which&&(state.directionChoiceLayersV90||[]).length){
    lbClearDirectionChoicesV90();
    return false;
  }
  lbClearDirectionChoicesV90();
  state.endpointMode=null;

  const stop=which==='A'?p[0]:p[1];
  const ll=L.latLng(+stop.lat,+stop.lon),raw=[];
  for(const seg of state.segments.values()){
    const q=projectToSeg(ll,seg);
    if(q.d<=900)raw.push({seg,q});
  }
  raw.sort((a,b)=>a.q.d-b.q.d);

  const trials=[];
  for(const c of raw.slice(0,42)){
    const route=lbBuildWholeRouteV90(which,c);if(!route)continue;
    const sig=lbChoiceSignatureV90(route.coords,which);if(!sig)continue;
    trials.push({...c,...route,sig});
  }
  trials.sort((a,b)=>a.km-b.km);

  const unique=[];
  const seen=new Set();
  for(const c of trials){
    if(seen.has(c.sig))continue;
    seen.add(c.sig);unique.push(c);
    if(unique.length>=5)break;
  }
  if(unique.length<2){
    lbClearDirectionChoicesV90();
    return false;
  }

  state.directionChoiceWhichV90=which;
  state.directionChoiceDataV90=unique;
  const palette=['#58f0ff','#ffb347','#ff79cf','#9cff72','#c9a7ff'];

  unique.forEach((c,i)=>{
    const color=palette[i%palette.length];
    const line=L.polyline(c.coords.map(x=>[x[1],x[0]]),{
      pane:'route',color,weight:i===0?8:6,opacity:i===0?.72:.55,interactive:true
    }).addTo(map);
    const lp=lbChoiceLabelPointV90(c.coords,which);
    const marker=L.marker([lp[1],lp[0]],{
      pane:'markers',
      icon:L.divIcon({className:'',html:`<div style="width:30px;height:30px;border-radius:50%;background:${color};border:3px solid #fff;color:#061018;font-weight:950;display:flex;align-items:center;justify-content:center;box-shadow:0 0 14px #000a">${i+1}${i===0?'★':''}</div>`,iconSize:[34,34],iconAnchor:[17,17]})
    }).addTo(map);
    const title=`Option ${i+1}${i===0?' · plus courte':''} · ${c.km.toFixed(1)} km`;
    line.bindTooltip(title,{sticky:true});marker.bindTooltip(title,{direction:'top'});
    const choose=e=>{
      try{if(e?.originalEvent)L.DomEvent.stopPropagation(e.originalEvent)}catch(_){ }
      const chosen={lat:c.q.p[1],lon:c.q.p[0],segmentId:c.seg.id};
      lbClearDirectionChoicesV90();
      state.endpointOverrides[which]=chosen;
      state.endpointMode=null;
      lbRenderEndpointHandlesV89();recompute();
      setStatus(`✓ Direction ${which} choisie : option ${i+1}. Le segment exact est mémorisé. Si le trajet est bon, valide la brique V8.`,'ok');
    };
    line.on('click',choose);marker.on('click',choose);
    state.directionChoiceLayersV90.push(line,marker);
  });

  map.panTo([+stop.lat,+stop.lon]);
  setStatus(`🧭 ${which==='A'?'SORTIE A':'ENTRÉE B'} : ${unique.length} directions possibles sont affichées en couleur. Clique directement sur le PARCOURS 1–${unique.length} qui part du bon côté. ★ = plus court, pas forcément le bon. Reclique le bouton pour le mode précis.`,'warn');
  return true;
}
'''

anchor='function lbSetEndpointModeV89(which){'
pos=s.find(anchor)
if pos<0:raise SystemExit('ERREUR ancre lbSetEndpointModeV89 absente')
s=s[:pos]+helper+'\n'+s[pos:]

# Premier clic = choix visuel. Si le helper renvoie false (pas assez de variantes,
# ou deuxième clic), le comportement précis V8.9 reste disponible.
old='function lbSetEndpointModeV89(which){\n  const p=stopPair();if(!p)return;'
new="function lbSetEndpointModeV89(which){\n  if(typeof lbShowDirectionChoicesV90==='function'&&lbShowDirectionChoicesV90(which))return;\n  const p=stopPair();if(!p)return;"
if old not in s:raise SystemExit('ERREUR corps lbSetEndpointModeV89 inattendu')
s=s.replace(old,new,1)

p.write_text(s,encoding='utf-8')
print('Patch V9.0 préparé')
PY

node --check "$TMP/editor.js"

echo "=== 3/7 CONTROLES STRUCTURELS ==="
python3 - "$TMP/editor.js" <<'PY'
from pathlib import Path
import sys
s=Path(sys.argv[1]).read_text(encoding='utf-8')
checks={
 'marker':s.count('LB_MOORAIL_DIRECTION_CHOOSER_V90')==1,
 'chooser':'function lbShowDirectionChoicesV90' in s,
 'whole-route':'function lbBuildWholeRouteV90' in s,
 'segment-id':'segmentId:c.seg.id' in s,
 'persist-segment':"segmentId:v.segmentId||null" in s,
 'map-guard':'state.directionChoiceWhichV90' in s,
 'fallback-precise':"lbShowDirectionChoicesV90(which))return" in s,
}
for k,v in checks.items():print(' ',k,':','OK' if v else 'FAIL')
assert all(checks.values()),checks
PY

echo "=== 4/7 CACHE V9.0 + INSTALLATION ==="
for src in "$HTML" "$HTML2"; do
  [[ -f "$src" ]] || continue
  out="$TMP/$(basename "$src")"
  cp -a "$src" "$out"
  python3 - "$out" <<'PY'
from pathlib import Path
import re,sys
p=Path(sys.argv[1]);s=p.read_text(encoding='utf-8')
s=re.sub(r'/map-v2/moorail-route-editor-stops\.js\?v=[^"\']+', '/map-v2/moorail-route-editor-stops.js?v=9.0', s)
p.write_text(s,encoding='utf-8')
PY
done
install -o root -g root -m 0644 "$TMP/editor.js" "$JS"
install -o root -g root -m 0644 "$TMP/$(basename "$HTML")" "$HTML"
if [[ -f "$HTML2" ]]; then install -o root -g root -m 0644 "$TMP/$(basename "$HTML2")" "$HTML2"; fi
node --check "$JS"

echo "=== 5/7 RESTART ==="
RESTARTED=1
systemctl restart "$SERVICE"
for _ in $(seq 1 30); do
  if systemctl is-active --quiet "$SERVICE" && curl -fsS --max-time 2 http://127.0.0.1:3111/api/map-v2/health >/dev/null 2>&1; then break; fi
  sleep 1
done
systemctl is-active --quiet "$SERVICE"

echo "=== 6/7 PRODUIT SERVI ==="
curl -fsS --max-time 10 "http://127.0.0.1:3111/moorail-route-editor-stops.js?$(date +%s)" -o "$TMP/served.js"
curl -fsS --max-time 10 "http://127.0.0.1:3111/moorail-route-editor.html?$(date +%s)" -o "$TMP/served.html"
grep -qF 'LB_MOORAIL_DIRECTION_CHOOSER_V90' "$TMP/served.js"
grep -qF 'function lbShowDirectionChoicesV90' "$TMP/served.js"
grep -qF 'id="forceA"' "$TMP/served.html"
grep -qF 'id="forceB"' "$TMP/served.html"
echo "Editeur V9.0 servi : OK"

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
echo " MOO RAIL V9.0 INSTALLE ET VALIDE"
echo "============================================================"
echo " - Sortie A / Entrée B : jusqu'à 5 parcours complets numérotés"
echo " - clic sur un parcours = direction choisie"
echo " - segment RFN exact conservé avec segmentId"
echo " - deuxième clic sur le même bouton = ancien mode précis V8.9"
echo " - aucune modification des sections déjà validées"
echo "Backup : $BACKUP"
echo "============================================================"
