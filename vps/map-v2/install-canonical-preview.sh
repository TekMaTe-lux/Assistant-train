#!/usr/bin/env bash
set -euo pipefail

SOURCE="/opt/labetaillere-map-v2-src/map-v2/public/carte-core-preview.html"
DEST="/opt/labetaillere-map-v2-src/map-v2/public/carte-core-canonical-v4-preview.html"
SNAPSHOT="/opt/labetaillere-map-v2-src/map-v2/public/v4-preview/data/snapshot.json"
HEALTH="http://127.0.0.1:3120/api/v4/health"
STAMP="$(date +%Y%m%d-%H%M%S)"
TMP="$(mktemp -d /tmp/lb-map-canonical-preview.XXXXXX)"
BACKUP_DIR="/opt/labetaillere-map-v2-src/map-v2/backups/canonical-map-preview-$STAMP"

cleanup(){ rm -rf "$TMP"; }
trap cleanup EXIT

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  echo "ERREUR: lancer avec sudo/root" >&2
  exit 2
fi

[[ -f "$SOURCE" ]] || { echo "ERREUR: source carte absente: $SOURCE" >&2; exit 3; }
[[ -f "$SNAPSHOT" ]] || { echo "ERREUR: snapshot V4 absent: $SNAPSHOT" >&2; exit 4; }

SOURCE_SIZE=$(stat -c%s "$SOURCE")
if (( SOURCE_SIZE < 300000 )); then
  echo "ERREUR: carte source anormalement petite ($SOURCE_SIZE octets)" >&2
  exit 5
fi

SOURCE_SHA_BEFORE=$(sha256sum "$SOURCE" | awk '{print $1}')

# Le moteur canonique doit être sain avant de fabriquer une prévisualisation.
curl -fsS "$HEALTH" -o "$TMP/health.json"
python3 - "$TMP/health.json" "$SNAPSHOT" <<'PY'
import json,sys
health=json.load(open(sys.argv[1],encoding='utf-8'))
snap=json.load(open(sys.argv[2],encoding='utf-8'))
assert health.get('schemaVersion') == '4.1-canonical', health
assert health.get('status') in ('ok','degraded'), health
assert int(health.get('trainCount') or 0) > 0, health
assert snap.get('schemaVersion') == '4.1-canonical', snap.get('schemaVersion')
trains=snap.get('trains') or []
assert trains, 'snapshot V4 sans train actif'
usable=known_zero=cancelled=fr=lu=0
for train in trains:
    if train.get('realtimePresenceFresh') is False:
        continue
    for stop in train.get('stops') or []:
        if (stop.get('delay') or {}).get('fresh') is False:
            continue
        if stop.get('cancelled') is True:
            usable += 1; cancelled += 1
        elif stop.get('realtimeKnown') is True and isinstance(stop.get('delayMinutes'),(int,float)) and not isinstance(stop.get('delayMinutes'),bool):
            usable += 1
            if float(stop.get('delayMinutes')) == 0:
                known_zero += 1
        else:
            continue
        if stop.get('country') == 'FR': fr += 1
        if stop.get('country') == 'LU': lu += 1
assert usable > 0, 'aucune donnée temps réel canonique exploitable'
print(f"V4 OK: {len(trains)} trains actifs · {usable} arrêts RT exploitables · {known_zero} zéros connus · {cancelled} suppressions · FR={fr} · LU={lu}")
PY

mkdir -p "$BACKUP_DIR"
if [[ -f "$DEST" ]]; then
  cp -a "$DEST" "$BACKUP_DIR/$(basename "$DEST")"
fi
cp -a "$SOURCE" "$TMP/carte-core-canonical-v4-preview.html"

python3 - "$TMP/carte-core-canonical-v4-preview.html" <<'PY'
from pathlib import Path
import re,sys

path=Path(sys.argv[1])
text=path.read_text(encoding='utf-8')

MARK='LB_CANONICAL_MAP_PREVIEW_V1'
if MARK in text:
    raise SystemExit('ERREUR: la source de production contient déjà le marqueur preview canonique')

