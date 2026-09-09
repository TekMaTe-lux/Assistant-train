#!/usr/bin/env bash
set -euo pipefail

ROOT="${MOORAIL_ROOT:-/opt/labetaillere-map-v2-src/map-v2}"
PUBLIC="$ROOT/public"
JS="$PUBLIC/moorail-route-editor-stops.js"
HTML="$PUBLIC/moorail-route-editor.html"
HTML2="$PUBLIC/moorail-route-editor-stops.html"
SERVICE="labetaillere-map-v2.service"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$ROOT/backups/moorail-v8_9-endpoint-handles-$STAMP"
TMP="$(mktemp -d /tmp/moorail-v89.XXXXXX)"
SUCCESS=0
RESTARTED=0

cleanup(){ rm -rf "$TMP"; }
rollback(){
  [[ "$SUCCESS" == 1 ]] && return 0
  echo "ROLLBACK MOO RAIL V8.9..." >&2
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
echo " MOO RAIL V8.9 — POIGNEES DE SORTIE / ENTREE DE GARE"
echo "============================================================"
echo "But : les points A/B restent les gares fixes, mais tu peux désormais"
echo "forcer EXACTEMENT la voie de sortie A et la voie d'entrée B."
echo

echo "=== 0/7 PRE-FLIGHT ==="
systemctl is-active --quiet "$SERVICE"
curl -fsS --max-time 5 http://127.0.0.1:3111/api/map-v2/health > "$TMP/health-before.json"
python3 - "$TMP/health-before.json" <<'PY'
import json,sys
h=json.load(open(sys.argv[1]));assert h.get('ok') is True,h
print('Health :',h)
PY
grep -qF 'LB_MOORAIL_VALIDATED_SECTIONS_V8' "$JS"
grep -qF 'LB_MOORAIL_EDITOR_SAVE_V84' "$JS"
grep -qF 'LB_MOORAIL_LGV_ROUTER_V6' "$JS"
grep -qF 'LB_MOORAIL_FOREIGN_STRAIGHT_V88' "$JS"
node --check "$JS"
if grep -qF 'LB_MOORAIL_ENDPOINT_HANDLES_V89' "$JS"; then
  echo "ERREUR: V8.9 déjà présente" >&2
  exit 4
fi

echo "=== 1/7 BACKUP ==="
mkdir -p "$BACKUP"
cp -a "$JS" "$BACKUP/moorail-route-editor-stops.js"
cp -a "$HTML" "$BACKUP/moorail-route-editor.html"
[[ -f "$HTML2" ]] && cp -a "$HTML2" "$BACKUP/moorail-route-editor-stops.html" || true
echo "Backup : $BACKUP"

echo "=== 2/7 PATCH INTERFACE : SORTIE A / ENTREE B ==="
for src in "$HTML" "$HTML2"; do
  [[ -f "$src" ]] || continue
  out="$TMP/$(basename "$src")"
  cp -a "$src" "$out"
  python3 - "$out" <<'PY'
from pathlib import Path
import re,sys
p=Path(sys.argv[1]);s=p.read_text(encoding='utf-8')
if 'id="forceA"' not in s:
    pat=re.compile(r'(<button\s+id="reset"[^>]*>.*?</button>)',re.S)
    repl=r'''\1
      <button id="forceA" class="btn warn">🎯 Sortie A</button>
      <button id="forceB" class="btn warn">🎯 Entrée B</button>
      <button id="resetEnds" class="btn warn">↺ Accroches auto</button>'''
    s,n=pat.subn(repl,s,count=1)
    if n!=1:raise SystemExit('ERREUR bouton reset introuvable dans '+str(p))

# Aide explicite : le tracé jaune n'est pas une Bézier libre ; les poignées A/B
# servent précisément aux bouts qui restaient collés à une mauvaise voie.
needle='Clique sur la carte pour forcer un passage. Glisse un point jaune pour le déplacer. Clic droit dessus pour le supprimer.'
repl='Clique sur la carte pour forcer un passage. Glisse un point jaune pour le déplacer. <b>Si un bout reste collé près d’une gare, utilise Sortie A ou Entrée B puis clique exactement sur la bonne voie.</b> Clic droit sur un point pour le supprimer.'
s=s.replace(needle,repl)

# Style des poignées de voie.
if '.endpoint-handle-v89{' not in s:
    css='.endpoint-handle-v89{width:28px;height:28px;border-radius:8px;background:#ff8a2b;color:#07131c;font-weight:950;display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 0 14px #ff8a2bbb;font-size:10px}'
    s=s.replace('</style>',css+'</style>',1)

s=re.sub(r'/map-v2/moorail-route-editor-stops\.js\?v=[^"\']+', '/map-v2/moorail-route-editor-stops.js?v=8.9', s)
p.write_text(s,encoding='utf-8')
PY
done

grep -qF 'id="forceA"' "$TMP/$(basename "$HTML")"
grep -qF 'id="forceB"' "$TMP/$(basename "$HTML")"
grep -qF 'id="resetEnds"' "$TMP/$(basename "$HTML")"

echo "=== 3/7 PATCH MOTEUR : ANCRAGE STRICT DES EXTREMITES ==="
cp -a "$JS" "$TMP/editor.js"
python3 - "$TMP/editor.js" <<'PY'
from pathlib import Path
import re,sys
p=Path(sys.argv[1]);s=p.read_text(encoding='utf-8')
marker='/* LB_MOORAIL_ENDPOINT_HANDLES_V89 */'
if marker in s:raise SystemExit('V8.9 déjà présente')

# Etat additionnel sans toucher au gros objet state historique.
anchor='const map=L.map('
pos=s.find(anchor)
if pos<0:raise SystemExit('ERREUR ancre const map absente')
state_add=marker+r'''
state.endpointOverrides={A:null,B:null};
state.endpointMarkers=[];
state.endpointMode=null;
'''
s=s[:pos]+state_add+'\n'+s[pos:]

# Les nouveaux boutons changent le prochain clic carte en sélection de la voie
# de départ/arrivée. Un clic normal continue de créer un via.
old="$('validate').onclick=validateLeg;"
new="""$('validate').onclick=validateLeg;
if($('forceA'))$('forceA').onclick=()=>lbSetEndpointModeV89('A');
if($('forceB'))$('forceB').onclick=()=>lbSetEndpointModeV89('B');
if($('resetEnds'))$('resetEnds').onclick=()=>lbResetEndpointOverridesV89();"""
if old not in s:raise SystemExit('ERREUR ancre validate onclick absente')
s=s.replace(old,new,1)

old="map.on('click',e=>addVia(e.latlng));"
new="map.on('click',e=>{if(state.endpointMode)lbSetEndpointOverrideV89(state.endpointMode,e.latlng);else addVia(e.latlng);});"
if old not in s:raise SystemExit('ERREUR ancre map click absente')
s=s.replace(old,new,1)

# Recharge les accroches A/B sauvegardées avec la section.
pat=re.compile(r"(const saved=state\.serverState\.sections\?\.\[sec\.id\];\n)(\s*state\.via=\(saved\?\.waypoints\|\|\[\]\)\.map\(p=>\(\{lat:\+p\.lat,lon:\+p\.lon\}\)\)\.filter\(p=>Number\.isFinite\(p\.lat\)&&Number\.isFinite\(p\.lon\)\);)")
m=pat.search(s)
if not m:raise SystemExit('ERREUR ancre saved/waypoints absente')
insert=m.group(1)+"""  const savedEnds=saved?.endpointOverrides||{};
  const cleanEnd=v=>v&&Number.isFinite(+v.lat)&&Number.isFinite(+v.lon)?{lat:+v.lat,lon:+v.lon}:null;
  state.endpointOverrides={A:cleanEnd(savedEnds.A),B:cleanEnd(savedEnds.B)};
  state.endpointMode=null;
"""+m.group(2)
s=s[:m.start()]+insert+s[m.end():]

# Nettoyage visuel des poignées lors d'un changement de brique.
old="for(const m of state.viaMarkers)map.removeLayer(m);state.viaMarkers=[];"
new="""for(const m of state.viaMarkers)map.removeLayer(m);state.viaMarkers=[];
  for(const m of state.endpointMarkers||[])map.removeLayer(m);state.endpointMarkers=[];state.endpointMode=null;"""
if old not in s:raise SystemExit('ERREUR ancre clearMapWork viaMarkers absente')
s=s.replace(old,new,1)

# Helpers : un endpoint forcé n'utilise qu'UN segment RFN, contrairement à
# anchorAt(stop) qui considère volontairement plusieurs voies autour d'une gare.
helper=r'''
function lbStrictRailAnchorV89(latlng){
  if(!state.graph||!state.segments?.size)return null;
  let best=null;
  for(const seg of state.segments.values()){
    const q=projectToSeg(latlng,seg);
    if(!best||q.d<best.d)best={seg,...q};
  }
  if(!best||best.d>120)return null;
  const seg=best.seg,base=(seg.cost||seg.w||distanceLL(seg.a,seg.b));
  return {
    lat:best.p[1],lon:best.p[0],railLat:best.p[1],railLon:best.p[0],
    nearestSeg:seg.id,strict:true,
    links:[
      {node:seg.aKey,cost:base*best.t+best.d},
      {node:seg.bKey,cost:base*(1-best.t)+best.d}
    ]
  };
}
function lbEndpointAnchorV89(stop,which){
  const ov=state.endpointOverrides?.[which];
  if(!ov)return anchorAt(L.latLng(+stop.lat,+stop.lon),'stop');
  const strict=lbStrictRailAnchorV89(L.latLng(+ov.lat,+ov.lon));
  if(!strict)return anchorAt(L.latLng(+stop.lat,+stop.lon),'stop');
  // La géométrie reste bien attachée à la vraie gare ; seuls les liens dans
  // le graphe sont imposés sur la voie choisie par l'utilisateur.
  return {...strict,lat:+stop.lat,lon:+stop.lon,forcedRailLat:strict.railLat,forcedRailLon:strict.railLon};
}
function lbSetEndpointModeV89(which){
  const p=stopPair();if(!p)return;
  if(typeof lbForeignProxyPairV88==='function'&&lbForeignProxyPairV88(p)){
    setStatus('Cette brique utilise déjà un proxy frontière droit : aucune accroche RFN à régler.','warn');return;
  }
  if(!state.graph){setStatus('Le RFN n’est pas encore chargé pour cette brique.','bad');return;}
  state.endpointMode=which;
  setStatus(which==='A'
    ? '🎯 SORTIE A : clique maintenant exactement sur la voie qui doit être empruntée en quittant la gare A.'
    : '🎯 ENTRÉE B : clique maintenant exactement sur la voie qui doit être empruntée avant la gare B.','warn');
}
function lbSetEndpointOverrideV89(which,latlng){
  const x=lbStrictRailAnchorV89(latlng);
  if(!x){setStatus('Aucune voie RFN à moins de 120 m de ce clic. Zoome et clique sur la voie exacte.','bad');return;}
  state.endpointOverrides[which]={lat:x.railLat,lon:x.railLon};
  state.endpointMode=null;
  lbRenderEndpointHandlesV89();recompute();
  setStatus(`✓ Accroche ${which} forcée sur la voie choisie. Tu peux glisser la poignée orange pour l'affiner.`,'ok');
}
function lbResetEndpointOverridesV89(){
  state.endpointOverrides={A:null,B:null};state.endpointMode=null;
  lbRenderEndpointHandlesV89();recompute();
  setStatus('Accroches A/B remises en automatique.','warn');
}
function lbRenderEndpointHandlesV89(){
  for(const m of state.endpointMarkers||[])map.removeLayer(m);state.endpointMarkers=[];
  if(!state.graph)return;
  for(const which of ['A','B']){
    const ov=state.endpointOverrides?.[which];if(!ov)continue;
    const m=L.marker([ov.lat,ov.lon],{
      pane:'markers',draggable:true,
      icon:L.divIcon({className:'',html:`<div class="endpoint-handle-v89">${which}↯</div>`,iconSize:[28,28],iconAnchor:[14,14]})
    }).addTo(map);
    m.bindTooltip(which==='A'?'Sortie de gare A forcée':'Entrée de gare B forcée',{direction:'top'});
    m.on('dragend',()=>{
      const x=lbStrictRailAnchorV89(m.getLatLng());
      if(!x){m.setLatLng([ov.lat,ov.lon]);setStatus('Poignée trop loin d’une voie RFN.','bad');return;}
      state.endpointOverrides[which]={lat:x.railLat,lon:x.railLon};
      lbRenderEndpointHandlesV89();recompute();
    });
    m.on('contextmenu',()=>{
      state.endpointOverrides[which]=null;lbRenderEndpointHandlesV89();recompute();
    });
    state.endpointMarkers.push(m);
  }
}
'''
anchor='function renderFixed(){'
pos=s.find(anchor)
if pos<0:raise SystemExit('ERREUR ancre renderFixed absente')
s=s[:pos]+helper+'\n'+s[pos:]

# Chaque renderVia rafraîchit aussi les poignées A/B.
old='}el.viaCount.textContent=state.via.length;\n}'
new='}el.viaCount.textContent=state.via.length;lbRenderEndpointHandlesV89();\n}'
if old not in s:raise SystemExit('ERREUR ancre fin renderVia absente')
s=s.replace(old,new,1)

# Remplace uniquement la sélection automatique A/B par une sélection pouvant
# utiliser une accroche stricte. Les vias intermédiaires restent inchangés.
old="const anchors=[];const A=anchorAt(L.latLng(+p[0].lat,+p[0].lon),'stop'),B=anchorAt(L.latLng(+p[1].lat,+p[1].lon),'stop');if(!A||!B){setStatus('Impossible d’accrocher une gare au RFN détaillé.','bad');return;}"
new="const anchors=[];const A=lbEndpointAnchorV89(p[0],'A'),B=lbEndpointAnchorV89(p[1],'B');if(!A||!B){setStatus('Impossible d’accrocher une gare au RFN détaillé.','bad');return;}"
if old not in s:raise SystemExit('ERREUR ancre A/B recompute absente')
s=s.replace(old,new,1)

# Persistance avec la brique : les réglages A/B sont retrouvés en rouvrant.
old="waypoints:state.via.map(x=>({lat:x.lat,lon:x.lon})),coordinates:state.routeCoords,"
new="waypoints:state.via.map(x=>({lat:x.lat,lon:x.lon})),endpointOverrides:{A:state.endpointOverrides?.A||null,B:state.endpointOverrides?.B||null},coordinates:state.routeCoords,"
if old not in s:raise SystemExit('ERREUR ancre payload waypoints absente')
s=s.replace(old,new,1)

p.write_text(s,encoding='utf-8')
print('Patch moteur V8.9 préparé')
PY

node --check "$TMP/editor.js"
grep -qF 'LB_MOORAIL_ENDPOINT_HANDLES_V89' "$TMP/editor.js"
grep -qF 'lbStrictRailAnchorV89' "$TMP/editor.js"
grep -qF 'endpointOverrides' "$TMP/editor.js"

echo "=== 4/7 CONTROLES STRUCTURELS ==="
python3 - "$TMP/editor.js" "$TMP/$(basename "$HTML")" <<'PY'
from pathlib import Path
import sys
js=Path(sys.argv[1]).read_text(encoding='utf-8')
html=Path(sys.argv[2]).read_text(encoding='utf-8')
checks={
 'marker':js.count('LB_MOORAIL_ENDPOINT_HANDLES_V89')==1,
 'strict-anchor':'function lbStrictRailAnchorV89' in js,
 'A-mode':"lbSetEndpointModeV89('A')" in js,
 'B-mode':"lbSetEndpointModeV89('B')" in js,
 'persist':'endpointOverrides:{A:' in js,
 'button-A':'id="forceA"' in html,
 'button-B':'id="forceB"' in html,
 'button-reset':'id="resetEnds"' in html,
}
for k,v in checks.items():print(' ',k,':','OK' if v else 'FAIL')
assert all(checks.values()),checks
PY

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
curl -fsS --max-time 10 "http://127.0.0.1:3111/moorail-route-editor.html?$(date +%s)" -o "$TMP/served.html"
grep -qF 'LB_MOORAIL_ENDPOINT_HANDLES_V89' "$TMP/served.js"
grep -qF 'id="forceA"' "$TMP/served.html"
grep -qF 'id="forceB"' "$TMP/served.html"
echo "Editeur V8.9 servi : OK"

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
echo " MOO RAIL V8.9 INSTALLE ET VALIDE"
echo "============================================================"
echo " - Sortie A : impose le segment RFN exact au départ"
echo " - Entrée B : impose le segment RFN exact à l'arrivée"
echo " - poignées orange déplaçables et persistantes"
echo " - clic droit sur une poignée = retour auto pour ce côté"
echo " - les vias jaunes intermédiaires continuent de fonctionner"
echo " - les proxies étrangers V8.8 restent inchangés"
echo "Backup : $BACKUP"
echo "============================================================"
