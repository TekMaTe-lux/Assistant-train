#!/usr/bin/env bash
set -euo pipefail

ROOT="/opt/labetaillere-map-v2-src/map-v2"
PREVIEW="$ROOT/public/carte-core-canonical-v4-preview.html"
SERVICE="labetaillere-map-v2.service"
EXPECTED_SHA="ddfeca4d55da02ec4bd8efe5340cf4d4501861259a3cc5bc6072b9ca36f1a857"
MARKER="LB_CFL_OFFICIAL_MOTION_V3"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$ROOT/backups/cfl-official-motion-v3-$STAMP"
SUCCESS=0
RESTARTED=0

rollback(){
  if [[ "$SUCCESS" -eq 1 ]]; then return; fi
  echo
  echo "ERREUR : rollback de la preview..."
  if [[ -f "$BACKUP/carte-core-canonical-v4-preview.html" ]]; then
    cp -a "$BACKUP/carte-core-canonical-v4-preview.html" "$PREVIEW"
  fi
  if [[ "$RESTARTED" -eq 1 ]]; then
    systemctl restart "$SERVICE" >/dev/null 2>&1 || true
  fi
}
trap rollback EXIT

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  echo "ERREUR : lancer avec sudo/root" >&2
  exit 2
fi

[[ -f "$PREVIEW" ]] || { echo "ERREUR : preview absente: $PREVIEW" >&2; exit 3; }
mkdir -p "$BACKUP"
cp -a "$PREVIEW" "$BACKUP/carte-core-canonical-v4-preview.html"

CURRENT_SHA="$(sha256sum "$PREVIEW" | awk '{print $1}')"
if grep -q "$MARKER" "$PREVIEW"; then
  echo "Correctif V3 déjà présent."
  SUCCESS=1
  exit 0
fi

if [[ "$CURRENT_SHA" != "$EXPECTED_SHA" ]]; then
  echo "ERREUR : la preview a changé depuis l'audit." >&2
  echo "Attendu : $EXPECTED_SHA" >&2
  echo "Trouvé  : $CURRENT_SHA" >&2
  echo "Aucune modification appliquée." >&2
  exit 4
fi

echo "=== 1/4 Patch de la vraie preview utilisée ==="
python3 - "$PREVIEW" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
text = path.read_text(encoding="utf-8")

def rep(old, new, label):
    global text
    n = text.count(old)
    if n != 1:
        raise SystemExit(f"ancre {label}: {n} occurrence(s)")
    text = text.replace(old, new, 1)