def replace_once(old,new,label):
    global text
    count=text.count(old)
    if count != 1:
        raise SystemExit(f"ERREUR patch {label}: ancre trouvée {count} fois")
    text=text.replace(old,new,1)

replace_once(
    "  const DEFAULT_REALTIME_SOURCE_ORDER = ['sncf','gtfs','hafas'];\n"
    "  const CFL_REALTIME_SOURCE_ORDER = ['hafas','sncf','gtfs'];\n"
    "  const REALTIME_STATUS_DISPLAY_ORDER = ['sncf','hafas','gtfs'];\n"
    "  const REALTIME_SOURCE_PRIORITY = { sncf: 3, hafas: 2, gtfs: 1 };",
    "  const DEFAULT_REALTIME_SOURCE_ORDER = ['canonical','sncf','gtfs','hafas'];\n"
    "  const CFL_REALTIME_SOURCE_ORDER = ['canonical','hafas','sncf','gtfs'];\n"
    "  const REALTIME_STATUS_DISPLAY_ORDER = ['canonical','sncf','hafas','gtfs'];\n"
    "  const REALTIME_SOURCE_PRIORITY = { canonical: 100, sncf: 3, hafas: 2, gtfs: 1 };",
    'priorités sources'
)

replace_once(
    "  const realtimeSources = {\n    sncf:",
    "  const realtimeSources = {\n"
    "    canonical: { key:'canonical', displayName:'Data Engine V4', origin:'V4 canonique', map:new Map(), lastUpdated:null, rawSource:'', error:null },\n"
    "    sncf:",
    'source canonique'
)

replace_once(
    "    if (stationInfo?.isFrench) return ['sncf'];",
    "    if (stationInfo?.isFrench) return ['canonical','sncf','gtfs'];",
    'autorité gare française'
)

