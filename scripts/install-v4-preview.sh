#!/usr/bin/env bash
set -Eeuo pipefail

# La Bétaillère — installateur de PREVIEW V4 uniquement.
# Ne modifie ni index.html, ni nginx, ni systemd, ni la carte existante.

ROOT="${LB_V4_PREVIEW_ROOT:-/opt/labetaillere-map-v2-src/map-v2/public}"
TARGET="${ROOT}/v4-preview"
BRANCH="${LB_V4_BRANCH:-refonte-v4-command-center}"
RAW="https://raw.githubusercontent.com/TekMaTe-lux/Assistant-train/${BRANCH}"
STAMP="$(date +%Y%m%d-%H%M%S)"
TMP="$(mktemp -d /tmp/labetaillere-v4-preview.XXXXXX)"

cleanup(){ rm -rf "$TMP"; }
trap cleanup EXIT

if [[ ! -d "$ROOT" ]]; then
  echo "ERREUR: racine publique introuvable: $ROOT" >&2
  exit 2
fi

# Garde-fou : on refuse d'opérer si on ne reconnaît pas la racine map-v2.
if [[ ! -f "$ROOT/carte-core-preview.html" && ! -f "$ROOT/carte-preview.html" ]]; then
  echo "ERREUR: $ROOT ne ressemble pas à la racine publique map-v2 connue." >&2
  echo "Aucun fichier n'a été modifié." >&2
  exit 3
fi

mkdir -p "$TMP/assets"

fetch(){
  local remote="$1" local_path="$2"
  curl -fL --retry 3 --connect-timeout 8 --max-time 30 \
    "${RAW}/${remote}" -o "${local_path}"
}

echo "=== Téléchargement de la preview V4 depuis ${BRANCH} ==="
fetch "v4/index.html" "$TMP/index.html"
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

# La preview VPS vit sous /map-v2/v4-preview/ : rendre tous les assets locaux.
for page in "$TMP/index.html" "$TMP/components.html"; do
  sed -i \
    -e 's|href="/assets/|href="./assets/|g' \
    -e 's|src="/assets/|src="./assets/|g' \
    -e 's|href="/v4/|href="./|g' \
    -e 's|src="/v4/|src="./|g' \
    -e 's|src="/logobetailleresanstexte.png"|src="./logobetailleresanstexte.png"|g' \
    -e "s|window.LB_V4_ICON_SPRITE='/assets/lb-v4-icons.svg'|window.LB_V4_ICON_SPRITE='./assets/lb-v4-icons.svg'|g" \
    "$page"
done

# Contrôles minimaux avant toute installation.
node --check "$TMP/preview.js"
node --check "$TMP/components.js"
node --check "$TMP/assets/lb-train-components-v4.js"
grep -q 'noindex,nofollow,noarchive' "$TMP/index.html"
grep -q 'Laboratoire V4' "$TMP/index.html"
if grep -Eq 'index\.html(\?|#|"|\x27)' "$TMP/index.html"; then
  echo "ERREUR: la preview référence index.html, installation annulée." >&2
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
printf '%s\n' "URL principale : https://vps.labetaillere.fr/map-v2/v4-preview/index.html"
printf '%s\n' "Showroom : https://vps.labetaillere.fr/map-v2/v4-preview/components.html"
printf '%s\n' "Note : l'URL du dossier /v4-preview/ peut tomber sur le fallback JSON nginx ; utiliser index.html explicitement."
printf '%s\n' "Aucun index.html public, nginx ou service n'a été modifié."
