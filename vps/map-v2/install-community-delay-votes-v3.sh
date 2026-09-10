#!/usr/bin/env bash
set -euo pipefail

echo "============================================================"
echo " LA BETAILLERE — COMMUNITY DELAY VOTES V3 / VPS DIRECT"
echo "============================================================"

ROOT="${LB_MAP_ROOT:-/opt/labetaillere-map-v2-src}"
PUBLIC="$ROOT/map-v2/public"
CORE="$PUBLIC/carte-core-preview.html"
ASSET_DIR="$PUBLIC/assets"
TARGET_JS="$ASSET_DIR/lb-community-traveler-vote-v2.js"
SOURCE_URL="${LB_VOTE_SOURCE_URL:-https://raw.githubusercontent.com/TekMaTe-lux/Assistant-train/fe768c05e55f5281b5e56a58e10a0e1efd0d385c/vps/map-v2/lb-community-traveler-vote-v2.js}"
STAMP="$(date +%Y%m%d-%H%M%S-%N)"
BACKUP_DIR="$ROOT/map-v2/backups/community-delay-votes-v3-$STAMP"
TMP_JS="$(mktemp /tmp/lb-community-delay-vote-v2.XXXXXX.js)"
trap 'rm -f "$TMP_JS"' EXIT

[[ -f "$CORE" ]] || { echo "ERREUR: carte introuvable: $CORE" >&2; exit 2; }

echo "[1/6] Téléchargement du module V2 autonome…"
curl -fsSL "${SOURCE_URL}?v=${STAMP}" -o "$TMP_JS"
grep -q '__LB_COMMUNITY_TRAVELER_VOTE_V2__' "$TMP_JS" || {
  echo "ERREUR: module V2 téléchargé invalide" >&2
  exit 3
}

if command -v node >/dev/null 2>&1; then
  echo "[2/6] Contrôle syntaxique Node…"
  node --check "$TMP_JS"
else
  echo "[2/6] Node absent — contrôle syntaxique ignoré"
fi

echo "[3/6] Sauvegarde…"
install -d -m 0755 "$ASSET_DIR" "$BACKUP_DIR"
cp -a "$CORE" "$BACKUP_DIR/carte-core-preview.html"
[[ -f "$TARGET_JS" ]] && cp -a "$TARGET_JS" "$BACKUP_DIR/lb-community-traveler-vote-v2.js"
[[ -f "$ASSET_DIR/lb-community-traveler-vote-v1.js" ]] && cp -a "$ASSET_DIR/lb-community-traveler-vote-v1.js" "$BACKUP_DIR/lb-community-traveler-vote-v1.js"

echo "[4/6] Installation du module sur le VPS…"
install -m 0644 "$TMP_JS" "$TARGET_JS"

python3 - "$CORE" <<'PY'
from pathlib import Path
import re, sys

path = Path(sys.argv[1])
text = path.read_text(encoding='utf-8')
marker = '<script id="lb-community-traveler-vote-v2" src="./assets/lb-community-traveler-vote-v2.js?v=20260910-4"></script>'

# Retire uniquement nos anciennes couches de vote, jamais les autres modules communautaires.
text = re.sub(
    r'\s*<script\s+id="lb-community-traveler-vote-v[12]"\s+src="[^"]+"\s*></script>',
    '',
    text,
    flags=re.I,
)

compact = re.search(
    r'<script\s+id="lb-community-traveler-compact-v2"\s+src="\./assets/lb-community-traveler-compact-v2\.js\?v=[^"]+"\s*></script>',
    text,
    flags=re.I,
)
if compact:
    pos = compact.end()
    text = text[:pos] + '\n' + marker + text[pos:]
else:
    closing = text.lower().rfind('</body>')
    if closing < 0:
        raise SystemExit('ERREUR: ni compact-v2 ni </body> trouvé')
    text = text[:closing] + marker + '\n' + text[closing:]

path.write_text(text, encoding='utf-8')
PY

echo "[5/6] Vérifications locales…"
COUNT="$(grep -c 'id="lb-community-traveler-vote-v2"' "$CORE" || true)"
[[ "$COUNT" = "1" ]] || {
  echo "ERREUR: $COUNT balise(s) V2 dans le core — rollback" >&2
  cp -a "$BACKUP_DIR/carte-core-preview.html" "$CORE"
  exit 5
}

grep -q 'lb-community-traveler-vote-v2.js?v=20260910-4' "$CORE" || {
  echo "ERREUR: src V2 exact absent — rollback" >&2
  cp -a "$BACKUP_DIR/carte-core-preview.html" "$CORE"
  exit 6
}

grep -q '__LB_COMMUNITY_TRAVELER_VOTE_V2__' "$TARGET_JS" || {
  echo "ERREUR: module V2 installé invalide — rollback" >&2
  cp -a "$BACKUP_DIR/carte-core-preview.html" "$CORE"
  exit 7
}

if command -v node >/dev/null 2>&1; then node --check "$TARGET_JS"; fi

echo "[6/6] Vérification de ce que sert vps.labetaillere.fr…"
SERVED_CORE="$(curl -fsSL "https://vps.labetaillere.fr/map-v2/carte-core-preview.html?t=$STAMP" || true)"
if grep -q 'lb-community-traveler-vote-v2.js?v=20260910-4' <<<"$SERVED_CORE"; then
  echo "Core public : OK"
else
  echo "ATTENTION: le core public ne montre pas encore la V2 (cache/proxy possible)."
fi

HTTP_JS="$(curl -sS -o /tmp/lb-vote-v2-public.$$ -w '%{http_code}' "https://vps.labetaillere.fr/map-v2/assets/lb-community-traveler-vote-v2.js?t=$STAMP" || true)"
if [[ "$HTTP_JS" == "200" ]] && grep -q '__LB_COMMUNITY_TRAVELER_VOTE_V2__' /tmp/lb-vote-v2-public.$$ 2>/dev/null; then
  echo "Module public: HTTP 200 / V2 OK"
else
  echo "ATTENTION: module public non vérifié (HTTP $HTTP_JS)."
fi
rm -f /tmp/lb-vote-v2-public.$$

echo
echo "OK — V3 installée. La carte récupère maintenant elle-même les votes depuis /api/comments."
echo "Sauvegarde : $BACKUP_DIR"
echo "Core        : $(sha256sum "$CORE" | awk '{print $1}')"
echo "Module V2   : $(sha256sum "$TARGET_JS" | awk '{print $1}')"
echo "Rollback    : cp '$BACKUP_DIR/carte-core-preview.html' '$CORE'"
