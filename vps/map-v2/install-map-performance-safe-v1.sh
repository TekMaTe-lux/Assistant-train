#!/usr/bin/env bash
set -euo pipefail

ROOT="${LB_MAP_ROOT:-/opt/labetaillere-map-v2-src}"
SCRIPT_DIR="$ROOT/vps/map-v2"
PUBLIC="$ROOT/map-v2/public"
CORE="$PUBLIC/carte-core-preview.html"
WRAPPER="$PUBLIC/carte-preview.html"
FAST="$SCRIPT_DIR/install-community-fast-marker-stack-v1.sh"
MOBILE="$SCRIPT_DIR/install-mobile-readonly-router-v1.sh"
STAMP="$(date +%Y%m%d-%H%M%S-%N)"
BACKUP="$ROOT/backups/map-performance-safe-v1-$STAMP"

for f in "$CORE" "$WRAPPER" "$FAST" "$MOBILE"; do
  [[ -f "$f" ]] || { echo "ERREUR: fichier introuvable: $f" >&2; exit 2; }
done

mkdir -p "$BACKUP"
cp -a "$CORE" "$BACKUP/carte-core-preview.html"
cp -a "$WRAPPER" "$BACKUP/carte-preview.html"
for f in \
  "$PUBLIC/assets/lb-community-traveler-v1.js" \
  "$PUBLIC/assets/lb-community-traveler-compact-v2.js" \
  "$PUBLIC/carte-mobile-readonly.html"; do
  [[ -f "$f" ]] && cp -a "$f" "$BACKUP/$(basename "$f")"
done

rollback(){
  echo "ERREUR: restauration automatique des fichiers sauvegardés..." >&2
  cp -a "$BACKUP/carte-core-preview.html" "$CORE"
  cp -a "$BACKUP/carte-preview.html" "$WRAPPER"
  [[ -f "$BACKUP/lb-community-traveler-v1.js" ]] && cp -a "$BACKUP/lb-community-traveler-v1.js" "$PUBLIC/assets/lb-community-traveler-v1.js"
  [[ -f "$BACKUP/lb-community-traveler-compact-v2.js" ]] && cp -a "$BACKUP/lb-community-traveler-compact-v2.js" "$PUBLIC/assets/lb-community-traveler-compact-v2.js"
  [[ -f "$BACKUP/carte-mobile-readonly.html" ]] && cp -a "$BACKUP/carte-mobile-readonly.html" "$PUBLIC/carte-mobile-readonly.html"
}
trap rollback ERR

# 1) Supprime les rescans globaux de marqueurs ajoutés avec la couche voyageurs.
bash "$FAST"

# 2) Déploie la carte mobile lecture seule et ajoute un routeur dans le wrapper,
# sans modifier davantage le core desktop.
bash "$MOBILE"

# 3) Contrôles de non-régression structurels.
node --check "$PUBLIC/assets/lb-community-traveler-v1.js"
node --check "$PUBLIC/assets/lb-community-traveler-compact-v2.js"
grep -q 'LB_COMMUNITY_FAST_MARKER_STACK_V1' "$PUBLIC/assets/lb-community-traveler-v1.js"
grep -q 'LB_COMMUNITY_FAST_MARKER_STACK_V1' "$PUBLIC/assets/lb-community-traveler-compact-v2.js"
grep -q 'LB_COMMUNITY_MARKER_STACK_CSS_V1' "$CORE"
grep -q 'LB_SERVICE_DAY_ROLLOVER_V1' "$CORE"
grep -q 'LB_MOBILE_READONLY_ROUTER_V1' "$WRAPPER"
grep -q '/api/map-v2/trains?bbox=' "$PUBLIC/carte-mobile-readonly.html"

# L'ancien correctif de stabilité visuelle était trop coûteux : il ne doit pas revenir.
if grep -q 'lb-map-visual-stability-v1' "$CORE"; then
  echo "ERREUR: ancien module lourd visual-stability détecté" >&2
  exit 4
fi

trap - ERR

echo
echo "OK — optimisation carte installée sans redémarrage du service."
echo "Backup complet: $BACKUP"
echo "Desktop: logique fonctionnelle conservée, rescans globaux supprimés."
echo "Mobile: lecture seule légère, rafraîchissement 15 s, aucune écriture communautaire."
echo "Carte complète forcée sur mobile si besoin: https://vps.labetaillere.fr/map-v2/carte-preview.html?full=1"
echo
echo "Contrôle conseillé:"
echo "  systemctl is-active labetaillere-map-v2.service"
echo "  grep -nE 'LB_COMMUNITY_FAST_MARKER_STACK_V1|LB_MOBILE_READONLY_ROUTER_V1' '$CORE' '$WRAPPER' '$PUBLIC/assets/lb-community-traveler-v1.js' '$PUBLIC/assets/lb-community-traveler-compact-v2.js'"
