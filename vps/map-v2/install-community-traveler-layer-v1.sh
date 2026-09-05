#!/usr/bin/env bash
set -euo pipefail

ROOT="${LB_MAP_ROOT:-/opt/labetaillere-map-v2-src}"
CORE="$ROOT/map-v2/public/carte-core-preview.html"
ASSET_DIR="$ROOT/map-v2/public/assets"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_JS="$SCRIPT_DIR/lb-community-traveler-v1.js"
TARGET_JS="$ASSET_DIR/lb-community-traveler-v1.js"
COMPACT_SOURCE_JS="$SCRIPT_DIR/lb-community-traveler-compact-v2.js"
COMPACT_TARGET_JS="$ASSET_DIR/lb-community-traveler-compact-v2.js"
STAMP="$(date +%Y%m%d-%H%M%S-%N)"
BACKUP="$CORE.bak-community-traveler-v1-$STAMP"

[[ -f "$CORE" ]] || { echo "ERREUR: carte introuvable: $CORE" >&2; exit 2; }
[[ -f "$SOURCE_JS" ]] || { echo "ERREUR: module introuvable: $SOURCE_JS" >&2; exit 3; }
[[ -f "$COMPACT_SOURCE_JS" ]] || { echo "ERREUR: module compact introuvable: $COMPACT_SOURCE_JS" >&2; exit 6; }

cp -a "$CORE" "$BACKUP"
install -d -m 0755 "$ASSET_DIR"
install -m 0644 "$SOURCE_JS" "$TARGET_JS"
install -m 0644 "$COMPACT_SOURCE_JS" "$COMPACT_TARGET_JS"

python3 - "$CORE" <<'PY'
from pathlib import Path
import re
import sys

path = Path(sys.argv[1])
text = path.read_text(encoding="utf-8")
marker_v1 = '<script id="lb-community-traveler-v1" src="./assets/lb-community-traveler-v1.js?v=20260905-5"></script>'
marker_v2 = '<script id="lb-community-traveler-compact-v2" src="./assets/lb-community-traveler-compact-v2.js?v=20260905-4"></script>'

text = re.sub(
    r'<script id="lb-community-traveler-v1" src="\./assets/lb-community-traveler-v1\.js\?v=[^"]+"></script>',
    marker_v1,
    text,
)
text = re.sub(
    r'\s*<script id="lb-community-traveler-compact-v2" src="\./assets/lb-community-traveler-compact-v2\.js\?v=[^"]+"></script>',
    '',
    text,
)

if marker_v1 in text:
    text = text.replace(marker_v1, marker_v1 + "\n" + marker_v2, 1)
else:
    closing = text.lower().rfind("</body>")
    if closing < 0:
        raise SystemExit("ERREUR: balise </body> absente du core")
    text = text[:closing] + marker_v1 + "\n" + marker_v2 + "\n" + text[closing:]

path.write_text(text, encoding="utf-8")
PY

grep -q 'id="lb-community-traveler-v1"' "$CORE" || { echo "ERREUR: module V1 non raccordé" >&2; exit 4; }
grep -q 'id="lb-community-traveler-compact-v2"' "$CORE" || { echo "ERREUR: module compact non raccordé" >&2; exit 7; }
grep -q '__LB_COMMUNITY_TRAVELER_MAP_V1__' "$TARGET_JS" || { echo "ERREUR: module V1 copié invalide" >&2; exit 5; }
grep -q '__LB_COMMUNITY_TRAVELER_COMPACT_V2__' "$COMPACT_TARGET_JS" || { echo "ERREUR: module compact copié invalide" >&2; exit 8; }

echo "Installation terminée."
echo "Sauvegarde: $BACKUP"
echo "Core: $(sha256sum "$CORE" | awk '{print $1}')"
echo "Module V1: $(sha256sum "$TARGET_JS" | awk '{print $1}')"
echo "Module compact V2: $(sha256sum "$COMPACT_TARGET_JS" | awk '{print $1}')"
echo "Retour arrière: cp '$BACKUP' '$CORE'"
