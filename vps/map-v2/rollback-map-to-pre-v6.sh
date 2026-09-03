#!/usr/bin/env bash
set -euo pipefail

ROOT="/opt/labetaillere-map-v2-src"
FILE="$ROOT/map-v2/public/carte-core-preview.html"
STAMP="$(date +%Y%m%d-%H%M%S)"
CURRENT_BACKUP="${FILE}.bak-before-rollback-pre-v6-${STAMP}"

[[ -f "$FILE" ]] || { echo "ERREUR: fichier introuvable: $FILE" >&2; exit 2; }

CANDIDATE="$(ls -1t "${FILE}.bak-trip-sheet-v6-hours-only-"* 2>/dev/null | head -n 1 || true)"
if [[ -z "$CANDIDATE" || ! -f "$CANDIDATE" ]]; then
  echo "ERREUR: aucune sauvegarde pré-V6 trouvée." >&2
  echo "Cherché: ${FILE}.bak-trip-sheet-v6-hours-only-*" >&2
  exit 3
fi

echo "=== VERSION ACTUELLE ==="
sha256sum "$FILE"

echo
echo "=== SAUVEGARDE À RESTAURER ==="
echo "$CANDIDATE"
sha256sum "$CANDIDATE"

# Vérifications: on veut vraiment l'état d'avant V6 avec les correctifs marqueurs/retards.
for needle in \
  'LB_MARKER_BADGE_FIX_V2 START' \
  'LB_STATUS_VISIBILITY_MODAL_V1 START' \
  'LB_PARTIAL_GHOST_V2_JS START'; do
  if ! grep -q "$needle" "$CANDIDATE"; then
    echo "ERREUR: la sauvegarde pré-V6 ne contient pas $needle ; restauration annulée." >&2
    exit 4
  fi
done

echo
echo "=== SAUVEGARDE DE L'ÉTAT ACTUEL ==="
cp -p "$FILE" "$CURRENT_BACKUP"
echo "$CURRENT_BACKUP"

echo
echo "=== RESTAURATION EXACTE PRÉ-V6 ==="
cp -p "$CANDIDATE" "$FILE"

# La V6 ne doit plus être présente après restauration.
if grep -q 'LB_TRIP_SHEET_SITE_STYLE_V6_' "$FILE"; then
  echo "ERREUR: V6 toujours présente après restauration; rollback annulé." >&2
  cp -p "$CURRENT_BACKUP" "$FILE"
  exit 5
fi

echo "✅ fichier pré-V6 restauré"

echo
echo "=== CONTRÔLES RETARDS / MARQUEURS ==="
grep -q 'LB_MARKER_BADGE_FIX_V2 START' "$FILE" && echo "✅ marker/badge V2 présent"
grep -q 'LB_STATUS_VISIBILITY_MODAL_V1 START' "$FILE" && echo "✅ liserés/status présents"
grep -q 'LB_PARTIAL_GHOST_V2_JS START' "$FILE" && echo "✅ logique partial ghost présente"

echo
echo "=== EMPREINTE LOCALE ==="
AFTER="$(sha256sum "$FILE" | awk '{print $1}')"
echo "$AFTER  $FILE"

echo
echo "=== VERSION SERVIE ==="
SERVED=""
for try in 1 2 3; do
  SERVED="$(curl -fsSL "https://vps.labetaillere.fr/map-v2/carte-core-preview.html?t=$(date +%s)-$try" | sha256sum | awk '{print $1}')" || true
  echo "Essai $try : $SERVED"
  [[ "$SERVED" == "$AFTER" ]] && break
  sleep 1
done

if [[ "$SERVED" == "$AFTER" ]]; then
  echo "✅ La version servie correspond au fichier restauré"
else
  echo "⚠️ La version HTTP ne correspond pas encore au fichier local"
fi

echo
echo "✅ RETOUR EXACT À L'ÉTAT AVANT V6 TERMINÉ"
echo "Sauvegarde du fichier remplacé : $CURRENT_BACKUP"