helper = r'''
  /* LB_CFL_OFFICIAL_MOTION_V3
   * - Les points techniques CFL restent utiles dans le GTFS source mais ne
   *   sont jamais des arrêts voyageurs dans la carte.
   * - Le mouvement des trains CFL suit en priorité la shape GTFS officielle
   *   exacte du trip. Le graphe ferroviaire n'est plus autoritaire pour CFL.
   */
  function lbIsTechnicalCflStopName(value){
    const raw = String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .trim();
    if (/(^|[^A-Z0-9])(FRONTIERE|FRONTIER|DOUANE|GRENZ)($|[^A-Z0-9])/.test(raw)) return true;
    return /(^|[-\s])GR\.?$/.test(raw);
  }

  function lbIsTechnicalCflStopTime(stopTime){
    if (!stopTime) return false;
    const pickup = String(stopTime.pickup_type ?? stopTime.pickupType ?? '0');
    const dropoff = String(stopTime.drop_off_type ?? stopTime.dropOffType ?? stopTime.dropoff_type ?? '0');
    if (pickup === '1' && dropoff === '1') return true;
    const meta = stopsById.get(stopTime.stop_id);
    return lbIsTechnicalCflStopName(meta?.name);
  }

  function sanitizeTechnicalCflStopTimes(){
    let removed = 0;
    for (const [tripId, seq] of stopTimesByTrip.entries()){
      if (!Array.isArray(seq) || seq.length < 2) continue;
      const trip = tripsById.get(tripId) || {};
      const isCfl = /^CFL:/i.test(String(tripId)) || String(trip.source || '').toUpperCase() === 'CFL';
      if (!isCfl) continue;
      const filtered = seq.filter(item => !lbIsTechnicalCflStopTime(item));
      if (filtered.length >= 2 && filtered.length !== seq.length){
        removed += seq.length - filtered.length;
        stopTimesByTrip.set(tripId, filtered);
      }
    }
    if (removed) console.info('[BER CFL] points techniques masqués :', removed);
    return removed;
  }

  const lbCflOfficialMotionState = new Map();

  function lbPrepareOfficialCflMotion(tripId, seq){
    const key = String(tripId || '');
    if (!/^CFL:/i.test(key)) return null;
    if (lbCflOfficialMotionState.has(key)) return lbCflOfficialMotionState.get(key);

    const state = { status:'pending', route:null, indices:null };
    lbCflOfficialMotionState.set(key, state);

    Promise.resolve(fetchOfficialCflTripShape(tripId, seq))
      .then(route => {
        if (!Array.isArray(route) || route.length < 2){
          state.status = 'missing';
          return;
        }
        const indices = [];
        let cursor = 0;
        for (const stopTime of seq){
          const stop = stopsById.get(stopTime?.stop_id);
          if (!stop){ state.status = 'missing'; return; }
          let best = -1;
          let bestDistance = Infinity;
          for (let i = cursor; i < route.length; i++){
            const distance = distLL(
              { lat:stop.lat, lon:stop.lon },
              { lat:route[i][0], lon:route[i][1] }
            );
            if (distance < bestDistance){
              bestDistance = distance;
              best = i;
            }
          }
          if (best < 0 || !Number.isFinite(bestDistance) || bestDistance > 1500){
            state.status = 'missing';
            return;
          }
          indices.push(best);
          cursor = best;
        }
        state.route = route;
        state.indices = indices;
        state.status = 'ready';
      })
      .catch(error => {
        console.warn('[BER CFL MOTION] shape indisponible', key, error);
        state.status = 'missing';
      });

    return state;
  }

  function lbOfficialCflSegmentPath(tripId, seq, segmentIndex){
    const key = String(tripId || '');
    let state = lbCflOfficialMotionState.get(key);
    if (!state) state = lbPrepareOfficialCflMotion(tripId, seq);
    if (!state) return { pending:false, path:null };
    if (state.status === 'pending') return { pending:true, path:null };
    if (state.status !== 'ready') return { pending:false, path:null };

    const fromIndex = state.indices?.[segmentIndex];
    const toIndex = state.indices?.[segmentIndex + 1];
    if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex) || toIndex <= fromIndex){
      return { pending:false, path:null };
    }
    const coords = state.route.slice(fromIndex, toIndex + 1);
    if (coords.length < 2) return { pending:false, path:null };
    return { pending:false, path:makePath(coords, false) };
  }

'''
anchor = "  async function fetchOfficialCflTripShape(routeTripId, seq){\n"
if anchor not in text:
    raise SystemExit("ancre fetchOfficialCflTripShape introuvable")
text = text.replace(anchor, helper + anchor, 1)

# Fallback réellement utilisé aujourd'hui : le cache du 05/05 est rejeté,
# puis integrateCflGtfs charge le GTFS CFL courant.
rep(
    "      await integrateCflGtfs({ axisStopIds, axisTripIds, axisRouteIds, mergeActiveServices });\n"
    "      const cflStopsAdded = Math.max(0, stopsById.size - stopsBeforeCfl);",
    "      await integrateCflGtfs({ axisStopIds, axisTripIds, axisRouteIds, mergeActiveServices });\n"
    "      sanitizeTechnicalCflStopTimes();\n"
    "      const cflStopsAdded = Math.max(0, stopsById.size - stopsBeforeCfl);",
    "fallback CFL"
)

