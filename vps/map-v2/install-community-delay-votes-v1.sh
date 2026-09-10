#!/usr/bin/env bash
set -euo pipefail

ROOT="${LB_MAP_ROOT:-/opt/labetaillere-map-v2-src}"
PUBLIC="$ROOT/map-v2/public"
CORE="$PUBLIC/carte-core-preview.html"
ASSET_DIR="$PUBLIC/assets"
TARGET_JS="$ASSET_DIR/lb-community-traveler-vote-v1.js"
SOURCE_URL="${LB_VOTE_SOURCE_URL:-https://raw.githubusercontent.com/TekMaTe-lux/Assistant-train/main/vps/map-v2/lb-community-traveler-vote-v1.js}"
STAMP="$(date +%Y%m%d-%H%M%S-%N)"
BACKUP_DIR="$ROOT/map-v2/backups/community-delay-votes-v1-$STAMP"
TMP_JS="$(mktemp)"

cleanup(){ rm -f "$TMP_JS"; }
trap cleanup EXIT

[[ -f "$CORE" ]] || { echo "ERREUR: carte introuvable: $CORE" >&2; exit 2; }
install -d -m 0755 "$ASSET_DIR" "$BACKUP_DIR"
cp -a "$CORE" "$BACKUP_DIR/carte-core-preview.html"
[[ -f "$TARGET_JS" ]] && cp -a "$TARGET_JS" "$BACKUP_DIR/lb-community-traveler-vote-v1.js"

curl -fsSL "${SOURCE_URL}?v=${STAMP}" -o "$TMP_JS"
grep -q '__LB_COMMUNITY_TRAVELER_VOTE_V1__' "$TMP_JS" || {
  echo "ERREUR: module de vote téléchargé invalide" >&2
  exit 3
}
if command -v node >/dev/null 2>&1; then
  node --check "$TMP_JS"
fi
install -m 0644 "$TMP_JS" "$TARGET_JS"

python3 - "$CORE" <<'PY'
from pathlib import Path
import re
import sys

path = Path(sys.argv[1])
text = path.read_text(encoding='utf-8')
marker = '<script id="lb-community-traveler-vote-v1" src="./assets/lb-community-traveler-vote-v1.js?v=20260910-1"></script>'

# Idempotent : remplace toute ancienne version du même module.
text = re.sub(
    r'\s*<script id="lb-community-traveler-vote-v1" src="\./assets/lb-community-traveler-vote-v1\.js\?v=[^"]+"></script>',
    '',
    text,
)

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
        raise SystemExit('ERREUR: ni module compact V2 ni </body> trouvé')
    text = text[:closing] + marker + '\n' + text[closing:]

path.write_text(text, encoding='utf-8')
PY

grep -q 'id="lb-community-traveler-vote-v1"' "$CORE" || {
  echo "ERREUR: module de vote non raccordé au core" >&2
  cp -a "$BACKUP_DIR/carte-core-preview.html" "$CORE"
  exit 4
}
grep -q '__LB_COMMUNITY_TRAVELER_VOTE_V1__' "$TARGET_JS" || {
  echo "ERREUR: module installé invalide" >&2
  cp -a "$BACKUP_DIR/carte-core-preview.html" "$CORE"
  exit 5
}

# Vérification HTML minimale : une seule occurrence du module.
COUNT="$(grep -c 'id="lb-community-traveler-vote-v1"' "$CORE" || true)"
[[ "$COUNT" = "1" ]] || {
  echo "ERREUR: $COUNT occurrences du module dans le core" >&2
  cp -a "$BACKUP_DIR/carte-core-preview.html" "$CORE"
  exit 6
}

if systemctl list-unit-files 2>/dev/null | grep -q '^labetaillere-map-v2\.service'; then
  systemctl restart labetaillere-map-v2.service
  systemctl is-active --quiet labetaillere-map-v2.service || {
    echo "ERREUR: service map-v2 inactif après redémarrage, restauration du core" >&2
    cp -a "$BACKUP_DIR/carte-core-preview.html" "$CORE"
    systemctl restart labetaillere-map-v2.service || true
    exit 7
  }
fi

echo "OK — votes de retard voyageurs installés sur la carte."
echo "Sauvegarde : $BACKUP_DIR"
echo "Core        : $(sha256sum "$CORE" | awk '{print $1}')"
echo "Module vote : $(sha256sum "$TARGET_JS" | awk '{print $1}')"
echo "Rollback    : cp '$BACKUP_DIR/carte-core-preview.html' '$CORE' && systemctl restart labetaillere-map-v2.service"
