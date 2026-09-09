#!/usr/bin/env bash
set -euo pipefail

ROOT="${MOORAIL_ROOT:-/opt/labetaillere-map-v2-src/map-v2}"
PUBLIC="$ROOT/public"
JS="$PUBLIC/moorail-route-editor-stops.js"
HTML="$PUBLIC/moorail-route-editor.html"
HTML2="$PUBLIC/moorail-route-editor-stops.html"
SERVICE="labetaillere-map-v2.service"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$ROOT/backups/moorail-v9_1-freehand-$STAMP"
TMP="$(mktemp -d /tmp/moorail-v91.XXXXXX)"
SUCCESS=0
RESTARTED=0

cleanup(){ rm -rf "$TMP"; }
rollback(){
  [[ "$SUCCESS" == 1 ]] && return 0
  echo "ROLLBACK MOO RAIL V9.1..." >&2
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
echo " MOO RAIL V9.1 — TRACE LIBRE AU CRAYON"
echo "============================================================"
echo "Tu dessines avec la souris la zone que le train DOIT suivre."
echo "MooRail transforme ton trait en accroches RFN strictes et recalcule"
echo "le trajet en passant par elles dans l'ordre du dessin."
echo

echo "=== 0/8 PRE-FLIGHT ==="
systemctl is-active --quiet "$SERVICE"
curl -fsS --max-time 5 http://127.0.0.1:3111/api/map-v2/health > "$TMP/health-before.json"
python3 - "$TMP/health-before.json" <<'PY'
import json,sys
h=json.load(open(sys.argv[1])); assert h.get('ok') is True,h
print('Health :',h)
PY
grep -qF 'LB_MOORAIL_ENDPOINT_HANDLES_V89' "$JS"
grep -qF 'LB_MOORAIL_DIRECTION_CHOOSER_V90' "$JS"
grep -qF 'function lbStrictRailAnchorV89' "$JS"
grep -qF 'function routeAnchors(A,B)' "$JS"
node --check "$JS"
if grep -qF 'LB_MOORAIL_FREEHAND_TRACE_V91' "$JS"; then
  echo "ERREUR: V9.1 déjà présente" >&2
  exit 4
fi

echo "=== 1/8 BACKUP ==="
mkdir -p "$BACKUP"
cp -a "$JS" "$BACKUP/moorail-route-editor-stops.js"
cp -a "$HTML" "$BACKUP/moorail-route-editor.html"
[[ -f "$HTML2" ]] && cp -a "$HTML2" "$BACKUP/moorail-route-editor-stops.html" || true
echo "Backup : $BACKUP"

echo "=== 2/8 PATCH INTERFACE : BOUTON CRAYON ==="
for src in "$HTML" "$HTML2"; do
  [[ -f "$src" ]] || continue
  out="$TMP/$(basename "$src")"
  cp -a "$src" "$out"
  python3 - "$out" <<'PY'
from pathlib import Path
import re,sys
p=Path(sys.argv[1]);s=p.read_text(encoding='utf-8')
if 'id="manualDrawV91"' not in s:
    # Insère juste après les outils A/B existants.
    pat=re.compile(r'(<button\s+id="resetEnds"[^>]*>.*?</button>)',re.S)
    repl=r'''\1
      <button id="manualDrawV91" class="btn danger">✏️ Tracer moi-même</button>
      <button id="manualClearV91" class="btn warn">🧽 Effacer mon tracé</button>'''
    s,n=pat.subn(repl,s,count=1)
    if n!=1:raise SystemExit('ERREUR: bouton resetEnds introuvable')

if '.manual-draw-v91-active{' not in s:
    css='''
.manual-draw-v91-active{background:#ff3b30!important;color:#fff!important;border-color:#fff!important;box-shadow:0 0 16px #ff3b30aa!important}
.manual-draw-v91-note{color:#ffb7b2;font-weight:800}
'''
    s=s.replace('</style>',css+'</style>',1)

needle='Si un bout reste collé près d’une gare, utilise Sortie A ou Entrée B puis clique exactement sur la bonne voie.'
if needle in s:
    s=s.replace(needle,needle+' <span class="manual-draw-v91-note">Ou clique « Tracer moi-même » et dessine directement le chemin voulu à la souris.</span>',1)

s=re.sub(r'/map-v2/moorail-route-editor-stops\.js\?v=[^"\']+', '/map-v2/moorail-route-editor-stops.js?v=9.1', s)
p.write_text(s,encoding='utf-8')
PY
done

grep -qF 'id="manualDrawV91"' "$TMP/$(basename "$HTML")"
grep -qF 'id="manualClearV91"' "$TMP/$(basename "$HTML")"

echo "=== 3/8 PATCH MOTEUR : DESSIN LIBRE -> ACCROCHES STRICTES ==="
cp -a "$JS" "$TMP/editor.js"
python3 - "$TMP/editor.js" <<'PY'
from pathlib import Path
import re,sys
p=Path(sys.argv[1]);s=p.read_text(encoding='utf-8')
marker='/* LB_MOORAIL_FREEHAND_TRACE_V91 */'
if marker in s:raise SystemExit('V9.1 déjà présente')

# Etat V9.1 ajouté juste avant la création de la carte.
anchor='const map=L.map('
pos=s.find(anchor)
if pos<0:raise SystemExit('ERREUR: const map introuvable')
state_add=marker+r'''
state.manualDrawModeV91=false;
state.manualDrawingV91=false;
state.manualJustFinishedV91=false;
state.manualTraceV91=[];
state.manualGuideRawV91=[];
state.manualGuideLayerV91=null;
'''
s=s[:pos]+state_add+'\n'+s[pos:]

# Boutons.
needle="if($('resetEnds'))$('resetEnds').onclick=()=>lbResetEndpointOverridesV89();"
if needle not in s:raise SystemExit('ERREUR: bindings V8.9 absents')
s=s.replace(needle,needle+"\nif($('manualDrawV91'))$('manualDrawV91').onclick=()=>lbToggleManualDrawV91();\nif($('manualClearV91'))$('manualClearV91').onclick=()=>lbClearManualTraceV91(true);",1)

# Le click produit après un drag ne doit pas créer un via jaune accidentellement.
click_pat=re.compile(r"map\.on\('click',e=>\{(?P<body>.*?)\}\);",re.S)
m=click_pat.search(s)
if not m:raise SystemExit('ERREUR: handler map click introuvable')
body=m.group('body')
if 'manualJustFinishedV91' not in body:
    body="if(state.manualDrawModeV91||state.manualDrawingV91||state.manualJustFinishedV91)return;"+body
    s=s[:m.start()]+"map.on('click',e=>{"+body+"});"+s[m.end():]

helper=marker+r'''
function lbManualAnchorV91(v){
  if(!v)return null;
  if(v.segmentId&&state.segments?.has(v.segmentId)){
    const seg=state.segments.get(v.segmentId);
    const q=projectToSeg(L.latLng(+v.lat,+v.lon),seg);
    const base=(seg.cost||seg.w||distanceLL(seg.a,seg.b));
    return {
      lat:q.p[1],lon:q.p[0],railLat:q.p[1],railLon:q.p[0],nearestSeg:seg.id,strict:true,
      links:[
        {node:seg.aKey,cost:base*q.t+q.d},
        {node:seg.bKey,cost:base*(1-q.t)+q.d}
      ]
    };
  }
  return lbStrictRailAnchorV89(L.latLng(+v.lat,+v.lon));
}
function lbRenderManualGuideV91(){
  if(state.manualGuideLayerV91){try{map.removeLayer(state.manualGuideLayerV91)}catch(_){ }state.manualGuideLayerV91=null;}
  const pts=(state.manualTraceV91||[]).map(x=>[+x.lat,+x.lon]).filter(x=>Number.isFinite(x[0])&&Number.isFinite(x[1]));
  if(pts.length>=2){
    state.manualGuideLayerV91=L.polyline(pts,{pane:'route',color:'#ff3b30',weight:7,opacity:.72,dashArray:'10 7',interactive:false}).addTo(map);
  }
}
function lbClearManualTraceV91(recomputeNow=false){
  state.manualTraceV91=[];state.manualGuideRawV91=[];state.manualDrawingV91=false;state.manualDrawModeV91=false;
  if(state.manualGuideLayerV91){try{map.removeLayer(state.manualGuideLayerV91)}catch(_){ }state.manualGuideLayerV91=null;}
  try{map.dragging.enable()}catch(_){ }
  try{map.getContainer().style.cursor=''}catch(_){ }
  if($('manualDrawV91'))$('manualDrawV91').classList.remove('manual-draw-v91-active');
  if(recomputeNow){recompute();setStatus('Tracé manuel effacé. MooRail revient au calcul automatique.','warn');}
}
function lbToggleManualDrawV91(){
  const p=stopPair();if(!p||!state.graph){setStatus('Charge d’abord une brique RFN.','bad');return;}
  if(typeof lbForeignProxyPairV88==='function'&&lbForeignProxyPairV88(p)){
    setStatus('Cette brique étrangère utilise déjà le proxy droit temporaire V8.8.','warn');return;
  }
  if(state.manualDrawModeV91){
    state.manualDrawModeV91=false;state.manualDrawingV91=false;
    try{map.dragging.enable()}catch(_){ }
    try{map.getContainer().style.cursor=''}catch(_){ }
    if($('manualDrawV91'))$('manualDrawV91').classList.remove('manual-draw-v91-active');
    setStatus('Mode crayon annulé.','warn');return;
  }
  if(typeof lbClearDirectionChoicesV90==='function')lbClearDirectionChoicesV90();
  state.endpointMode=null;
  state.manualDrawModeV91=true;state.manualDrawingV91=false;
  state.manualTraceV91=[];state.manualGuideRawV91=[];
  if(state.manualGuideLayerV91){try{map.removeLayer(state.manualGuideLayerV91)}catch(_){ }state.manualGuideLayerV91=null;}
  try{map.dragging.disable()}catch(_){ }
  try{map.getContainer().style.cursor='crosshair'}catch(_){ }
  if($('manualDrawV91'))$('manualDrawV91').classList.add('manual-draw-v91-active');
  setStatus('✏️ TRACE MOI-MÊME : maintiens le clic gauche et dessine EN ROUGE le morceau de voie que le train doit suivre. Tu peux ne dessiner que la zone problématique. Relâche pour recalculer.','warn');
}
function lbCaptureManualPointV91(latlng){
  if(!latlng||!state.graph)return;
  const raw=[+latlng.lat,+latlng.lng];
  const r=state.manualGuideRawV91;
  if(!r.length||distanceLL([r.at(-1)[1],r.at(-1)[0]],[raw[1],raw[0]])>=18)r.push(raw);

  const x=lbStrictRailAnchorV89(latlng);
  if(!x)return;
  const v={lat:+x.railLat,lon:+x.railLon,segmentId:x.nearestSeg||null};
  const a=state.manualTraceV91;
  const prev=a.at(-1);
  if(prev){
    const d=distanceLL([prev.lon,prev.lat],[v.lon,v.lat]);
    if(prev.segmentId===v.segmentId&&d<55)return;
    if(d<18)return;
  }
  a.push(v);
}
function lbLiveManualGuideV91(){
  if(state.manualGuideLayerV91){try{map.removeLayer(state.manualGuideLayerV91)}catch(_){ }state.manualGuideLayerV91=null;}
  const pts=state.manualGuideRawV91||[];
  if(pts.length>=2)state.manualGuideLayerV91=L.polyline(pts,{pane:'route',color:'#ff3b30',weight:7,opacity:.9,interactive:false}).addTo(map);
}
function lbOrientManualTraceV91(){
  const p=stopPair(),a=state.manualTraceV91||[];if(!p||a.length<2)return;
  const A=[+p[0].lon,+p[0].lat],B=[+p[1].lon,+p[1].lat];
  const first=[a[0].lon,a[0].lat],last=[a.at(-1).lon,a.at(-1).lat];
  const f=distanceLL(A,first)+distanceLL(last,B);
  const r=distanceLL(A,last)+distanceLL(first,B);
  if(r<f)a.reverse();
}
function lbFinishManualDrawV91(){
  if(!state.manualDrawingV91)return;
  state.manualDrawingV91=false;state.manualDrawModeV91=false;
  try{map.dragging.enable()}catch(_){ }
  try{map.getContainer().style.cursor=''}catch(_){ }
  if($('manualDrawV91'))$('manualDrawV91').classList.remove('manual-draw-v91-active');
  state.manualJustFinishedV91=true;setTimeout(()=>{state.manualJustFinishedV91=false},180);

  lbOrientManualTraceV91();
  if((state.manualTraceV91||[]).length<2){
    setStatus('Trait trop court ou trop loin des voies RFN. Recommence en dessinant directement sur les voies cyan.','bad');
    return;
  }
  // En mode crayon, on repart d'une correction propre : les anciens vias libres
  // ne doivent pas concurrencer le trait dessiné.
  state.via=[];renderVia();lbRenderManualGuideV91();recompute();
  setStatus(`✏️ Tracé manuel capturé : ${state.manualTraceV91.length} accroches RFN strictes. ROUGE = ce que tu as dessiné, JAUNE = le chemin recalculé. S'ils se superposent, valide la brique V8.`,'ok');
}

map.on('mousedown',e=>{
  if(!state.manualDrawModeV91)return;
  try{if(e.originalEvent)L.DomEvent.stopPropagation(e.originalEvent)}catch(_){ }
  state.manualDrawingV91=true;state.manualTraceV91=[];state.manualGuideRawV91=[];
  lbCaptureManualPointV91(e.latlng);lbLiveManualGuideV91();
});
map.on('mousemove',e=>{
  if(!state.manualDrawingV91)return;
  lbCaptureManualPointV91(e.latlng);lbLiveManualGuideV91();
});
map.on('mouseup',e=>{
  if(!state.manualDrawingV91)return;
  lbCaptureManualPointV91(e.latlng);lbFinishManualDrawV91();
});
'''

anchor='function renderFixed(){'
pos=s.find(anchor)
if pos<0:raise SystemExit('ERREUR: renderFixed introuvable')
s=s[:pos]+helper+'\n'+s[pos:]

# Recharge un tracé manuel sauvegardé avec la brique active.
pat=re.compile(r'(\s*state\.via=\(saved\?\.waypoints\|\|\[\]\)\.map\([^\n]+\);)')
m=pat.search(s)
if not m:raise SystemExit('ERREUR: chargement state.via introuvable')
load_manual=m.group(1)+"\n  state.manualTraceV91=(saved?.manualTraceV91||[]).map(v=>({lat:+v.lat,lon:+v.lon,segmentId:v.segmentId||null})).filter(v=>Number.isFinite(v.lat)&&Number.isFinite(v.lon));"
s=s[:m.start()]+load_manual+s[m.end():]

# Au changement de brique, nettoie seulement l'ancien guide visuel et l'état dessin.
old='function clearMapWork(){'
if old not in s:raise SystemExit('ERREUR: clearMapWork introuvable')
new="function clearMapWork(){\n  state.manualDrawModeV91=false;state.manualDrawingV91=false;state.manualTraceV91=[];state.manualGuideRawV91=[];\n  if(state.manualGuideLayerV91){try{map.removeLayer(state.manualGuideLayerV91)}catch(_){ }state.manualGuideLayerV91=null;}\n  try{map.dragging.enable()}catch(_){ }\n  try{map.getContainer().style.cursor=''}catch(_){ }\n  if($('manualDrawV91'))$('manualDrawV91').classList.remove('manual-draw-v91-active');"
s=s.replace(old,new,1)

# Après le chargement RFN d'une brique, réaffiche son trait manuel éventuel.
old_seq='buildGraph();renderFixed();renderVia();await recompute();'
if old_seq not in s:raise SystemExit('ERREUR: séquence buildGraph/render introuvable')
s=s.replace(old_seq,'buildGraph();renderFixed();renderVia();lbRenderManualGuideV91();await recompute();',1)

# Le chemin A->B passe par toutes les accroches strictes issues du trait, dans l'ordre.
pat2=re.compile(r"anchors\.push\(A\);for\(const v of state\.via\)\{const x=anchorAt\(L\.latLng\(v\.lat,v\.lon\),'via'\);if\(x\)anchors\.push\(x\);\}anchors\.push\(B\);")
if not pat2.search(s):raise SystemExit('ERREUR: construction anchors introuvable')
repl="""anchors.push(A);
  if((state.manualTraceV91||[]).length){
    for(const v of state.manualTraceV91){const x=lbManualAnchorV91(v);if(x)anchors.push(x);}
  }else{
    for(const v of state.via){const x=anchorAt(L.latLng(v.lat,v.lon),'via');if(x)anchors.push(x);}
  }
  anchors.push(B);"""
s=pat2.sub(repl,s,count=1)

# Sauvegarde persistante du trait + segmentId exact de chaque accroche.
needle='endpointOverrides:{A:state.endpointOverrides?.A||null,B:state.endpointOverrides?.B||null},coordinates:state.routeCoords,'
if needle not in s:raise SystemExit('ERREUR: payload endpointOverrides/coordinates introuvable')
s=s.replace(needle,"endpointOverrides:{A:state.endpointOverrides?.A||null,B:state.endpointOverrides?.B||null},manualTraceV91:(state.manualTraceV91||[]).map(v=>({lat:v.lat,lon:v.lon,segmentId:v.segmentId||null})),coordinates:state.routeCoords,",1)

p.write_text(s,encoding='utf-8')
print('Patch moteur V9.1 préparé')
PY

node --check "$TMP/editor.js"

echo "=== 4/8 CONTROLES STRUCTURELS ==="
python3 - "$TMP/editor.js" "$TMP/$(basename "$HTML")" <<'PY'
from pathlib import Path
import sys
js=Path(sys.argv[1]).read_text(encoding='utf-8'); html=Path(sys.argv[2]).read_text(encoding='utf-8')
checks={
 'marker':js.count('LB_MOORAIL_FREEHAND_TRACE_V91')>=1,
 'toggle':'function lbToggleManualDrawV91' in js,
 'capture':'function lbCaptureManualPointV91' in js,
 'strict-manual':'function lbManualAnchorV91' in js,
 'mouse-down':"map.on('mousedown'" in js,
 'mouse-move':"map.on('mousemove'" in js,
 'mouse-up':"map.on('mouseup'" in js,
 'persist':'manualTraceV91:(state.manualTraceV91||[])' in js,
 'reload':'saved?.manualTraceV91' in js,
 'button-draw':'id="manualDrawV91"' in html,
 'button-clear':'id="manualClearV91"' in html,
}
for k,v in checks.items():print(' ',k,':','OK' if v else 'FAIL')
assert all(checks.values()),checks
PY

echo "=== 5/8 INSTALLATION ==="
install -o root -g root -m 0644 "$TMP/editor.js" "$JS"
install -o root -g root -m 0644 "$TMP/$(basename "$HTML")" "$HTML"
if [[ -f "$HTML2" ]]; then install -o root -g root -m 0644 "$TMP/$(basename "$HTML2")" "$HTML2"; fi
node --check "$JS"

echo "=== 6/8 RESTART + PRODUIT SERVI ==="
RESTARTED=1
systemctl restart "$SERVICE"
for _ in $(seq 1 30); do
  if systemctl is-active --quiet "$SERVICE" && curl -fsS --max-time 2 http://127.0.0.1:3111/api/map-v2/health >/dev/null 2>&1; then break; fi
  sleep 1
done
systemctl is-active --quiet "$SERVICE"
curl -fsS --max-time 10 "http://127.0.0.1:3111/moorail-route-editor-stops.js?$(date +%s)" -o "$TMP/served.js"
curl -fsS --max-time 10 "http://127.0.0.1:3111/moorail-route-editor.html?$(date +%s)" -o "$TMP/served.html"
grep -qF 'LB_MOORAIL_FREEHAND_TRACE_V91' "$TMP/served.js"
grep -qF 'id="manualDrawV91"' "$TMP/served.html"
grep -qF 'id="manualClearV91"' "$TMP/served.html"
echo "Editeur V9.1 servi : OK"

echo "=== 7/8 NON-REGRESSION V8.8/V8.9/V9.0 ==="
for marker in LB_MOORAIL_FOREIGN_STRAIGHT_V88 LB_MOORAIL_ENDPOINT_HANDLES_V89 LB_MOORAIL_DIRECTION_CHOOSER_V90; do
  grep -qF "$marker" "$JS"
  echo "  $marker : OK"
done

echo "=== 8/8 HEALTH FINAL ==="
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
echo " MOO RAIL V9.1 INSTALLE ET VALIDE"
echo "============================================================"
echo " - bouton ✏️ Tracer moi-même"
echo " - maintien clic gauche = dessin rouge libre"
echo " - le dessin est converti en accroches RFN STRICTES"
echo " - le jaune est recalculé en suivant ces accroches dans l'ordre"
echo " - le trait peut ne couvrir QUE la zone problématique"
echo " - le tracé manuel est sauvegardé avec la brique V8"
echo "Backup : $BACKUP"
echo "============================================================"
