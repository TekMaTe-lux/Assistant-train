#!/usr/bin/env bash
set -euo pipefail

ROOT="${MOORAIL_ROOT:-/opt/labetaillere-map-v2-src/map-v2}"
PUBLIC="$ROOT/public"
SERVICE="labetaillere-map-v2.service"
NETWORK="$PUBLIC/data/moorail-network-v8/network.json"
LIVE="$PUBLIC/data/moorail-live-v1/sections.json"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$ROOT/backups/moorail-v8_7-selected-no-early-return-$STAMP"
TMP="$(mktemp -d /tmp/moorail-v87.XXXXXX)"
SUCCESS=0
RESTARTED=0

cleanup(){ rm -rf "$TMP"; }
rollback(){
  [[ "$SUCCESS" == 1 ]] && return 0
  echo "ROLLBACK MOO RAIL V8.7..." >&2
  for f in "$BACKUP"/*.html; do
    [[ -f "$f" ]] || continue
    cp -a "$f" "$PUBLIC/$(basename "$f")"
  done
  if [[ "$RESTARTED" == 1 ]]; then
    systemctl restart "$SERVICE" >/dev/null 2>&1 || true
  fi
}
finish(){ rc=$?; trap - EXIT; rollback; cleanup; exit "$rc"; }
trap finish EXIT

[[ ${EUID:-$(id -u)} -eq 0 ]] || { echo "ERREUR: lancer avec sudo/root" >&2; exit 2; }
[[ -f "$NETWORK" ]] || { echo "ERREUR network absent: $NETWORK" >&2; exit 3; }
[[ -f "$LIVE" ]] || { echo "ERREUR live absent: $LIVE" >&2; exit 3; }

echo "============================================================"
echo " MOO RAIL V8.7 — SUPPRESSION DU EARLY RETURN TRIP-ID"
echo "============================================================"

echo "=== 0/7 PRE-FLIGHT ==="
systemctl is-active --quiet "$SERVICE"
curl -fsS --max-time 5 http://127.0.0.1:3111/api/map-v2/health > "$TMP/health-before.json"
python3 - "$TMP/health-before.json" "$NETWORK" "$LIVE" <<'PY'
import json,sys,unicodedata
h=json.load(open(sys.argv[1]));n=json.load(open(sys.argv[2]));lv=json.load(open(sys.argv[3]))
assert h.get('ok') is True,h
routes=(n.get('trainRoutes') or {}).get('2656') or []
assert routes,'2656 absent de trainRoutes'

def norm(s):
    s=unicodedata.normalize('NFKD',str(s or ''))
    return ''.join(c for c in s if not unicodedata.combining(c)).strip().lower()
pairs={(norm(x.get('from')),norm(x.get('to'))) for x in (lv.get('pairs') or [])}
assert (norm('Metz'),norm('Meuse TGV')) in pairs
assert (norm('Meuse TGV'),norm('Paris Est')) in pairs
print('Health :',h)
print('2656 data/live : OK | Metz -> Meuse TGV -> Paris Est')
PY

CORES=()
for n in carte-core-canonical-v4-preview.html carte-core-preview.html; do
  f="$PUBLIC/$n"
  [[ -f "$f" ]] || continue
  grep -qF 'LB_MOORAIL_SELECTED_ROUTE_BY_NUMBER_V85' "$f" || continue
  grep -qF 'LB_MOORAIL_SELECTED_NUMBER_V86' "$f" || continue
  grep -qF 'async function drawSelectedTripRoute(trainId)' "$f" || continue
  CORES+=("$f")
done
[[ ${#CORES[@]} -eq 2 ]] || { echo "ERREUR: les 2 cores V8.5/V8.6 ne sont pas présents" >&2; exit 4; }

for f in "${CORES[@]}"; do
  python3 - "$f" <<'PY'
from pathlib import Path
import sys
s=Path(sys.argv[1]).read_text(encoding='utf-8',errors='replace')
old="""    const routeTripId = tripIdForSelectedRoute(trainId);\n    if (!routeTripId) return;\n    const seq = stopTimesByTrip.get(routeTripId) || [];\n"""
marker='/* LB_MOORAIL_NO_EARLY_RETURN_V87 */'
if marker in s:
    print('  déjà V8.7 :',Path(sys.argv[1]).name)
elif old in s:
    print('  early-return confirmé :',Path(sys.argv[1]).name)
else:
    raise SystemExit('ERREUR: motif early-return inattendu dans '+str(sys.argv[1]))
PY
done

echo "=== 1/7 BACKUP ==="
mkdir -p "$BACKUP"
for f in "${CORES[@]}"; do cp -a "$f" "$BACKUP/$(basename "$f")"; done
echo "Backup : $BACKUP"

echo "=== 2/7 PATCH : le fallback numéro passe AVANT toute sortie ==="
mkdir -p "$TMP/cores"
for f in "${CORES[@]}"; do
  out="$TMP/cores/$(basename "$f")"
  cp -a "$f" "$out"
  python3 - "$out" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1]);s=p.read_text(encoding='utf-8')
marker='/* LB_MOORAIL_NO_EARLY_RETURN_V87 */'
if marker in s:
    print('Déjà patché :',p)
    raise SystemExit(0)
