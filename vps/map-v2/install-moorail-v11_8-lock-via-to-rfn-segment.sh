#!/usr/bin/env bash
set -euo pipefail

ROOT="${MOORAIL_ROOT:-/opt/labetaillere-map-v2-src/map-v2}"
PUBLIC="$ROOT/public"
JS="$PUBLIC/moorail-route-editor-stops.js"
HTML="$PUBLIC/moorail-route-editor.html"
HTML2="$PUBLIC/moorail-route-editor-stops.html"
SERVICE="labetaillere-map-v2.service"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$ROOT/backups/moorail-v11_8-segment-lock-$STAMP"
TMP="$(mktemp -d /tmp/moorail-v118.XXXXXX)"
SUCCESS=0

cleanup(){ rm -rf "$TMP"; }
rollback(){
  [[ "$SUCCESS" == 1 ]] && return 0
  echo "ROLLBACK MOO RAIL V11.8..." >&2
  [[ -f "$BACKUP/moorail-route-editor-stops.js" ]] && cp -a "$BACKUP/moorail-route-editor-stops.js" "$JS" || true
  [[ -f "$BACKUP/moorail-route-editor.html" ]] && cp -a "$BACKUP/moorail-route-editor.html" "$HTML" || true
  [[ -f "$BACKUP/moorail-route-editor-stops.html" && -f "$HTML2" ]] && cp -a "$BACKUP/moorail-route-editor-stops.html" "$HTML2" || true
}
finish(){ rc=$?; trap - EXIT; rollback; cleanup; exit "$rc"; }
trap finish EXIT

[[ ${EUID:-$(id -u)} -eq 0 ]] || { echo "ERREUR: lancer avec sudo/root" >&2; exit 2; }
[[ -f "$JS" && -f "$HTML" ]] || { echo "ERREUR fichiers éditeur absents" >&2; exit 3; }

echo "============================================================"
echo " MOO RAIL V11.8 — VERROUILLAGE EXACT DE VOIE AUX CROISEMENTS"
echo "============================================================"
echo "Un point jaune ne mémorise plus seulement lat/lon : il mémorise"
echo "aussi l'identité du segment RFN choisi. Le routeur est obligé de"
echo "traverser CE segment, même si plusieurs voies se touchent/croisent."
echo

echo "=== 0/7 PRE-FLIGHT ==="
systemctl is-active --quiet "$SERVICE"
curl -fsS --max-time 5 http://127.0.0.1:3111/api/map-v2/health > "$TMP/health.json"
cat "$TMP/health.json"; echo
for marker in LB_MOORAIL_UNIFIED_EDITOR_V10 LB_MOORAIL_BRICK_BY_BRICK_V117; do
  grep -qF "$marker" "$JS" || { echo "ERREUR marqueur JS absent: $marker" >&2; exit 4; }
done
grep -qF 'function routeAnchors(A,B)' "$JS" || { echo "ERREUR routeAnchors absent" >&2; exit 4; }
if grep -qF 'LB_MOORAIL_VIA_SEGMENT_LOCK_V118' "$JS"; then
  echo "ERREUR V11.8 déjà installée" >&2; exit 5
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
import re,sys
p=Path(sys.argv[1]); s=p.read_text(encoding='utf-8')
marker='/* LB_MOORAIL_VIA_SEGMENT_LOCK_V118 */'
if marker in s: raise SystemExit('V11.8 déjà présente')

# 1. Au rechargement d'une brique, conserver l'identité du segment si elle existe.
old="state.via=(saved?.waypoints||[]).map(p=>({lat:+p.lat,lon:+p.lon})).filter(p=>Number.isFinite(p.lat)&&Number.isFinite(p.lon));"
new="state.via=(saved?.waypoints||[]).map(p=>({lat:+p.lat,lon:+p.lon,segmentId:String(p.segmentId||p.nearestSeg||'')||null})).filter(p=>Number.isFinite(p.lat)&&Number.isFinite(p.lon));"
if old not in s: raise SystemExit('ERREUR ancre reload waypoints absente')
s=s.replace(old,new,1)

