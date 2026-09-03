#!/usr/bin/env bash
set -euo pipefail

ROOT="/opt/labetaillere-map-v2-src"
FILE="$ROOT/map-v2/public/carte-core-preview.html"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="${FILE}.bak-right-delay-labels-v2c-${STAMP}"
TMP="/tmp/install-map-right-delay-labels-v2b-base-${STAMP}.sh"

[[ -f "$FILE" ]] || { echo "ERREUR: fichier introuvable: $FILE" >&2; exit 2; }

# Contrôles réellement nécessaires au correctif.
for needle in \
  'LB_TRIP_SHEET_SITE_STYLE_V5_CSS START' \
  'LB_TRIP_SHEET_SITE_STYLE_V5_JS START' \
  'function renderTripPanel' \
  'id="trip-stops"'; do
  grep -q "$needle" "$FILE" || { echo "ERREUR: structure inattendue, élément absent: $needle" >&2; exit 3; }
done

# Le header peut être V1 ou V2 suivant l'état actuel. Le correctif des retards à droite n'en dépend pas.
if grep -q 'LB_V5_AXIS_HEADER_TARGET_V2_CSS START' "$FILE"; then
  echo "✅ Header actuel : V2"
elif grep -q 'LB_V5_AXIS_HEADER_TARGET_V1_CSS START' "$FILE"; then
  echo "✅ Header actuel : V1"
else
  echo "⚠️ Aucun marqueur header V1/V2 détecté ; poursuite car ce correctif n'en dépend pas."
fi

echo "=== VERSION AVANT ==="
sha256sum "$FILE"
cp -p "$FILE" "$BACKUP"
echo "=== SAUVEGARDE ==="
echo "$BACKUP"

# Réutilise la V2B testée, mais retire son ancien prérequis erroné sur le header V1.
curl -fL \
  "https://raw.githubusercontent.com/TekMaTe-lux/Assistant-train/main/vps/map-v2/install-map-right-delay-labels-v2b.sh?t=$(date +%s)" \
  -o "$TMP"

sed -i "/LB_V5_AXIS_HEADER_TARGET_V1_CSS START/d" "$TMP"

# Vérification que le prérequis fautif a bien disparu du script temporaire.
if grep -q 'LB_V5_AXIS_HEADER_TARGET_V1_CSS START' "$TMP"; then
  echo "ERREUR: impossible de neutraliser l'ancien prérequis V1" >&2
  exit 4
fi

bash "$TMP"

echo
echo "=== CONTRÔLE FINAL ==="
grep -q 'LB_RIGHT_DELAY_LABELS_V2B_CSS START' "$FILE"
grep -q 'LB_RIGHT_DELAY_LABELS_V2B_JS START' "$FILE"
grep -q 'LB_STATUS_VISIBILITY_MODAL_V1 START' "$FILE"
grep -q 'LB_MARKER_BADGE_FIX_V2 START' "$FILE"
grep -q 'LB_PARTIAL_GHOST_V2_JS START' "$FILE"
sha256sum "$FILE"

echo "✅ V2C terminée : retards à droite installés, header actuel conservé."
echo "Sauvegarde préalable V2C : $BACKUP"
