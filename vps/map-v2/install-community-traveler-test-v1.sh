#!/usr/bin/env bash
set -euo pipefail

ROOT="${LB_MAP_ROOT:-/opt/labetaillere-map-v2-src}"
PUBLIC="$ROOT/map-v2/public"
LIVE_CORE="$PUBLIC/carte-core-preview.html"
LIVE_WRAPPER="$PUBLIC/carte-preview.html"
TEST_CORE="$PUBLIC/carte-core-community-test-v1.html"
TEST_WRAPPER="$PUBLIC/carte-community-test-v1.html"
ASSET_DIR="$PUBLIC/assets"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_JS="$SCRIPT_DIR/lb-community-traveler-v1.js"
TARGET_JS="$ASSET_DIR/lb-community-traveler-v1.js"
STAMP="$(date +%Y%m%d-%H%M%S-%N)"

for required in "$LIVE_CORE" "$LIVE_WRAPPER" "$SOURCE_JS"; do
  [[ -f "$required" ]] || { echo "ERREUR: fichier introuvable: $required" >&2; exit 2; }
done

LIVE_CORE_BEFORE="$(sha256sum "$LIVE_CORE" | awk '{print $1}')"
LIVE_WRAPPER_BEFORE="$(sha256sum "$LIVE_WRAPPER" | awk '{print $1}')"

for target in "$TEST_CORE" "$TEST_WRAPPER" "$TARGET_JS"; do
  if [[ -f "$target" ]]; then
    cp -a "$target" "$target.bak-community-test-v1-$STAMP"
  fi
done

install -d -m 0755 "$ASSET_DIR"
cp -a "$LIVE_CORE" "$TEST_CORE"
cp -a "$LIVE_WRAPPER" "$TEST_WRAPPER"
install -m 0644 "$SOURCE_JS" "$TARGET_JS"

python3 - "$TEST_CORE" "$TEST_WRAPPER" <<'PY'
from pathlib import Path
import re
import sys

core = Path(sys.argv[1])
wrapper = Path(sys.argv[2])
marker = '<script id="lb-community-traveler-v1" src="./assets/lb-community-traveler-v1.js?v=20260905-1"></script>'

core_text = core.read_text(encoding="utf-8")
core_text = re.sub(
    r'\s*<script id="lb-community-traveler-v1"[^>]*></script>\s*',
    "\n",
    core_text,
    flags=re.IGNORECASE,
)
closing = core_text.lower().rfind("</body>")
if closing < 0:
    raise SystemExit("ERREUR: balise </body> absente du core de test")
core_text = core_text[:closing] + marker + "\n" + core_text[closing:]
core.write_text(core_text, encoding="utf-8")

wrapper_text = wrapper.read_text(encoding="utf-8")
updated, count = re.subn(
    r'carte-core-preview\.html(?:\?[^"\']*)?',
    'carte-core-community-test-v1.html?lbEmbedded=1&v=20260905-community-test-v1',
    wrapper_text,
)
if count != 1:
    raise SystemExit(f"ERREUR: référence au core inattendue dans le wrapper ({count})")
wrapper.write_text(updated, encoding="utf-8")
PY

grep -q 'id="lb-community-traveler-v1"' "$TEST_CORE" || { echo "ERREUR: module non raccordé" >&2; exit 3; }
grep -q 'carte-core-community-test-v1.html' "$TEST_WRAPPER" || { echo "ERREUR: wrapper de test non raccordé" >&2; exit 4; }
grep -q '__LB_COMMUNITY_TRAVELER_MAP_V1__' "$TARGET_JS" || { echo "ERREUR: module copié invalide" >&2; exit 5; }

[[ "$LIVE_CORE_BEFORE" == "$(sha256sum "$LIVE_CORE" | awk '{print $1}')" ]] || { echo "ERREUR: le core public a changé" >&2; exit 6; }
[[ "$LIVE_WRAPPER_BEFORE" == "$(sha256sum "$LIVE_WRAPPER" | awk '{print $1}')" ]] || { echo "ERREUR: le wrapper public a changé" >&2; exit 7; }

echo "Installation de test terminée; carte publique inchangée."
echo "URL: https://vps.labetaillere.fr/map-v2/carte-community-test-v1.html"
echo "Core test: $(sha256sum "$TEST_CORE" | awk '{print $1}')"
echo "Module: $(sha256sum "$TARGET_JS" | awk '{print $1}')"
echo "Suppression du test: rm -f '$TEST_CORE' '$TEST_WRAPPER'"
