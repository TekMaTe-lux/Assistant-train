#!/usr/bin/env bash
set -u

ROOT="${MOORAIL_ROOT:-/opt/labetaillere-map-v2-src/map-v2}"
PUBLIC="$ROOT/public"
JS="$PUBLIC/moorail-route-editor-stops.js"
HTML="$PUBLIC/moorail-route-editor.html"
SERVICE="labetaillere-map-v2.service"
TMP="$(mktemp -d /tmp/moorail-editor-audit.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

fail=0
warn=0
pass=0

ok(){ printf '  ✅ %-34s %s\n' "$1" "${2:-}"; pass=$((pass+1)); }
ko(){ printf '  ❌ %-34s %s\n' "$1" "${2:-}"; fail=$((fail+1)); }
wa(){ printf '  ⚠️  %-34s %s\n' "$1" "${2:-}"; warn=$((warn+1)); }

echo "============================================================"
echo " MOO RAIL — AUDIT COMPLET OUTILS EDITEUR V9.4"
echo " AUCUNE MODIFICATION"
echo "============================================================"

if [[ ! -f "$JS" || ! -f "$HTML" ]]; then
  echo "ERREUR: fichiers éditeur absents"
  exit 2
fi

echo
echo "=== 1/8 SERVICE / FICHIERS SERVIS ==="
if systemctl is-active --quiet "$SERVICE"; then ok "service map" "active"; else ko "service map" "inactive"; fi
if curl -fsS --max-time 5 http://127.0.0.1:3111/api/map-v2/health > "$TMP/health.json"; then
  python3 - "$TMP/health.json" <<'PY'
import json,sys
h=json.load(open(sys.argv[1]));print('  health:',h)
PY
  ok "health API"
else ko "health API"; fi
if node --check "$JS" >/dev/null 2>&1; then ok "syntaxe JS"; else ko "syntaxe JS"; fi

curl -fsS --max-time 8 "http://127.0.0.1:3111/moorail-route-editor-stops.js?$(date +%s)" -o "$TMP/served.js" || true
curl -fsS --max-time 8 "http://127.0.0.1:3111/moorail-route-editor.html?$(date +%s)" -o "$TMP/served.html" || true
if cmp -s "$JS" "$TMP/served.js"; then ok "JS disque = JS servi"; else ko "JS disque = JS servi" "cache/version différente"; fi

for m in \
  LB_MOORAIL_ENDPOINT_HANDLES_V89 \
  LB_MOORAIL_DIRECTION_CHOOSER_V90 \
  LB_MOORAIL_FREEHAND_TRACE_V91 \
  LB_MOORAIL_FREEHAND_SIMPLIFY_V92 \
  LB_MOORAIL_TRACE_GUIDED_TOPOLOGY_V93 \
  LB_MOORAIL_LANE_CONTINUITY_V94; do
  if grep -qF "$m" "$TMP/served.js"; then ok "$m"; else ko "$m" "absent du produit servi"; fi
done

echo
echo "=== 2/8 BOUTONS / BINDINGS ==="
for id in forceA forceB resetEnds manualDrawV91 manualClearV91; do
  if grep -q "id=\"$id\"" "$TMP/served.html"; then ok "bouton $id"; else ko "bouton $id" "absent HTML"; fi
done
for needle in \
  "$('forceA').onclick" \
  "$('forceB').onclick" \
  "$('resetEnds').onclick" \
  "$('manualDrawV91').onclick" \
  "$('manualClearV91').onclick"; do
  if grep -qF "$needle" "$TMP/served.js"; then ok "binding ${needle%%.onclick*}"; else ko "binding ${needle%%.onclick*}"; fi
done

echo
echo "=== 3/8 ANALYSE DES FONCTIONS ACTIVES ==="
python3 - "$TMP/served.js" "$TMP/audit.json" <<'PY'
from pathlib import Path
import json,re,sys
s=Path(sys.argv[1]).read_text(encoding='utf-8',errors='replace')

def body(name):
    m=re.search(r'function\s+'+re.escape(name)+r'\s*\([^)]*\)\s*\{',s)
    if not m:return ''
    i=m.end()-1;depth=0;quote=None;esc=False
    for j in range(i,len(s)):
        c=s[j]
        if quote:
            if esc:esc=False
            elif c=='\\':esc=True
            elif c==quote:quote=None
            continue
        if c in "'\"`":quote=c;continue
        if c=='{':depth+=1
        elif c=='}':
            depth-=1
            if depth==0:return s[m.start():j+1]
    return ''

names=['lbStrictRailAnchorV89','lbSetEndpointModeV89','lbSetEndpointOverrideV89','lbResetEndpointOverridesV89','lbShowDirectionChoicesV90','lbBuildWholeRouteV90','lbToggleManualDrawV91','lbClearManualTraceV91','lbSimplifyManualTraceV92','lbBuildGuidedCoreV93','lbRouteByRedV93','lbTransitionPenaltyV94']
b={n:body(n) for n in names}

# Valeurs actuellement codées en dur.
def first(pattern,text,default=None):
    m=re.search(pattern,text)
    return m.group(1) if m else default