# 2. Un clic crée un point verrouillé au segment exact sélectionné.
old="if(!state.route||!state.graph)return;const a=anchorAt(latlng,'via');if(!a){setStatus('Aucune voie RFN proche de ce clic.','bad');return;}state.via.push({lat:a.railLat,lon:a.railLon});renderVia();recompute();"
new="if(!state.route||!state.graph)return;const a=(typeof lbStrictRailAnchorV10==='function'?lbStrictRailAnchorV10(latlng):anchorAt(latlng,'via'));if(!a){setStatus('Aucune voie RFN proche de ce clic.','bad');return;}state.via.push({lat:a.railLat,lon:a.railLon,segmentId:String(a.nearestSeg||'')||null});renderVia();recompute();"
if old not in s: raise SystemExit('ERREUR ancre addVia absente')
s=s.replace(old,new,1)

# 3. Le drag d'un point le reverrouille sur le nouveau segment choisi.
old="m.on('dragend',()=>{const a=anchorAt(m.getLatLng(),'via');if(!a){m.setLatLng([p.lat,p.lon]);return;}state.via[i]={lat:a.railLat,lon:a.railLon};renderVia();recompute();});"
new="m.on('dragend',()=>{const ll=m.getLatLng();const a=(typeof lbStrictRailAnchorV10==='function'?lbStrictRailAnchorV10(ll):anchorAt(ll,'via'));if(!a){m.setLatLng([p.lat,p.lon]);return;}state.via[i]={lat:a.railLat,lon:a.railLon,segmentId:String(a.nearestSeg||'')||null};renderVia();recompute();});"
if old not in s: raise SystemExit('ERREUR ancre drag via absente')
s=s.replace(old,new,1)

# 4. Le recompute ne réinterprète plus un point uniquement par sa coordonnée.
old="anchors.push(A);for(const v of state.via){const x=anchorAt(L.latLng(v.lat,v.lon),'via');if(x)anchors.push(x);}anchors.push(B);"
new="anchors.push(A);for(const v of state.via){for(const x of lbViaGateAnchorsV118(v,p[0],p[1]))if(x)anchors.push(x);}anchors.push(B);"
if old not in s: raise SystemExit('ERREUR ancre anchors via absente')
s=s.replace(old,new,1)

# 5. routeAnchors sait reconnaître les deux extrémités d'un segment forcé et
#    traverse directement ce segment sans laisser Dijkstra choisir une autre branche.
old="function routeAnchors(A,B){\n  if(!A||!B||!state.graph)return null;"
new="function routeAnchors(A,B){\n  if(A?.forceSegmentV118&&B?.forceSegmentV118&&A.forceSegmentV118===B.forceSegmentV118){return [[A.lon,A.lat],[B.lon,B.lat]];}\n  if(!A||!B||!state.graph)return null;"
if old not in s: raise SystemExit('ERREUR ancre routeAnchors absente')
s=s.replace(old,new,1)

# 6. V11.7 persiste le verrou segmentId lors de la validation.
old="waypoints:(state.via||[]).map(x=>({lat:x.lat,lon:x.lon})),"
new="waypoints:(state.via||[]).map(x=>({lat:x.lat,lon:x.lon,segmentId:x.segmentId||null})),"
if old not in s: raise SystemExit('ERREUR ancre payload V11.7 absente')
s=s.replace(old,new,1)