loader=r'''

  /* LB_CANONICAL_MAP_PREVIEW_V1
   * Prévisualisation uniquement : le moteur V4 devient la première source de
   * vérité pour le retard/suppression par arrêt. Les anciennes sources restent
   * présentes comme repli si V4 ne connaît pas un champ ou devient périmé.
   */
  const CANONICAL_V4_SNAPSHOT_URL = './v4-preview/data/snapshot.json';
  const CANONICAL_V4_REFRESH_MS = 15000;
  const CANONICAL_V4_MAX_AGE_MS = 120000;
  let canonicalRefreshTimer = null;
  let pendingCanonicalPromise = null;

  function canonicalMapStationAliases(value){
    const raw = String(value || '').trim();
    if (!raw) return [];
    const out = new Set([raw]);
    let base = raw
      .replace(/,\s*Gare(?:\s+Centrale)?\s*$/i, '')
      .replace(/^Belval\s*\(([^)]+)\)$/i, 'Belval-$1')
      .trim();
    if (base) {
      out.add(base);
      out.add(`${base}, Gare`);
    }
    if (/^Luxembourg$/i.test(base)) out.add('Luxembourg, Gare Centrale');
    const belval = base.match(/^Belval-(.+)$/i);
    if (belval) out.add(`Belval (${belval[1]}), Gare`);
    return Array.from(out).filter(Boolean);
  }

  function canonicalV4Timestamp(value){
    const ts = Date.parse(String(value || ''));
    return Number.isFinite(ts) ? ts : null;
  }

  function canonicalV4ClearIfStale(message){
    const src = realtimeSources.canonical;
    const age = Number.isFinite(src?.lastUpdated) ? Date.now() - src.lastUpdated : Infinity;
    if (age <= CANONICAL_V4_MAX_AGE_MS && src?.map instanceof Map && src.map.size) {
      src.error = message || 'rafraîchissement en échec';
      updateRealtimeStatus();
      return false;
    }
    if (src) {
      src.map = new Map();
      src.lastUpdated = null;
      src.error = message || 'indisponible';
    }
    rebuildRealtimeDelayIndex();
    scheduleRealtimeUiRefresh();
    return true;
  }

  function canonicalV4RegisterStop(perStation, stop, value){
    const aliases = canonicalMapStationAliases(stop?.name);
    for (const alias of aliases) {
      const before = new Set(perStation.keys());
      registerSncfStationEntry(perStation, alias, {}, value);
      for (const [key, entry] of perStation.entries()) {
        if (before.has(key) || !entry) continue;
        entry.original = stop?.name || alias;
        entry.source = 'Data Engine V4';
        entry.sourceKey = 'canonical';
        entry.canonicalAuthority = stop?.realtimeAuthority || null;
        entry.canonicalCountry = stop?.country || null;
        entry.canonicalQuality = stop?.delay?.quality || stop?.sourceQuality || null;
        entry.canonicalObservedAt = stop?.delay?.observedAt || null;
        entry.canonicalFresh = stop?.delay?.fresh !== false;
      }
    }
  }

  function registerCanonicalV4Snapshot(snapshot){
    if (!snapshot || snapshot.schemaVersion !== '4.1-canonical') {
      throw new Error('schéma V4 canonique inattendu');
    }
    const updatedAt = canonicalV4Timestamp(snapshot.updatedAt);
    if (!Number.isFinite(updatedAt)) throw new Error('timestamp V4 absent');
    if (Date.now() - updatedAt > CANONICAL_V4_MAX_AGE_MS) {
      throw new Error('snapshot V4 périmé');
    }

    const map = new Map();
    let trainCount = 0;
    let stopCount = 0;
    let knownZeroCount = 0;
    let cancellationCount = 0;

    for (const train of (Array.isArray(snapshot.trains) ? snapshot.trains : [])) {
      if (!train || train.realtimePresenceFresh === false) continue;
      const rawNum = train.number ?? train.trainNumber ?? null;
      const normalized = normalizeTrainNumberKey(rawNum) || (rawNum != null ? String(rawNum) : '');
      if (!normalized) continue;
      const perStation = new Map();

      for (const stop of (Array.isArray(train.stops) ? train.stops : [])) {
        if (!stop || !stop.name) continue;
        if (stop?.delay?.fresh === false) continue;
        let value;
        if (stop.cancelled === true) {
          value = null;
          cancellationCount++;
        } else if (stop.realtimeKnown === true && Number.isFinite(Number(stop.delayMinutes))) {
          value = Number(stop.delayMinutes);
          if (value === 0) knownZeroCount++;
        } else {
          continue;
        }
        canonicalV4RegisterStop(perStation, stop, value);
        stopCount++;
      }

      if (!perStation.size) continue;
      trainCount++;
      const targets = new Set([String(rawNum), String(normalized)]);
      try {
        for (const alt of equivalentTrainNumbers(normalized)) targets.add(String(alt));
      } catch(_){ }
      for (const key of targets) {
        if (key) map.set(key, perStation);
      }
    }

    const src = realtimeSources.canonical;
    src.map = map;
    src.lastUpdated = updatedAt;
    src.origin = 'V4 canonique';
    src.rawSource = CANONICAL_V4_SNAPSHOT_URL;
    src.error = null;
    rebuildRealtimeDelayIndex();
    scheduleRealtimeUiRefresh();
    console.info(`[BER MAP V4] ${trainCount} trains · ${stopCount} arrêts canoniques · ${knownZeroCount} zéros connus · ${cancellationCount} suppressions`);
    return { trainCount, stopCount, knownZeroCount, cancellationCount };
  }

  function loadCanonicalV4Realtime(){
    if (pendingCanonicalPromise) return pendingCanonicalPromise;
    pendingCanonicalPromise = (async()=>{
      try {
        const sep = CANONICAL_V4_SNAPSHOT_URL.includes('?') ? '&' : '?';
        const response = await fetch(`${CANONICAL_V4_SNAPSHOT_URL}${sep}t=${Date.now()}`, { cache:'no-store' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const snapshot = await response.json();
        return registerCanonicalV4Snapshot(snapshot);
      } catch(err) {
        canonicalV4ClearIfStale(err?.message || String(err));
        throw err;
      } finally {
        pendingCanonicalPromise = null;
      }
    })();
    return pendingCanonicalPromise;
  }
'''

replace_once(
    "  };\n  const sncfDisruptionsByTrain = new Map();",
    "  };" + loader + "\n  const sncfDisruptionsByTrain = new Map();",
    'loader canonique'
)

