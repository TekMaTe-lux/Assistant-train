#!/usr/bin/env bash
set -Eeuo pipefail

# La Bétaillère — installateur de PREVIEW V4 uniquement.
# Ne modifie ni index.html public, ni nginx, ni systemd, ni la carte existante.

ROOT="${LB_V4_PREVIEW_ROOT:-/opt/labetaillere-map-v2-src/map-v2/public}"
TARGET="${ROOT}/v4-preview"
BRANCH="${LB_V4_BRANCH:-refonte-v4-command-center}"
RAW="https://raw.githubusercontent.com/TekMaTe-lux/Assistant-train/${BRANCH}"
STAMP="$(date +%Y%m%d-%H%M%S)"
TMP="$(mktemp -d /tmp/labetaillere-v4-preview.XXXXXX)"
cleanup(){ rm -rf "$TMP"; }
trap cleanup EXIT

if [[ ! -d "$ROOT" ]]; then echo "ERREUR: racine publique introuvable: $ROOT" >&2; exit 2; fi
if [[ ! -f "$ROOT/carte-core-preview.html" && ! -f "$ROOT/carte-preview.html" ]]; then
  echo "ERREUR: $ROOT ne ressemble pas à la racine publique map-v2 connue." >&2
  echo "Aucun fichier n'a été modifié." >&2
  exit 3
fi

mkdir -p "$TMP/assets"
fetch(){ local remote="$1" local_path="$2"; curl -fL --retry 3 --connect-timeout 8 --max-time 30 "${RAW}/${remote}" -o "${local_path}"; }

echo "=== Téléchargement de la preview V4 depuis ${BRANCH} ==="
fetch "v4/index.html" "$TMP/index.html"
fetch "v4/site.html" "$TMP/site.html"
fetch "v4/site.css" "$TMP/site.css"
fetch "v4/site.js" "$TMP/site.js"
fetch "v4/data-bridge.js" "$TMP/data-bridge.js"
fetch "v4/components.html" "$TMP/components.html"
fetch "v4/preview.css" "$TMP/preview.css"
fetch "v4/preview.js" "$TMP/preview.js"
fetch "v4/components.js" "$TMP/components.js"
fetch "assets/lb-v4-tokens.css" "$TMP/assets/lb-v4-tokens.css"
fetch "assets/lb-v4-command-center.css" "$TMP/assets/lb-v4-command-center.css"
fetch "assets/lb-train-components-v4.css" "$TMP/assets/lb-train-components-v4.css"
fetch "assets/lb-train-components-v4.js" "$TMP/assets/lb-train-components-v4.js"
fetch "assets/lb-v4-icons.svg" "$TMP/assets/lb-v4-icons.svg"
fetch "logobetailleresanstexte.png" "$TMP/logobetailleresanstexte.png"

# Les pages du dépôt utilisent parfois /assets et /v4 ; la copie VPS doit être autonome.
for page in "$TMP/index.html" "$TMP/components.html" "$TMP/site.html"; do
  sed -i \
    -e 's|href="/assets/|href="./assets/|g' \
    -e 's|src="/assets/|src="./assets/|g' \
    -e 's|href="/v4/|href="./|g' \
    -e 's|src="/v4/|src="./|g' \
    -e 's|src="/logobetailleresanstexte.png"|src="./logobetailleresanstexte.png"|g' \
    -e "s|window.LB_V4_ICON_SPRITE='/assets/lb-v4-icons.svg'|window.LB_V4_ICON_SPRITE='./assets/lb-v4-icons.svg'|g" \
    "$page"
done

# Le bridge fait lire à site.html le snapshot statique produit par le moteur V4,
# sans nécessiter de modifier nginx pour exposer /api/v4.
if ! grep -q 'data-bridge.js' "$TMP/site.html"; then
  sed -i 's|<script src="\./site\.js|<script src="./data-bridge.js?v=1"></script>\n  <script src="./site.js|' "$TMP/site.html"
fi

node --check "$TMP/preview.js"
node --check "$TMP/components.js"
node --check "$TMP/site.js"
node --check "$TMP/data-bridge.js"
node --check "$TMP/assets/lb-train-components-v4.js"
for page in "$TMP/index.html" "$TMP/components.html" "$TMP/site.html"; do grep -q 'noindex,nofollow,noarchive' "$page"; done
grep -q 'Laboratoire V4' "$TMP/index.html"
grep -q 'APERÇU COMPLET' "$TMP/site.html"
grep -q 'data-bridge.js' "$TMP/site.html"

if grep -Eq 'href="https://www\.labetaillere\.fr/?"' "$TMP/site.html"; then
  echo "ERREUR: la preview complète pointe vers l'accueil de production, installation annulée." >&2
  exit 4
fi

if [[ -e "$TARGET" ]]; then
  BACKUP="${TARGET}.bak-${STAMP}"
  echo "=== Sauvegarde de l'ancienne preview ==="
  mv "$TARGET" "$BACKUP"
  echo "$BACKUP"
fi
mkdir -p "$TARGET"
cp -a "$TMP/." "$TARGET/"
find "$TARGET" -type d -exec chmod 0755 {} +
find "$TARGET" -type f -exec chmod 0644 {} +

echo
printf '%s\n' "==============================================="
printf '%s\n' "PREVIEW V4 INSTALLÉE SANS TOUCHER À LA PROD"
printf '%s\n' "==============================================="
printf '%s\n' "Dossier : $TARGET"
printf '%s\n' "APERÇU DU SITE : https://vps.labetaillere.fr/map-v2/v4-preview/site.html"
printf '%s\n' "Cockpit technique : https://vps.labetaillere.fr/map-v2/v4-preview/index.html"
printf '%s\n' "Showroom : https://vps.labetaillere.fr/map-v2/v4-preview/components.html"
printf '%s\n' "Aucun index.html public, nginx ou service de production n'a été modifié."