# 7. Helpers : un point = une petite 'porte' constituée des deux extrémités
#    du segment RFN choisi. Cela impose réellement la voie au croisement.
pos=s.rfind('})();')
if pos<0: raise SystemExit('ERREUR fin IIFE absente')
extra=marker+r'''

function lbViaGateAnchorsV118(v,fromStop,toStop){
  if(!v)return [];
  let seg=null;
  const sid=String(v.segmentId||'');
  if(sid)seg=state.segments?.get?.(sid)||null;

  // Anciennes validations sans segmentId : on les convertit à la volée.
  if(!seg){
    const ll=L.latLng(+v.lat,+v.lon);
    const snap=(typeof lbStrictRailAnchorV10==='function')
      ? lbStrictRailAnchorV10(ll)
      : anchorAt(ll,'via');
    if(!snap)return [];
    if(snap.nearestSeg){
      v.segmentId=String(snap.nearestSeg);
      seg=state.segments?.get?.(v.segmentId)||null;
    }
    if(!seg)return [snap];
    v.lat=+snap.railLat;v.lon=+snap.railLon;
  }

  if(!seg.aKey||!seg.bKey)return [];
  const a=[+seg.a[0],+seg.a[1]],b=[+seg.b[0],+seg.b[1]];
  if(!a.every(Number.isFinite)||!b.every(Number.isFinite))return [];

  // Oriente la porte dans le sens général A -> B afin d'éviter un mini demi-tour.
  const origin=[+fromStop?.lon,+fromStop?.lat];
  let first={c:a,key:seg.aKey},second={c:b,key:seg.bKey};
  if(origin.every(Number.isFinite)&&distanceLL(origin,b)<distanceLL(origin,a)){
    first={c:b,key:seg.bKey};second={c:a,key:seg.aKey};
  }

  const make=(x)=>({
    lat:x.c[1],lon:x.c[0],railLat:x.c[1],railLon:x.c[0],
    links:[{node:x.key,cost:0}],nearestSeg:seg.id,
    forceSegmentV118:String(seg.id),lockedV118:true
  });
  return [make(first),make(second)];
}
'''
s=s[:pos]+extra+'\n'+s[pos:]
p.write_text(s,encoding='utf-8')
print('Patch V11.8 préparé :')
print(' - clic via => segmentId RFN mémorisé')
print(' - drag via => segmentId RFN remémorisé')
print(' - recalcul => segment exact forcé aux croisements')
print(' - validation V11.7 => segmentId persisté')
PY

node --check "$TMP/editor.js"
grep -qF 'LB_MOORAIL_VIA_SEGMENT_LOCK_V118' "$TMP/editor.js"

echo "=== 3/7 SELF-TEST STRUCTUREL ==="
python3 - "$TMP/editor.js" <<'PY'
from pathlib import Path
import sys
s=Path(sys.argv[1]).read_text(encoding='utf-8')
assert 'LB_MOORAIL_VIA_SEGMENT_LOCK_V118' in s
assert "segmentId:String(a.nearestSeg||'')||null" in s
assert 'lbViaGateAnchorsV118(v,p[0],p[1])' in s
assert 'A?.forceSegmentV118&&B?.forceSegmentV118' in s
assert "segmentId:x.segmentId||null" in s
assert "segmentId:String(p.segmentId||p.nearestSeg||'')||null" in s
print('SELF-TEST clic verrouillé segment RFN : OK')
print('SELF-TEST drag verrouillé segment RFN : OK')
print('SELF-TEST croisement forcé exact       : OK')
print('SELF-TEST persistance segmentId        : OK')
PY

echo "=== 4/7 CACHE HTML ==="
python3 - "$HTML" "$HTML2" <<'PY'
from pathlib import Path
import re,sys
for raw in sys.argv[1:]:
    p=Path(raw)
    if not p.exists():continue
    s=p.read_text(encoding='utf-8')
    s,n=re.subn(r'moorail-route-editor-stops\.js(?:\?v=[^"\']*)?', 'moorail-route-editor-stops.js?v=11.8', s)
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
grep -qF 'LB_MOORAIL_VIA_SEGMENT_LOCK_V118' "$TMP/served.js"
grep -qF 'forceSegmentV118' "$TMP/served.js"
grep -qF 'segmentId:x.segmentId||null' "$TMP/served.js"
echo "V11.8 servi : OK"

echo "=== 7/7 HEALTH / VERDICT ==="
systemctl is-active --quiet "$SERVICE"
curl -fsS --max-time 5 http://127.0.0.1:3111/api/map-v2/health; echo
SUCCESS=1
trap - EXIT
cleanup

echo
echo "============================================================"
echo " MOO RAIL V11.8 INSTALLE — VOIE VERROUILLEE AUX CROISEMENTS"
echo "============================================================"
echo " - chaque point jaune mémorise le segment RFN exact"
echo " - déplacer un point change explicitement de segment"
echo " - le routeur doit traverser le segment choisi"
echo " - V11.7 brique-par-brique reste actif"
echo "Backup : $BACKUP"
echo "============================================================"
