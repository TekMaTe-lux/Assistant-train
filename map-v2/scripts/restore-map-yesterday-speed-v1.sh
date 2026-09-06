#!/usr/bin/env bash
set -euo pipefail

ROOT="${LB_MAP_ROOT:-/opt/labetaillere-map-v2-src}"
PUBLIC="$ROOT/map-v2/public"
CORE="$PUBLIC/carte-core-preview.html"
BUILDER="$ROOT/map-v2/scripts/build-map-lite-cache.py"
CACHE="$PUBLIC/data/carte_static_lite_today.json"
V1="$PUBLIC/assets/lb-community-traveler-v1.js"
V2="$PUBLIC/assets/lb-community-traveler-compact-v2.js"
STAMP="$(date +%Y%m%d-%H%M%S-%N)"
BACKUP_DIR="$ROOT/backups/restore-map-yesterday-speed-v1-$STAMP"
TMP="$(mktemp -d /tmp/lb-restore-yesterday-map-XXXXXX)"
SUCCESS=0

cleanup(){ rm -rf "$TMP"; }
rollback(){
  if [[ "$SUCCESS" -eq 1 ]]; then return; fi
  echo
  echo "ERREUR — rollback automatique..." >&2
  for f in "$CORE" "$BUILDER" "$CACHE" "$V1" "$V2"; do
    base="$(basename "$f")"
    if [[ -f "$BACKUP_DIR/$base" ]]; then
      cp -a "$BACKUP_DIR/$base" "$f"
    fi
  done
  echo "Rollback terminé." >&2
}
trap 'rollback; cleanup' EXIT

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  echo "ERREUR: lancer avec sudo/root" >&2
  exit 2
fi

for f in "$CORE" "$BUILDER" "$V1" "$V2"; do
  [[ -f "$f" ]] || { echo "ERREUR: fichier absent: $f" >&2; exit 3; }
done

# Trouver la dernière vraie sauvegarde pré-V2 du core : elle doit contenir V1
# et surtout ne pas contenir le moteur J-1/J/J+1 V2.
CORE_OLD=""
while IFS= read -r candidate; do
  [[ -n "$candidate" ]] || continue
  if grep -q 'LB_SERVICE_DAY_ROLLOVER_V1' "$candidate" \
     && ! grep -q 'LB_SERVICE_DAY_ROLLOVER_V2' "$candidate"; then
    CORE_OLD="$candidate"
    break
  fi
done < <(find "$PUBLIC" -maxdepth 1 -type f -name 'carte-core-preview.html.bak-service-day-rollover-v2-*' -printf '%T@ %p\n' 2>/dev/null | sort -nr | cut -d' ' -f2-)

BUILDER_OLD=""
while IFS= read -r candidate; do
  [[ -n "$candidate" ]] || continue
  if ! grep -q 'LB_SERVICE_DAY_CACHE_WINDOW_V2' "$candidate"; then
    BUILDER_OLD="$candidate"
    break
  fi
done < <(find "$(dirname "$BUILDER")" -maxdepth 1 -type f -name 'build-map-lite-cache.py.bak-service-day-rollover-v2-*' -printf '%T@ %p\n' 2>/dev/null | sort -nr | cut -d' ' -f2-)

[[ -n "$CORE_OLD" && -f "$CORE_OLD" ]] || {
  echo "ERREUR: aucune sauvegarde core pré-V2 sûre trouvée." >&2
  exit 4
}
[[ -n "$BUILDER_OLD" && -f "$BUILDER_OLD" ]] || {
  echo "ERREUR: aucune sauvegarde générateur pré-V2 sûre trouvée." >&2
  exit 5
}

mkdir -p "$BACKUP_DIR"
for f in "$CORE" "$BUILDER" "$V1" "$V2"; do cp -a "$f" "$BACKUP_DIR/$(basename "$f")"; done
[[ -f "$CACHE" ]] && cp -a "$CACHE" "$BACKUP_DIR/$(basename "$CACHE")"