replace_once(
    "    const sncfPromise = loadSncfRealtime({ forceFresh: true }).catch(err => {",
    "    const canonicalPromise = loadCanonicalV4Realtime().catch(err => {\n"
    "      console.warn('[BER MAP V4] chargement initial indisponible', err);\n"
    "    });\n"
    "    const sncfPromise = loadSncfRealtime({ forceFresh: true }).catch(err => {",
    'boot canonique'
)

replace_once(
    "    gtfsPromise.finally(()=>{",
    "    canonicalPromise.finally(()=>{\n"
    "      if (canonicalRefreshTimer == null){\n"
    "        canonicalRefreshTimer = setInterval(()=>{\n"
    "          loadCanonicalV4Realtime().catch(err => console.warn('[BER MAP V4] rafraîchissement en échec', err));\n"
    "        }, CANONICAL_V4_REFRESH_MS);\n"
    "      }\n"
    "    });\n"
    "    gtfsPromise.finally(()=>{",
    'timer canonique'
)

if text.count(MARK) != 1:
    raise SystemExit(f'ERREUR: marqueur canonique final={text.count(MARK)}')
for needle in (
    "['canonical','sncf','gtfs','hafas']",
    "['canonical','hafas','sncf','gtfs']",
    "canonical: { key:'canonical'",
    "CANONICAL_V4_SNAPSHOT_URL = './v4-preview/data/snapshot.json'",
    "if (stationInfo?.isFrench) return ['canonical','sncf','gtfs'];",
):
    if needle not in text:
        raise SystemExit(f'ERREUR validation patch: {needle}')

path.write_text(text,encoding='utf-8')
print('Patch preview V4: OK')
PY

install -m 0644 "$TMP/carte-core-canonical-v4-preview.html" "$DEST"

SOURCE_SHA_AFTER=$(sha256sum "$SOURCE" | awk '{print $1}')
if [[ "$SOURCE_SHA_BEFORE" != "$SOURCE_SHA_AFTER" ]]; then
  echo "ERREUR CRITIQUE: la carte de production a changé pendant l'installation" >&2
  if [[ -f "$BACKUP_DIR/$(basename "$DEST")" ]]; then
    cp -a "$BACKUP_DIR/$(basename "$DEST")" "$DEST"
  else
    rm -f "$DEST"
  fi
  exit 6
fi

python3 - "$SOURCE" "$DEST" <<'PY'
from pathlib import Path
import sys
source=Path(sys.argv[1]).read_text(encoding='utf-8')
preview=Path(sys.argv[2]).read_text(encoding='utf-8')
assert 'LB_CANONICAL_MAP_PREVIEW_V1' not in source
assert preview.count('LB_CANONICAL_MAP_PREVIEW_V1') == 1
assert "['canonical','sncf','gtfs','hafas']" in preview
assert "['canonical','hafas','sncf','gtfs']" in preview
assert "canonical: { key:'canonical'" in preview
assert "CANONICAL_V4_SNAPSHOT_URL = './v4-preview/data/snapshot.json'" in preview
assert "SELECTED_TRAIN_MISSING_GRACE_MS = 30000" in preview
assert 'BER_SNCF_FRANCE_AUTHORITY_V2_START' in preview
assert 'BER_LUX_TERMINUS_DELAY_V9' in preview
print('Structure carte preview: OK')
PY

echo
echo "============================================================"
echo "CARTE CANONIQUE V4 — PREVIEW INSTALLEE"
echo "============================================================"
echo "Production intacte : $SOURCE"
echo "SHA production     : $SOURCE_SHA_AFTER"
echo "Preview            : $DEST"
echo "Backup précédent   : $BACKUP_DIR"
echo "URL                 : https://vps.labetaillere.fr/map-v2/carte-core-canonical-v4-preview.html"
echo "V4                  : priorité canonique + repli SNCF/GTFS-RT/HAFAS"
echo "Animation/chemins   : inchangés"
echo "Grâce sélection     : 30 s conservée"
echo "Gare Luxembourg     : logique dynamique non modifiée"
echo "============================================================"