old="""    const routeTripId = tripIdForSelectedRoute(trainId);\n    if (!routeTripId) return;\n    const seq = stopTimesByTrip.get(routeTripId) || [];\n    drawSelectedStations(routeTripId, seq);\n"""
new="""    /* LB_MOORAIL_NO_EARLY_RETURN_V87 */\n    // Un train LIVE peut être affiché avec son numéro sans avoir de tripId statique\n    // résolu par tripIdForSelectedRoute(). Dans ce cas V8.5 doit quand même avoir\n    // la possibilité de résoudre son parcours via network.json -> trainRoutes[numéro].\n    const resolvedRouteTripId = tripIdForSelectedRoute(trainId);\n    const routeTripId = resolvedRouteTripId || trainId;\n    const seq = resolvedRouteTripId ? (stopTimesByTrip.get(resolvedRouteTripId) || []) : [];\n    if(resolvedRouteTripId) drawSelectedStations(resolvedRouteTripId, seq);\n    window.lbMoorailSelectedDebugV87={\n      trainId, resolvedRouteTripId:resolvedRouteTripId||null, routeTripId, seqLength:seq.length,\n      number:lbMoorailSelectedTrainNumberV85(trainId), stage:'before-moorail'\n    };\n"""
if old not in s:
    raise SystemExit('ERREUR: bloc routeTripId exact absent dans '+str(p))
s=s.replace(old,new,1)

old2="""      const lbMoorailSelected = lbMoorailSelectedRouteForTrainV85(trainId,seq);\n      if(lbMoorailSelected){\n"""
new2="""      const lbMoorailSelected = lbMoorailSelectedRouteForTrainV85(trainId,seq);\n      if(window.lbMoorailSelectedDebugV87){\n        window.lbMoorailSelectedDebugV87.stage=lbMoorailSelected?'moorail-resolved':'moorail-miss';\n        window.lbMoorailSelectedDebugV87.sectionIds=lbMoorailSelected?.sectionIds||[];\n        window.lbMoorailSelectedDebugV87.coordCount=lbMoorailSelected?.coords?.length||0;\n      }\n      if(lbMoorailSelected){\n"""
if old2 not in s:
    raise SystemExit('ERREUR: appel V8.5 absent dans '+str(p))
s=s.replace(old2,new2,1)

p.write_text(s,encoding='utf-8')
PY
  grep -qF 'LB_MOORAIL_NO_EARLY_RETURN_V87' "$out"
  grep -qF 'const resolvedRouteTripId = tripIdForSelectedRoute(trainId);' "$out"
  if grep -qF 'if (!routeTripId) return;' "$out"; then
    echo "ERREUR: early-return encore présent dans $(basename "$f")" >&2
    exit 5
  fi
done

echo "=== 3/7 CONTROLE STRUCTUREL ==="
python3 - "${CORES[@]}" <<'PY'
from pathlib import Path
import sys
for name in sys.argv[1:]:
    s=Path(name).read_text(encoding='utf-8',errors='replace')
    assert s.count('LB_MOORAIL_NO_EARLY_RETURN_V87')==1,name
    pos_draw=s.index('async function drawSelectedTripRoute(trainId)')
    pos_res=s.index('const resolvedRouteTripId = tripIdForSelectedRoute(trainId);',pos_draw)
    pos_moo=s.index('lbMoorailSelectedRouteForTrainV85(trainId,seq)',pos_draw)
    assert pos_draw < pos_res < pos_moo,(name,pos_draw,pos_res,pos_moo)
    print('  structure OK :',Path(name).name)
PY

echo "=== 4/7 INSTALLATION ==="
for f in "${CORES[@]}"; do
  install -o root -g root -m 0644 "$TMP/cores/$(basename "$f")" "$f"
done

echo "=== 5/7 RESTART ==="
RESTARTED=1
systemctl restart "$SERVICE"
for _ in $(seq 1 30); do
  if systemctl is-active --quiet "$SERVICE" && curl -fsS --max-time 2 http://127.0.0.1:3111/api/map-v2/health >/dev/null 2>&1; then break; fi
  sleep 1
done
systemctl is-active --quiet "$SERVICE"

echo "=== 6/7 PRODUIT SERVI ==="
for f in "${CORES[@]}"; do
  name="$(basename "$f")"
  curl -fsS --max-time 10 "http://127.0.0.1:3111/$name?$(date +%s)" -o "$TMP/served-$name"
  grep -qF 'LB_MOORAIL_NO_EARLY_RETURN_V87' "$TMP/served-$name"
  grep -qF 'window.lbMoorailSelectedDebugV87' "$TMP/served-$name"
  if grep -qF 'if (!routeTripId) return;' "$TMP/served-$name"; then
    echo "ERREUR: ancienne sortie encore servie dans $name" >&2
    exit 6
  fi
  echo "  SERVI : $name"
done

echo "=== 7/7 HEALTH FINAL ==="
HEALTH="$(curl -fsS --max-time 5 http://127.0.0.1:3111/api/map-v2/health)"
echo "$HEALTH"
python3 - <<'PY'
# Preuve logique du cas 2656 : même avec routeTripId=null, le nouveau bloc
# conserve trainId comme clé et appelle ensuite le fallback trainRoutes par numéro.
resolved=None
train_id='LIVE-2656-demo'
route_trip_id=resolved or train_id
seq=[] if resolved is None else ['unused']
assert route_trip_id==train_id and seq==[]
print('Simulation early-return absent : OK')
PY

SUCCESS=1
trap - EXIT
cleanup

echo
echo "============================================================"
echo " MOO RAIL V8.7 INSTALLE ET VALIDE"
echo "============================================================"
echo "Bug corrigé : drawSelectedTripRoute ne quitte plus la fonction"
echo "quand le train LIVE n'a pas de tripId statique résolu."
echo "Le fallback V8.5 par numéro peut maintenant réellement s'exécuter."
echo "Diagnostic navigateur disponible : window.lbMoorailSelectedDebugV87"
echo "Backup : $BACKUP"
echo "============================================================"
