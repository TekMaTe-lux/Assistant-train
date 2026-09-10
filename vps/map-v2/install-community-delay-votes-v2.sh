#!/usr/bin/env bash
set -euo pipefail

echo "============================================================"
echo " LA BETAILLERE — COMMUNITY DELAY VOTES V2"
echo "============================================================"

ROOT="${LB_MAP_ROOT:-/opt/labetaillere-map-v2-src}"
PUBLIC="$ROOT/map-v2/public"
CORE="$PUBLIC/carte-core-preview.html"
ASSET_DIR="$PUBLIC/assets"
TARGET_JS="$ASSET_DIR/lb-community-traveler-vote-v1.js"
# Module figé sur le commit qui l'a introduit : pas de surprise de cache/branche.
SOURCE_URL="${LB_VOTE_SOURCE_URL:-https://raw.githubusercontent.com/TekMaTe-lux/Assistant-train/221c32106c04ff851e48717afbfac14b798a3997/vps/map-v2/lb-community-traveler-vote-v1.js}"
STAMP="$(date +%Y%m%d-%H%M%S-%N)"
BACKUP_DIR="$ROOT/map-v2/backups/community-delay-votes-v2-$STAMP"

# Le suffixe .js fait partie du template lui-même : compatible Node 20/ESM
# et indépendant du comportement de `mktemp --suffix`.
TMP_JS="$(mktemp /tmp/lb-community-delay-vote.XXXXXX.js)"
cleanup(){ rm -f "$TMP_JS"; }
trap cleanup EXIT

[[ -f "$CORE" ]] || { echo "ERREUR: carte introuvable: $CORE" >&2; exit 2; }

echo "[1/5] Téléchargement du module…"
curl -fsSL "${SOURCE_URL}?v=${STAMP}" -o "$TMP_JS"
grep -q '__LB_COMMUNITY_TRAVELER_VOTE_V1__' "$TMP_JS" || {
  echo "ERREUR: module de vote téléchargé invalide" >&2
  exit 3
}

if command -v node >/dev/null 2>&1; then
  echo "[2/5] Contrôle syntaxique Node: $TMP_JS"
  case "$TMP_JS" in
    *.js) ;;
    *) echo "ERREUR: fichier temporaire sans extension .js: $TMP_JS" >&2; exit 4 ;;
  esac
  node --check "$TMP_JS"
else
  echo "[2/5] Node absent — contrôle syntaxique ignoré"
fi

echo "[3/5] Sauvegarde puis installation…"
install -d -m 0755 "$ASSET_DIR" "$BACKUP_DIR"
cp -a "$CORE" "$BACKUP_DIR/carte-core-preview.html"
[[ -f "$TARGET_JS" ]] && cp -a "$TARGET_JS" "$BACKUP_DIR/lb-community-traveler-vote-v1.js"
install -m 0644 "$TMP_JS" "$TARGET_JS"

python3 - "$CORE" <<'PY'
from pathlib import Path
import re
import sys

path = Path(sys.argv[1])
text = path.read_text(encoding='utf-8')
marker = '<script id="lb-community-traveler-vote-v1" src="./assets/lb-community-traveler-vote-v1.js?v=20260910-3"></script>'

# Idempotent et auto-réparant : retire l'ancienne balise même si son src avait
# perdu le "1" (lb-community-traveler-vote-v.js), puis réinjecte l'URL exacte.
text = re.sub(
    r'\s*<script id="lb-community-traveler-vote-v1" src="\./assets/lb-community-traveler-vote-v(?:1)?\.js\?v=[^"]+"></script>',
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

echo "[4/5] Vérifications…"
EXPECTED='src="./assets/lb-community-traveler-vote-v1.js?v=20260910-3"'
grep -Fq "$EXPECTED" "$CORE" || {
  echo "ERREUR: src exact du module de vote absent du core" >&2
  cp -a "$BACKUP_DIR/carte-core-preview.html" "$CORE"
  exit 5
}
if grep -Fq 'lb-community-traveler-vote-v.js' "$CORE"; then
  echo "ERREUR: ancienne URL fautive lb-community-traveler-vote-v.js encore présente" >&2
  cp -a "$BACKUP_DIR/carte-core-preview.html" "$CORE"
  exit 6
fi
grep -q '__LB_COMMUNITY_TRAVELER_VOTE_V1__' "$TARGET_JS" || {
  echo "ERREUR: module installé invalide" >&2
  cp -a "$BACKUP_DIR/carte-core-preview.html" "$CORE"
  exit 7
}
COUNT="$(grep -c 'id="lb-community-traveler-vote-v1"' "$CORE" || true)"
[[ "$COUNT" = "1" ]] || {
  echo "ERREUR: $COUNT occurrences du module dans le core" >&2
  cp -a "$BACKUP_DIR/carte-core-preview.html" "$CORE"
  exit 8
}

echo "[5/5] Redémarrage contrôlé…"
if systemctl list-unit-files 2>/dev/null | grep -q '^labetaillere-map-v2\.service'; then
  systemctl restart labetaillere-map-v2.service
  if ! systemctl is-active --quiet labetaillere-map-v2.service; then
    echo "ERREUR: service map-v2 inactif après redémarrage — rollback automatique" >&2
    cp -a "$BACKUP_DIR/carte-core-preview.html" "$CORE"
    systemctl restart labetaillere-map-v2.service || true
    exit 9
  fi
else
  echo "Service labetaillere-map-v2.service non détecté : aucun redémarrage nécessaire pour ces fichiers statiques."
fi

echo
echo "OK — votes de retard voyageurs installés sur la carte."
echo "Sauvegarde : $BACKUP_DIR"
echo "Core        : $(sha256sum "$CORE" | awk '{print $1}')"
echo "Module vote : $(sha256sum "$TARGET_JS" | awk '{print $1}')"
echo "Rollback    : cp '$BACKUP_DIR/carte-core-preview.html' '$CORE'"