printf '%s\n' "============================================================"
printf '%s\n' "RESTAURATION CARTE — MOTEUR RAPIDE D'HIER"
printf '%s\n' "============================================================"
printf 'Core source pré-V2 : %s\n' "$CORE_OLD"
printf 'Builder pré-V2     : %s\n' "$BUILDER_OLD"
printf 'Backup actuel      : %s\n' "$BACKUP_DIR"
printf '\n'

# Restaurer uniquement le moteur carte et son cache statique journalier.
cp -a "$CORE_OLD" "$CORE"
cp -a "$BUILDER_OLD" "$BUILDER"

# Garde-fous avant toute reconstruction.
grep -q 'LB_SERVICE_DAY_ROLLOVER_V1' "$CORE" || {
  echo "ERREUR: V1 absent du core restauré" >&2; exit 6;
}
! grep -q 'LB_SERVICE_DAY_ROLLOVER_V2' "$CORE" || {
  echo "ERREUR: V2 encore présent dans le core restauré" >&2; exit 7;
}
! grep -q 'LB_SERVICE_DAY_CACHE_WINDOW_V2' "$BUILDER" || {
  echo "ERREUR: builder V2 encore présent" >&2; exit 8;
}

python3 -m py_compile "$BUILDER"
python3 "$BUILDER"

[[ -s "$CACHE" ]] || { echo "ERREUR: cache carte non reconstruit" >&2; exit 9; }

# Réappliquer de façon idempotente l'optimisation communautaire actuelle
# directement depuis origin/main, même en sparse-checkout.
git -C "$ROOT" show origin/main:vps/map-v2/install-community-fast-marker-stack-v1.sh > "$TMP/community-fast.sh"
chmod 700 "$TMP/community-fast.sh"
LB_MAP_ROOT="$ROOT" bash "$TMP/community-fast.sh"

# Vérifications finales : moteur d'hier + fonctions communautaires actuelles.
grep -q 'LB_SERVICE_DAY_ROLLOVER_V1' "$CORE"
! grep -q 'LB_SERVICE_DAY_ROLLOVER_V2' "$CORE"
grep -q 'LB_COMMUNITY_MARKER_STACK_CSS_V1' "$CORE"
grep -q 'LB_COMMUNITY_FAST_MARKER_STACK_V1: pas de rescan global par icône' "$V1"
grep -q 'LB_COMMUNITY_FAST_MARKER_STACK_V1: rendu déjà final, aucun rescan par icône' "$V2"
! grep -q 'queueMicrotask(scheduleMarkerRefresh);' "$V1"
! grep -q 'requestAnimationFrame(decorateMarkerBadges)' "$V2"

python3 - "$CACHE" <<'PY'
import json, os, sys
p=sys.argv[1]
data=json.load(open(p, encoding='utf-8'))
print('Cache carte:', os.path.getsize(p), 'octets')
print('Date:', data.get('date'))
print('service_days:', 'présent' if data.get('service_days') else 'absent (mode rapide journalier)')
print('activeServiceIds:', len((data.get('data') or {}).get('activeServiceIds') or data.get('activeServiceIds') or []))
PY

SUCCESS=1
trap - EXIT
cleanup

printf '\n%s\n' "============================================================"
printf '%s\n' "OK — CARTE RESTAUREE SUR LE MOTEUR RAPIDE D'HIER"
printf '%s\n' "============================================================"
printf 'J/J+1 favoris        : NON TOUCHE\n'
printf 'Communautaire        : CONSERVE\n'
printf 'Mises en page        : CONSERVEES\n'
printf 'Gare Luxembourg      : NON TOUCHEE\n'
printf 'Service VPS          : NON REDEMARRE\n'
printf 'Backup rollback      : %s\n' "$BACKUP_DIR"
printf 'Core SHA             : %s\n' "$(sha256sum "$CORE" | awk '{print $1}')"
printf 'Cache                : %s octets\n' "$(stat -c%s "$CACHE")"
printf '%s\n' "============================================================"
