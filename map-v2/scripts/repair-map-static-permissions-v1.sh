#!/usr/bin/env bash
set -euo pipefail

ROOT="${LB_MAP_ROOT:-/opt/labetaillere-map-v2-src}"
FILE="$ROOT/map-v2/public/data/carte_static_lite_today.json"
SERVICE="labetaillere-map-v2.service"

[[ -f "$FILE" ]] || { echo "ERREUR: cache absent: $FILE" >&2; exit 2; }

echo "=== AVANT ==="
stat -c 'mode=%a owner=%U group=%G size=%s path=%n' "$FILE"
namei -l "$FILE" 2>/dev/null || true
printf 'Lecture par ubuntu: '
if sudo -u ubuntu test -r "$FILE"; then echo OUI; else echo NON; fi

# Validation du contenu avant toute action. Aucune donnée n'est modifiée.
python3 - "$FILE" <<'PY'
import json, sys
with open(sys.argv[1], 'r', encoding='utf-8') as f:
    payload=json.load(f)
print('JSON valide:', type(payload).__name__)
PY

# Le service map-v2 tourne sous l'utilisateur ubuntu. Le cache statique doit donc
# être lisible par ce compte. On ne change ni le contenu ni le propriétaire.
chmod 0644 "$FILE"

# Les répertoires du chemin doivent être traversables. On ne touche qu'aux droits
# d'exécution/lecture nécessaires, jamais au contenu.
chmod a+rx "$ROOT/map-v2/public" "$ROOT/map-v2/public/data"

printf 'Lecture par ubuntu après correction: '
sudo -u ubuntu test -r "$FILE" && echo OUI || { echo NON; exit 3; }

echo "=== APRES ==="
stat -c 'mode=%a owner=%U group=%G size=%s path=%n' "$FILE"

# Le chmod est pris en compte immédiatement par le processus Node déjà actif :
# aucun redémarrage forcé n'est nécessaire.
printf 'Service: '
systemctl is-active "$SERVICE"

probe(){
  local label="$1" url="$2"
  printf '%-24s ' "$label"
  curl -sS --max-time 12 -o /dev/null -w 'code=%{http_code} ttfb=%{time_starttransfer}s total=%{time_total}s\n' "$url"
}

for i in 1 2 3; do
  echo "--- contrôle $i"
  probe "upstream static" "http://127.0.0.1:3111/data/carte_static_lite_today.json"
  probe "upstream api trains" "http://127.0.0.1:3111/api/map-v2/trains?bbox=5.70,48.45,6.35,49.65"
  probe "public static" "https://vps.labetaillere.fr/map-v2/data/carte_static_lite_today.json"
  probe "public api trains" "https://vps.labetaillere.fr/api/map-v2/trains?bbox=5.70,48.45,6.35,49.65"
  sleep 1
done

echo
echo "=== JOURNAL APRES TEST ==="
journalctl -u "$SERVICE" --since '-2 minutes' -n 60 --no-pager 2>/dev/null | tail -60 || true

echo
echo "REPARATION_TERMINEE — contenu du cache inchangé; permissions de lecture corrigées."
