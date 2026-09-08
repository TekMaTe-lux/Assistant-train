#!/usr/bin/env bash
set -euo pipefail

ROOT="${MOORAIL_ROOT:-/opt/labetaillere-map-v2-src/map-v2}"
PUBLIC="$ROOT/public"
SERVICE="labetaillere-map-v2.service"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$ROOT/backups/moorail-selected-route-v5_2-$STAMP"
TMP="$(mktemp -d /tmp/moorail-selected-v52.XXXXXX)"
SUCCESS=0
RESTARTED=0

cleanup(){ rm -rf "$TMP"; }
rollback(){
  [[ "$SUCCESS" == 1 ]] && return 0
  echo "ROLLBACK MOO RAIL V5.2..." >&2
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

echo "============================================================"
echo " MOO RAIL V5.2 — TRACE JAUNE = SECTIONS MOO RAIL VALIDEES"
echo "============================================================"

echo "=== 1/5 Détection des moteurs France V3 ==="
TARGETS=()
for name in carte-core-canonical-v4-preview.html carte-core-preview.html france-v3-preview.html; do
  f="$PUBLIC/$name"
  [[ -f "$f" ]] || continue
  if grep -qF 'async function drawSelectedTripRoute(trainId)' "$f" && \
     grep -qF 'function lbMoorailPathBetweenStops(stopA,stopB)' "$f"; then
    TARGETS+=("$f")
    echo "Moteur : $f"
  fi
done
[[ ${#TARGETS[@]} -gt 0 ]] || { echo "ERREUR: aucun moteur compatible V4.5 trouvé" >&2; exit 3; }

mkdir -p "$BACKUP"
for f in "${TARGETS[@]}"; do cp -a "$f" "$BACKUP/$(basename "$f")"; done

echo "=== 2/5 Patch priorité MooRail pour le trajet sélectionné ==="
for f in "${TARGETS[@]}"; do
python3 - "$f" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1])
s=p.read_text(encoding='utf-8')
marker='/* LB_MOORAIL_SELECTED_ROUTE_V52 */'
if marker in s:
    print('Déjà patché :',p)
    raise SystemExit(0)

required=[
    'function lbMoorailPathBetweenStops(stopA,stopB)',
    'async function lbLoadMoorailOverrides()',
    'async function drawSelectedTripRoute(trainId)',
    'const cachedRoute = selectedTripRailPathCache.get(routeTripId);',
]
for x in required:
    if x not in s: raise SystemExit(f'ERREUR ancre absente dans {p}: {x}')

helper=r'''

  /* LB_MOORAIL_SELECTED_ROUTE_V52 */
  let lbMoorailSelectedRefreshAt = 0;

  async function lbRefreshMoorailForSelectedRoute(){
    const now=Date.now();
    if(lbMoorailLiveLoaded && now-lbMoorailSelectedRefreshAt < 10000) return;
    await lbLoadMoorailOverrides();
    lbMoorailSelectedRefreshAt=Date.now();
  }

  function lbMoorailSelectedFullRoute(seq){
    if(!Array.isArray(seq) || seq.length<2 || !lbMoorailLiveLoaded) return null;
    const combined=[];
    const sectionIds=[];
    for(let i=0;i<seq.length-1;i++){
      const stopA=stopsById.get(seq[i].stop_id);
      const stopB=stopsById.get(seq[i+1].stop_id);
      if(!stopA || !stopB) return null;
      const path=lbMoorailPathBetweenStops(stopA,stopB);
      if(!path || !Array.isArray(path.coords) || path.coords.length<2) return null;
      appendRailCoords(combined,path.coords);
      if(path.moorailSectionId) sectionIds.push(path.moorailSectionId);
    }
    if(combined.length<2) return null;
    return {coords:combined,sectionIds};
  }
'''
anchor='  async function drawSelectedTripRoute(trainId){'
s=s.replace(anchor,helper+'\n'+anchor,1)

needle='''    const seq = stopTimesByTrip.get(routeTripId) || [];
    drawSelectedStations(routeTripId, seq);

    const cachedRoute = selectedTripRailPathCache.get(routeTripId);'''
repl='''    const seq = stopTimesByTrip.get(routeTripId) || [];
    drawSelectedStations(routeTripId, seq);

    // Pour SNCF/TGV/ICE : si TOUTES les paires d'arrêts sont validées dans
    // MooRail, ce tracé devient prioritaire sur match-path V2. CFL conserve
    // sa shape GTFS officielle comme autorité.
    const lbSelectedData = trainDataById.get(trainId) || buildStaticPanelTrainData(trainId);
    const lbSelectedSource = String(lbSelectedData?.source || '').toUpperCase();
    if(lbSelectedSource !== 'CFL'){
      try{ await lbRefreshMoorailForSelectedRoute(); }catch(_){}
      if(drawToken !== selectedTripDrawToken || activeTripId !== trainId) return;
      const lbMoorailSelected = lbMoorailSelectedFullRoute(seq);
      if(lbMoorailSelected){
        selectedTripRailPathCache.set(routeTripId, lbMoorailSelected.coords);
        addSelectedLatLonPath(lbMoorailSelected.coords);
        focusSelectedRoute(lbMoorailSelected.coords);
        console.info('[MOO RAIL V5.2] trajet sélectionné validé', trainId, lbMoorailSelected.sectionIds);
        return;
      }
    }

    const cachedRoute = selectedTripRailPathCache.get(routeTripId);'''
if needle not in s:
    raise SystemExit(f'ERREUR corps drawSelectedTripRoute inattendu dans {p}')
s=s.replace(needle,repl,1)

p.write_text(s,encoding='utf-8')
print('Patché :',p)
PY
done

echo "=== 3/5 Contrôles statiques ==="
for f in "${TARGETS[@]}"; do
  grep -qF 'LB_MOORAIL_SELECTED_ROUTE_V52' "$f"
  grep -qF 'const lbMoorailSelected = lbMoorailSelectedFullRoute(seq);' "$f"
  grep -qF "lbSelectedSource !== 'CFL'" "$f"
done

echo "=== 4/5 Redémarrage + contrôle page servie ==="
RESTARTED=1
systemctl restart "$SERVICE"
for _ in $(seq 1 30); do
  if systemctl is-active --quiet "$SERVICE" && curl -fsS --max-time 2 http://127.0.0.1:3111/api/map-v2/health >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
systemctl is-active --quiet "$SERVICE"
curl -fsS --max-time 10 http://127.0.0.1:3111/map-v2/carte-core-canonical-v4-preview.html -o "$TMP/page.html"
grep -qF 'LB_MOORAIL_SELECTED_ROUTE_V52' "$TMP/page.html"

HEALTH="$(curl -fsS --max-time 5 http://127.0.0.1:3111/api/map-v2/health)"
echo "Health : $HEALTH"

echo "=== 5/5 Vérification ICE 9577 dans les sections live ==="
python3 - <<'PY'
import json,urllib.request,unicodedata

def get(url):
    return json.load(urllib.request.urlopen(url,timeout=10))
def norm(s):
    s=unicodedata.normalize('NFKD',str(s or ''))
    return ''.join(c for c in s if not unicodedata.combining(c)).strip().lower()

cat=get('http://127.0.0.1:3111/api/map-v2/route-editor/catalog')
live=get('http://127.0.0.1:3111/data/moorail-live-v1/sections.json')
pairs={(norm(x.get('from')),norm(x.get('to'))) for x in (live.get('pairs') or [])}
hits=[]
for r in cat.get('routes') or []:
    if '9577' not in [str(x) for x in (r.get('trainNumbers') or [])]: continue
    stops=r.get('stops') or []
    ok=bool(stops) and all((norm(a.get('name')),norm(b.get('name'))) in pairs for a,b in zip(stops,stops[1:]))
    hits.append((r.get('id'),ok,r.get('signature')))
print('Variantes 9577 :',len(hits))
for rid,ok,sig in hits:
    print(' ', '✅ TRACE MOO RAIL COMPLET' if ok else '🟡 PARTIEL', rid, '|',sig)
assert any(ok for _,ok,_ in hits), 'Aucune variante 9577 entièrement couverte par MooRail'
PY

SUCCESS=1
trap - EXIT
cleanup

echo
echo "============================================================"
echo " MOO RAIL V5.2 INSTALLE"
echo "============================================================"
echo "Quand un trajet sélectionné est couvert à 100 % par les"
echo "sections MooRail, le tracé jaune utilise maintenant MooRail"
echo "AVANT match-path V2. Les shapes CFL officielles restent"
echo "inchangées."
echo "Backup : $BACKUP"
echo "============================================================"
