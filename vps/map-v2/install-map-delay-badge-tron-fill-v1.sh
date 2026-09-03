#!/usr/bin/env bash
set -euo pipefail

ROOT="/opt/labetaillere-map-v2-src"
FILE="$ROOT/map-v2/public/carte-core-preview.html"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="${FILE}.bak-delay-badge-tron-fill-v1-${STAMP}"
SUCCESS=0

rollback(){
  if [[ "$SUCCESS" -ne 1 && -f "$BACKUP" ]]; then
    echo
    echo "❌ ÉCHEC — restauration automatique"
    cp -p "$BACKUP" "$FILE"
    echo "✅ Carte restaurée depuis : $BACKUP"
  fi
}
trap rollback EXIT

[[ -f "$FILE" ]] || { echo "ERREUR: fichier introuvable: $FILE" >&2; exit 2; }

for needle in \
  'LB_MARKER_BADGE_FIX_V2 START' \
  'LB_STATUS_VISIBILITY_MODAL_V1 START' \
  'LB_PARTIAL_GHOST_V2_JS START' \
  'train-delay-badge--moderate' \
  'train-delay-badge--major' \
  'train-delay-badge--severe' \
  'train-delay-badge--cancelled'; do
  grep -q "$needle" "$FILE" || { echo "ERREUR: structure inattendue, élément absent: $needle" >&2; exit 3; }
done

echo "=== VERSION AVANT ==="
sha256sum "$FILE"

echo
echo "=== SAUVEGARDE ==="
cp -p "$FILE" "$BACKUP"
echo "$BACKUP"

echo
echo "=== INSTALLATION ==="
python3 - "$FILE" <<'PY'
from pathlib import Path
import re, sys

path=Path(sys.argv[1])
text=path.read_text(encoding='utf-8')

# Retire seulement nos anciennes variantes de test éventuelles.
for start,end in (
    ('<!-- LB_DELAY_BADGE_LIGHT_V1 START -->','<!-- LB_DELAY_BADGE_LIGHT_V1 END -->'),
    ('<!-- LB_DELAY_BADGE_TRON_FILL_V1 START -->','<!-- LB_DELAY_BADGE_TRON_FILL_V1 END -->'),
):
    text=re.sub(re.escape(start)+r'.*?'+re.escape(end)+r'\s*','',text,flags=re.S)

start='<!-- LB_DELAY_BADGE_TRON_FILL_V1 START -->'
end='<!-- LB_DELAY_BADGE_TRON_FILL_V1 END -->'

block=r'''<!-- LB_DELAY_BADGE_TRON_FILL_V1 START -->
<style id="lb-delay-badge-tron-fill-v1">
/* Badges compacts TRON, fond = niveau de perturbation, SANS contour.
   Aucun changement de logique, de liseré ou de triangle. */

html body .cow-marker .train-delay-badge{
  display:inline-flex!important;
  align-items:center!important;
  justify-content:center!important;
  width:auto!important;
  min-width:0!important;
  max-width:none!important;
  height:auto!important;
  min-height:11px!important;
  margin-left:2px!important;
  padding:1px 4px!important;
  border:0!important;
  outline:0!important;
  border-radius:5px!important;
  box-shadow:0 1px 2px rgba(0,8,18,.28)!important;
  font-size:7px!important;
  font-weight:900!important;
  line-height:1!important;
  letter-spacing:0!important;
  white-space:nowrap!important;
  text-transform:none!important;
}

/* +1 à env. +5 : jaune chaud */
html body .cow-marker .train-delay-badge--moderate{
  background:rgba(255,190,58,.97)!important;
  color:#101820!important;
}

/* retard intermédiaire : orange */
html body .cow-marker .train-delay-badge--major{
  background:rgba(238,119,48,.96)!important;
  color:#121820!important;
}

/* très gros retard : rouge bordeaux, volontairement proche de la suppression */
html body .cow-marker .train-delay-badge--severe{
  background:rgba(176,49,71,.96)!important;
  color:#fff5f7!important;
}

/* SUPPRESSION : on conserve la couleur actuelle de la carte */
html body .cow-marker .train-delay-badge--cancelled{
  background:rgba(128,32,52,.92)!important;
  color:#ffe4ef!important;
  text-transform:uppercase!important;
  letter-spacing:.035em!important;
}

/* Ajouter l'unité uniquement aux retards, jamais à SUPPR. */
html body .cow-marker .train-delay-badge--moderate::after,
html body .cow-marker .train-delay-badge--major::after,
html body .cow-marker .train-delay-badge--severe::after{
  content:' min'!important;
  display:inline!important;
  margin-left:1px!important;
  font-size:.88em!important;
  font-weight:800!important;
  opacity:.9!important;
}
html body .cow-marker .train-delay-badge--cancelled::after{
  content:none!important;
  display:none!important;
}

@media(max-width:720px){
  html body .cow-marker .train-delay-badge{
    min-height:10px!important;
    padding:1px 3px!important;
    border-radius:4px!important;
    font-size:6.5px!important;
  }
}
</style>
<!-- LB_DELAY_BADGE_TRON_FILL_V1 END -->'''

if '</head>' not in text:
    raise SystemExit('ERREUR: </head> introuvable')
text=text.replace('</head>',block+'\n</head>',1)

if text.count(start)!=1 or text.count(end)!=1:
    raise SystemExit('ERREUR: bloc TRON badge dupliqué/incomplet')

path.write_text(text,encoding='utf-8')
print('✅ badge TRON sans contour installé')
PY

echo
echo "=== CONTRÔLES ==="
grep -q 'LB_DELAY_BADGE_TRON_FILL_V1 START' "$FILE"
grep -q "content:' min'!important" "$FILE"
grep -q 'background:rgba(128,32,52,.92)!important' "$FILE"
grep -q 'background:rgba(176,49,71,.96)!important' "$FILE"
grep -q 'border:0!important' "$FILE"
# Vérifier que les briques fonctionnelles restent là.
grep -q 'LB_MARKER_BADGE_FIX_V2 START' "$FILE"
grep -q 'LB_STATUS_VISIBILITY_MODAL_V1 START' "$FILE"
grep -q 'LB_PARTIAL_GHOST_V2_JS START' "$FILE"
echo "✅ sans contour"
echo "✅ +N min ajouté visuellement aux retards"
echo "✅ suppression = couleur actuelle rgba(128,32,52,.92)"
echo "✅ retard sévère rapproché de la teinte suppression"
echo "✅ liserés / triangles / logique retard conservés"

echo
echo "=== HASH APRÈS ==="
AFTER="$(sha256sum "$FILE" | awk '{print $1}')"
echo "$AFTER  $FILE"

echo
echo "=== VERSION SERVIE ==="
SERVED=""
for i in 1 2 3; do
  SERVED="$(curl -fsSL "https://vps.labetaillere.fr/map-v2/carte-core-preview.html?t=$(date +%s)-$i" | sha256sum | awk '{print $1}')" || true
  echo "Essai $i : $SERVED"
  [[ "$SERVED" == "$AFTER" ]] && break
  sleep 1
done
[[ "$SERVED" == "$AFTER" ]] && echo "✅ HTTP = local" || echo "⚠️ HTTP pas encore synchronisé"

SUCCESS=1
trap - EXIT

echo
echo "✅ BADGES TRON V1 INSTALLÉS"
echo "Sauvegarde : $BACKUP"