out={
 'function_present':{k:bool(v) for k,v in b.items()},
 'endpoint_max_m':first(r'best\.d>([0-9.]+)',b['lbStrictRailAnchorV89']),
 'choice_radius_m':first(r'q\.d<=([0-9.]+)',b['lbShowDirectionChoicesV90']),
 'guided_corridor_m':first(r'const\s+corridor=([0-9.]+)',b['lbBuildGuidedCoreV93']),
 'near_join_m':first(r'q\.d>([0-9.]+)',b['lbBuildGuidedCoreV93']),
 'intersection_angle_deg':first(r'ang<=([0-9.]+)',b['lbBuildGuidedCoreV93']),
 'zoom_adaptive_anchor':('getZoom(' in b['lbStrictRailAnchorV89'] or 'containerPointToLatLng' in b['lbStrictRailAnchorV89']),
 'zoom_adaptive_corridor':('getZoom(' in b['lbBuildGuidedCoreV93'] or 'containerPointToLatLng' in b['lbBuildGuidedCoreV93']),
 'snap_heading_aware':any(x in b['lbStrictRailAnchorV89'] for x in ['heading','bearing','angle','direction']),
 'manual_snap_heading_aware':any(x in b['lbBuildGuidedCoreV93'] for x in ['guideHeading','headingPenalty','bearingPenalty']),
 'red_rejoins_existing_route':('state.routeCoords' in b['lbRouteByRedV93'] or 'baseline' in b['lbRouteByRedV93'] or 'existingRoute' in b['lbRouteByRedV93']),
 'red_prefix_recomputed_from_station':('routeAnchors(A,S)' in b['lbRouteByRedV93']),
 'red_suffix_recomputed_to_station':('routeAnchors(E,B)' in b['lbRouteByRedV93']),
 'direction_chooser_red_aware':('manualGuideV93' in b['lbBuildWholeRouteV90'] or 'lbRouteByRedV93' in b['lbBuildWholeRouteV90']),
 'endpoint_mode_clears_red':('manualGuideV93=[]' in b['lbSetEndpointModeV89'] or 'lbClearManualTraceV91' in b['lbSetEndpointModeV89']),
 'manual_mode_clears_choices':('lbClearDirectionChoicesV90' in b['lbToggleManualDrawV91']),
 'manual_mode_clears_endpoint_mode':('endpointMode=null' in b['lbToggleManualDrawV91']),
 'reset_ends_keeps_red':('manualGuideV93' not in b['lbResetEndpointOverridesV89']),
 'direction_click_blocks_via':("directionChoiceWhichV90" in s and "Choisis une des directions" in s),
 'endpoint_segment_persisted':('segmentId' in s and 'endpointOverrides' in s),
 'manual_trace_persisted':('manualGuideV93:' in s and 'manualTraceV91:' in s),
 'lane_stateful_dijkstra':('startState=`${start}§START`' in s and 'lbTransitionPenaltyV94' in s),
}
Path(sys.argv[2]).write_text(json.dumps(out,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(out,ensure_ascii=False,indent=2))
PY

echo
echo "=== 4/8 TEST ZOOM / ACCROCHE ==="
python3 - "$TMP/audit.json" <<'PY'
import json,sys
x=json.load(open(sys.argv[1]))
print('  seuil clic A/B             :',x.get('endpoint_max_m'),'m')
print('  rayon choix directions     :',x.get('choice_radius_m'),'m')
print('  largeur corridor rouge     :',x.get('guided_corridor_m'),'m')
print('  zoom adaptatif clic A/B    :',x.get('zoom_adaptive_anchor'))
print('  zoom adaptatif rouge       :',x.get('zoom_adaptive_corridor'))
print('  snap selon direction rouge :',x.get('snap_heading_aware') or x.get('manual_snap_heading_aware'))
PY

if python3 - "$TMP/audit.json" <<'PY'
import json,sys
x=json.load(open(sys.argv[1]));raise SystemExit(0 if x['zoom_adaptive_anchor'] else 1)
PY
then ok "accroche A/B adaptée au zoom"; else ko "accroche A/B adaptée au zoom" "seuil fixe : difficile en dézoom"; fi
if python3 - "$TMP/audit.json" <<'PY'
import json,sys
x=json.load(open(sys.argv[1]));raise SystemExit(0 if x['zoom_adaptive_corridor'] else 1)
PY
then ok "corridor rouge adapté au zoom"; else ko "corridor rouge adapté au zoom" "55 m fixe : trop étroit en dézoom"; fi
if python3 - "$TMP/audit.json" <<'PY'
import json,sys
x=json.load(open(sys.argv[1]));raise SystemExit(0 if x['snap_heading_aware'] or x['manual_snap_heading_aware'] else 1)
PY
then ok "snap tient compte du sens"; else ko "snap tient compte du sens" "choisit surtout la voie la plus proche"; fi

echo
echo "=== 5/8 TEST RACCORD AU TRACE EXISTANT ==="
if python3 - "$TMP/audit.json" <<'PY'
import json,sys
x=json.load(open(sys.argv[1]));raise SystemExit(0 if x['red_rejoins_existing_route'] else 1)
PY
then ok "rouge se greffe au jaune existant"; else ko "rouge se greffe au jaune existant" "V9.3 recalcule gare→rouge→gare au lieu de remplacer seulement la zone dessinée"; fi

python3 - "$TMP/audit.json" <<'PY'
import json,sys
x=json.load(open(sys.argv[1]))
print('  préfixe recalculé depuis gare :',x['red_prefix_recomputed_from_station'])
print('  suffixe recalculé vers gare   :',x['red_suffix_recomputed_to_station'])
PY

echo
echo "=== 6/8 TEST COHABITATION DES MODES ==="
if python3 - "$TMP/audit.json" <<'PY'
import json,sys
x=json.load(open(sys.argv[1]));raise SystemExit(0 if x['manual_mode_clears_choices'] and x['manual_mode_clears_endpoint_mode'] else 1)
PY
then ok "Crayon nettoie choix A/B"; else ko "Crayon nettoie choix A/B"; fi

if python3 - "$TMP/audit.json" <<'PY'
import json,sys
x=json.load(open(sys.argv[1]));raise SystemExit(0 if x['direction_chooser_red_aware'] else 1)
PY
then ok "Choix direction comprend le rouge"; else ko "Choix direction comprend le rouge" "les 1–5 sont calculés par l'ancien routeur, sans corridor rouge"; fi

if python3 - "$TMP/audit.json" <<'PY'
import json,sys
x=json.load(open(sys.argv[1]));raise SystemExit(0 if x['endpoint_mode_clears_red'] else 1)
PY
then ok "Sortie/Entrée isole le mode"; else wa "Sortie/Entrée + rouge simultanés" "le rouge reste actif : le résultat peut ne pas correspondre à l'option cliquée"; fi

if python3 - "$TMP/audit.json" <<'PY'
import json,sys
x=json.load(open(sys.argv[1]));raise SystemExit(0 if x['direction_click_blocks_via'] else 1)
PY
then ok "clic choix n'ajoute pas de via"; else ko "clic choix n'ajoute pas de via"; fi

if python3 - "$TMP/audit.json" <<'PY'
import json,sys
x=json.load(open(sys.argv[1]));raise SystemExit(0 if x['endpoint_segment_persisted'] else 1)
PY
then ok "segment A/B persisté"; else ko "segment A/B persisté"; fi

if python3 - "$TMP/audit.json" <<'PY'
import json,sys
x=json.load(open(sys.argv[1]));raise SystemExit(0 if x['manual_trace_persisted'] else 1)
PY
then ok "tracé manuel persisté"; else ko "tracé manuel persisté"; fi

echo
echo "=== 7/8 TESTS SYNTHETIQUES ==="
node <<'JS'
// 1) Impact du dézoom : un clic à 20 px de la voie peut représenter des centaines
// de mètres ; un seuil monde fixe ne peut pas donner la même ergonomie selon le zoom.
const pxErrors=[8,20,40];
const metersPerPx={z15:3,z12:24,z10:95,z8:380};
console.log('  Erreur monde pour un clic imprécis :');
for(const [z,mpp] of Object.entries(metersPerPx)){
  console.log('   ',z,pxErrors.map(px=>`${px}px=${px*mpp}m`).join(' | '));
}
console.log('  Seuil A/B actuel: 120 m ; corridor rouge actuel: 55 m.');
console.log('  => à z10/z8, un dessin visuellement proche peut être hors seuil.');

// 2) Anti-zigzag V9.4 : test déjà fait à l'installation, répété ici.
function penalty(same,turn){
  if(same)return turn>45?(turn-45)*4:0;
  if(turn<=3)return 80;if(turn<=8)return 150+(turn-3)*8;
  if(turn<=18)return 240+(turn-8)*14;if(turn<=38)return 420+(turn-18)*22;
  return 1200+(turn-38)*35;
}
const stay=300;
const zig=95+penalty(false,2)+95+penalty(false,2)+95;
console.log('  anti-zigzag continuité=',stay,' zigzag=',zig,stay<zig?'OK':'FAIL');
if(!(stay<zig))process.exitCode=2;
JS
[[ $? -eq 0 ]] && ok "anti-zigzag synthétique" || ko "anti-zigzag synthétique"

echo
echo "=== 8/8 VERDICT ==="
printf '  PASS : %d\n' "$pass"
printf '  WARN : %d\n' "$warn"
printf '  FAIL : %d\n' "$fail"
echo
if (( fail == 0 )); then
  echo "RESULTAT : ✅ OUTIL COHERENT SUR LES TESTS AUTOMATISABLES"
elif (( fail <= 2 )); then
  echo "RESULTAT : ⚠️ OUTIL PARTIELLEMENT FIABLE — CORRECTIONS CIBLEES NECESSAIRES"
else
  echo "RESULTAT : ❌ OUTIL PAS ENCORE FIABLE POUR VALIDATION NATIONALE"
fi

echo
echo "AUCUNE MODIFICATION EFFECTUEE."
# Le script lui-même a fonctionné : code retour 0 même si des défauts produit sont trouvés.
exit 0
