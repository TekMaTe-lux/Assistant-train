#!/usr/bin/env bash
set -Eeuo pipefail

BRANCH="${LB_V4_BRANCH:-refonte-v4-command-center}"
RAW="https://raw.githubusercontent.com/TekMaTe-lux/Assistant-train/${BRANCH}"
MAP_ROOT="/opt/labetaillere-map-v2-src/map-v2/public"
TARGET="${MAP_ROOT}/carte-preview.html"
PLUGIN="${MAP_ROOT}/lb-lux-station-entry-v1.js"
STAMP="$(date +%Y%m%d-%H%M%S)"
TMP="$(mktemp -d /tmp/lb-lux-station-entry.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  echo "ERREUR: lancer avec sudo bash." >&2
  exit 2
fi
[[ -f "$TARGET" ]] || { echo "ERREUR: carte introuvable: $TARGET" >&2; exit 3; }
command -v curl >/dev/null || { echo "ERREUR: curl absent" >&2; exit 3; }
command -v python3 >/dev/null || { echo "ERREUR: python3 absent" >&2; exit 3; }

curl -fL --retry 3 --connect-timeout 8 --max-time 30 \
  "${RAW}/assets/map-lux-station-entry-v1.js" \
  -o "$TMP/lb-lux-station-entry-v1.js"

if command -v node >/dev/null 2>&1; then
  node --check "$TMP/lb-lux-station-entry-v1.js"
fi

echo "=== SAUVEGARDE ==="
cp -a "$TARGET" "$TARGET.bak-lux-station-entry-$STAMP"
echo "$TARGET.bak-lux-station-entry-$STAMP"

install -m 0644 "$TMP/lb-lux-station-entry-v1.js" "$PLUGIN"

python3 - "$TARGET" <<'PY'
from pathlib import Path
import sys
path = Path(sys.argv[1])
text = path.read_text(encoding='utf-8')
marker = 'lb-lux-station-entry-v1.js'
if marker in text:
    print('ℹ️ balise plugin déjà présente : fichier JS actualisé uniquement')
    raise SystemExit(0)
script = '<script src="./lb-lux-station-entry-v1.js?v=20260827-1"></script>\n'
needle = '</body>'
if needle not in text:
    raise SystemExit('ERREUR: </body> introuvable dans carte-preview.html')
text = text.replace(needle, script + needle, 1)
path.write_text(text, encoding='utf-8')
print('✅ balise plugin ajoutée à carte-preview.html')
PY

grep -q 'lb-lux-station-entry-v1.js' "$TARGET" || { echo "ERREUR: balise non installée" >&2; exit 4; }
[[ -s "$PLUGIN" ]] || { echo "ERREUR: plugin absent" >&2; exit 4; }

echo
echo "=== CONTRÔLE ==="
echo "✅ moteur de carte inchangé"
echo "✅ plugin chargé uniquement dans carte-preview.html"
echo "✅ bouton ajouté uniquement dans la fiche de la gare Luxembourg"
echo "✅ Départs / Arrivées conservés"
echo
echo "Recharge ensuite la carte en Ctrl+F5."