# Sécurité pour le jour où le cache statique sera à nouveau frais.
rep(
    "      rebuildStaticMergeData();\n"
    "      prepareStationMetadata();\n"
    "      renderAxisStations();\n\n"
    "      const c = payload.counters || {};",
    "      sanitizeTechnicalCflStopTimes();\n"
    "      rebuildStaticMergeData();\n"
    "      prepareStationMetadata();\n"
    "      renderAxisStations();\n\n"
    "      const c = payload.counters || {};",
    "cache statique"
)

old_motion = '''        const r=(nowSec - tA)/(tB - tA);
        const path = pathBetweenStops(sA, sB);
        const needsV2Position = !path || path.isFallback;

        /*
         * Le RFN publié contient encore des coupures topologiques.
         * Pour un TER SNCF uniquement, on crée l'entrée temporelle correcte,
         * puis tick() exigera une position V2 sur un vrai pathId avant rendu.
         * Aucun repli en ligne droite n'est autorisé.
         */
        if (needsV2Position && tripSource !== 'SNCF') break;

        const pos = needsV2Position
          ? railPointForStop(sA)
          : positionAlongPath(path, r);
'''
new_motion = '''        const r=(nowSec - tA)/(tB - tA);
        let path = null;
        if (String(tripSource || '').toUpperCase() === 'CFL'){
          const official = lbOfficialCflSegmentPath(trip_id, seq, i);
          /* Pendant le tout premier chargement de la shape, on préfère ne pas
             afficher le train pendant une fraction de cycle plutôt que le
             faire partir sur une mauvaise branche du graphe. */
          if (official.pending) break;
          path = official.path || pathBetweenStops(sA, sB);
        } else {
          path = pathBetweenStops(sA, sB);
        }
        const needsV2Position = !path || path.isFallback;

        /*
         * Le RFN publié contient encore des coupures topologiques.
         * Pour un TER SNCF uniquement, on crée l'entrée temporelle correcte,
         * puis tick() exigera une position V2 sur un vrai pathId avant rendu.
         * Aucun repli en ligne droite n'est autorisé.
         */
        if (needsV2Position && tripSource !== 'SNCF') break;

        const pos = needsV2Position
          ? railPointForStop(sA)
          : positionAlongPath(path, r);
'''
rep(old_motion, new_motion, "mouvement CFL")

for marker in (
    "LB_CFL_OFFICIAL_MOTION_V3",
    "sanitizeTechnicalCflStopTimes();",
    "lbOfficialCflSegmentPath(trip_id, seq, i)",
    "fetchOfficialCflTripShape(tripId, seq)",
):
    if marker not in text:
        raise SystemExit(f"validation patch impossible: {marker}")

path.write_text(text, encoding="utf-8")
print("preview patchée : points techniques masqués + mouvement CFL sur shape officielle")
PY

echo "=== 2/4 Vérification statique ==="
grep -q 'LB_CFL_OFFICIAL_MOTION_V3' "$PREVIEW"
grep -q 'sanitizeTechnicalCflStopTimes();' "$PREVIEW"
grep -q 'lbOfficialCflSegmentPath(trip_id, seq, i)' "$PREVIEW"
grep -q 'fetchOfficialCflTripShape(tripId, seq)' "$PREVIEW"

echo "=== 3/4 Redémarrage service carte ==="
RESTARTED=1
systemctl restart "$SERVICE"
sleep 2
systemctl is-active --quiet "$SERVICE"
echo "service actif"

echo "=== 4/4 Contrôle 86563 / shapes officielles ==="
python3 - <<'PY'
import json
from pathlib import Path
p=Path('/opt/labetaillere-map-v2-src/map-v2/public/data/cfl-rail-shapes/manifest.json')
obj=json.loads(p.read_text(encoding='utf-8'))
for trip in ('24331941','24331953'):
    print(f"{trip} -> shape {obj.get('trips',{}).get(trip)}")
PY

SUCCESS=1
trap - EXIT

echo
echo "OK : correctif CFL V3 installé."
echo "Le cache carte_static_today.json du 05/05 reste volontairement ignoré par la carte ;"
echo "le fallback GTFS courant est maintenant corrigé directement."
