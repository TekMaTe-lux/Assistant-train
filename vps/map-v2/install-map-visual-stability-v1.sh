#!/usr/bin/env bash
set -euo pipefail

ROOT="${LB_MAP_ROOT:-/opt/labetaillere-map-v2-src}"
CORE="$ROOT/map-v2/public/carte-core-preview.html"
ASSET_DIR="$ROOT/map-v2/public/assets"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_JS="$SCRIPT_DIR/lb-map-visual-stability-v1.js"
TARGET_JS="$ASSET_DIR/lb-map-visual-stability-v1.js"
STAMP="$(date +%Y%m%d-%H%M%S-%N)"
BACKUP="$CORE.bak-map-visual-stability-v1-$STAMP"

[[ -f "$CORE" ]] || { echo "ERREUR: carte introuvable: $CORE" >&2; exit 2; }
[[ -f "$SOURCE_JS" ]] || { echo "ERREUR: correctif introuvable: $SOURCE_JS" >&2; exit 3; }

cp -a "$CORE" "$BACKUP"
install -d -m 0755 "$ASSET_DIR"
install -m 0644 "$SOURCE_JS" "$TARGET_JS"

node --check "$TARGET_JS"

python3 - "$CORE" <<'PY'
from pathlib import Path
import re
import sys

path = Path(sys.argv[1])
text = path.read_text(encoding='utf-8')
marker = '<script id="lb-map-visual-stability-v1" src="./assets/lb-map-visual-stability-v1.js?v=20260905-1"></script>'

# Idempotent : retire uniquement une éventuelle ancienne version de CE script.
text = re.sub(
    r'\s*<script id="lb-map-visual-stability-v1" src="\./assets/lb-map-visual-stability-v1\.js\?v=[^"]+"></script>',
    '',
    text,
)

# Le correctif doit passer après la couche communautaire compacte afin de ne
# corriger que la géométrie finale du badge et le fallback du header.
compact = re.search(
    r'<script id="lb-community-traveler-compact-v2" src="\./assets/lb-community-traveler-compact-v2\.js\?v=[^"]+"></script>',
    text,
)
if compact:
    pos = compact.end()
    text = text[:pos] + '\n' + marker + text[pos:]
else:
    closing = text.lower().rfind('</body>')
    if closing < 0:
        raise SystemExit('ERREUR: balise </body> absente du core')
    text = text[:closing] + marker + '\n' + text[closing:]

if text.count('id="lb-map-visual-stability-v1"') != 1:
    raise SystemExit('ERREUR: raccordement visual stability non unique')

path.write_text(text, encoding='utf-8')
PY

grep -q 'id="lb-map-visual-stability-v1"' "$CORE" || { echo "ERREUR: correctif non raccordé" >&2; exit 4; }
grep -q '__LB_MAP_VISUAL_STABILITY_V1__' "$TARGET_JS" || { echo "ERREUR: correctif copié invalide" >&2; exit 5; }

echo "Installation terminée."
echo "Sauvegarde: $BACKUP"
echo "Core: $(sha256sum "$CORE" | awk '{print $1}')"
echo "Correctif visuel: $(sha256sum "$TARGET_JS" | awk '{print $1}')"
echo "Retour arrière: cp '$BACKUP' '$CORE'"
