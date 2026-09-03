#!/usr/bin/env bash
set -euo pipefail

ROOT="/opt/labetaillere-map-v2-src"
FILE="$ROOT/map-v2/public/carte-core-preview.html"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="${FILE}.bak-train-flashy-palette-v1-${STAMP}"
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
  'cow-marker' \
  'cow-glyph' \
  'train-sncf' \
  'train-cfl' \
  'train-tgv-roi' \
  'LB_STATUS_VISIBILITY_MODAL_V1 START' \
  'LB_MARKER_BADGE_FIX_V2 START'; do
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

# Retire l'ancien simple boost de contraste pour ne pas empiler les effets.
old_start='<!-- LB_TRAIN_CONTRAST_BOOST_V1 START -->'
old_end='<!-- LB_TRAIN_CONTRAST_BOOST_V1 END -->'
text,n_old=re.subn(re.escape(old_start)+r'.*?'+re.escape(old_end)+r'\s*','',text,flags=re.S)
print(f'ℹ️ ancien boost contraste retiré : {n_old}')

start='<!-- LB_TRAIN_FLASHY_PALETTE_V1 START -->'
end='<!-- LB_TRAIN_FLASHY_PALETTE_V1 END -->'

block=r'''<!-- LB_TRAIN_FLASHY_PALETTE_V1 START -->
<style id="lb-train-flashy-palette-v1">
/*
  Palette flash inspirée de la maquette utilisateur.
  Principe : couleur du COEUR = opérateur/catégorie ; contour = état trafic.
  CSS uniquement : aucune modification moteur / position / orientation / retard.
*/

/* Tous les trains : opacité pleine, rendu net. */
html body .cow-marker .cow-glyph{
  opacity:1!important;
  transition:none!important;
}

/* Couleurs opérateur / catégorie disponibles dans le moteur actuel. */
html body .cow-marker.train-sncf .cow-glyph{
  color:#078BFF!important; /* bleu électrique TER/SNCF */
}
html body .cow-marker.train-cfl .cow-glyph{
  color:#FF244D!important; /* rouge CFL très franc */
}
html body .cow-marker.train-tgv-roi .cow-glyph{
  color:#FFD21A!important; /* jaune vif grande vitesse actuelle */
}

/* Trains sans perturbation : séparation sombre + micro halo blanc/cyan.
   On exclut volontairement les états retard/suppression pour laisser leurs liserés existants agir. */
html body .cow-marker:not(:has(.train-delay-badge--moderate))
                    :not(:has(.train-delay-badge--major))
                    :not(:has(.train-delay-badge--severe))
                    :not(:has(.train-delay-badge--cancelled)) .cow-glyph{
  filter:
    saturate(1.62)
    brightness(1.24)
    contrast(1.13)
    drop-shadow(0 0 .45px rgba(0,3,9,.98))
    drop-shadow(0 0 1.15px rgba(255,255,255,.30))!important;
}

/* Variante spécifique par opérateur, très légère, pour rendre les couleurs "flash" sans glow massif. */
html body .cow-marker.train-sncf:not(:has(.train-delay-badge--moderate))
                              :not(:has(.train-delay-badge--major))
                              :not(:has(.train-delay-badge--severe))
                              :not(:has(.train-delay-badge--cancelled)) .cow-glyph{
  text-shadow:0 0 1.35px rgba(0,174,255,.70),0 1px .7px rgba(0,0,0,.92)!important;
}
html body .cow-marker.train-cfl:not(:has(.train-delay-badge--moderate))
                             :not(:has(.train-delay-badge--major))
                             :not(:has(.train-delay-badge--severe))
                             :not(:has(.train-delay-badge--cancelled)) .cow-glyph{
  text-shadow:0 0 1.35px rgba(255,36,77,.72),0 1px .7px rgba(0,0,0,.92)!important;
}
html body .cow-marker.train-tgv-roi:not(:has(.train-delay-badge--moderate))
                                 :not(:has(.train-delay-badge--major))
                                 :not(:has(.train-delay-badge--severe))
                                 :not(:has(.train-delay-badge--cancelled)) .cow-glyph{
  text-shadow:0 0 1.35px rgba(255,210,26,.72),0 1px .7px rgba(0,0,0,.92)!important;
}

/* États perturbés : on conserve la couleur opérateur dans le coeur.
   Les contours retard/suppression installés précédemment restent prioritaires. */
html body .cow-marker:has(.train-delay-badge--moderate) .cow-glyph,
html body .cow-marker:has(.train-delay-badge--major) .cow-glyph,
html body .cow-marker:has(.train-delay-badge--severe) .cow-glyph,
html body .cow-marker:has(.train-delay-badge--cancelled) .cow-glyph,
html body .cow-marker.train-cancelled .cow-glyph{
  opacity:1!important;
}

/* Mobile/dézoom : ne pas grossir, seulement garder les couleurs franches. */
@media(max-width:720px){
  html body .cow-marker .cow-glyph{
    opacity:1!important;
  }
}
</style>
<!-- LB_TRAIN_FLASHY_PALETTE_V1 END -->'''

pattern=re.compile(re.escape(start)+r'.*?'+re.escape(end),re.S)
if pattern.search(text):
    text=pattern.sub(block,text,count=1)
else:
    if '</head>' not in text:
        raise SystemExit('ERREUR: </head> introuvable')
    text=text.replace('</head>',block+'\n</head>',1)

if text.count(start)!=1 or text.count(end)!=1:
    raise SystemExit('ERREUR: bloc palette flash dupliqué/incomplet')

path.write_text(text,encoding='utf-8')
print('✅ palette flash installée')
PY

echo
echo "=== CONTRÔLES ==="
grep -q 'LB_TRAIN_FLASHY_PALETTE_V1 START' "$FILE"
grep -q 'color:#078BFF!important' "$FILE"
grep -q 'color:#FF244D!important' "$FILE"
grep -q 'color:#FFD21A!important' "$FILE"
if grep -q 'LB_TRAIN_CONTRAST_BOOST_V1 START' "$FILE"; then
  echo "ERREUR: ancien boost contraste encore présent" >&2
  exit 4
fi
# Vérifier que les briques fonctionnelles clés sont toujours présentes.
grep -q 'LB_STATUS_VISIBILITY_MODAL_V1 START' "$FILE"
grep -q 'LB_MARKER_BADGE_FIX_V2 START' "$FILE"
grep -q 'LB_PARTIAL_GHOST_V2_JS START' "$FILE"
echo "✅ SNCF = bleu électrique"
echo "✅ CFL = rouge vif"
echo "✅ TGV/ROI = jaune vif"
echo "✅ ancien boost contraste retiré"
echo "✅ liserés / badges / fantômes conservés"

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
echo "✅ PALETTE FLASH V1 INSTALLÉE"
echo "Sauvegarde : $BACKUP"
