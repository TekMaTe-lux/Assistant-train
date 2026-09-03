#!/usr/bin/env bash
set -euo pipefail

ROOT="/opt/labetaillere-map-v2-src"
FILE="$ROOT/map-v2/public/carte-core-preview.html"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="${FILE}.bak-train-contrast-boost-v1-${STAMP}"
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
  'LB_STATUS_VISIBILITY_MODAL_V1 START' \
  'train-delay-badge--moderate' \
  'train-delay-badge--major' \
  'train-delay-badge--severe'; do
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

start='<!-- LB_TRAIN_CONTRAST_BOOST_V1 START -->'
end='<!-- LB_TRAIN_CONTRAST_BOOST_V1 END -->'

block=r'''<!-- LB_TRAIN_CONTRAST_BOOST_V1 START -->
<style id="lb-train-contrast-boost-v1">
/* Plus de contraste sans grossir les trains.
   Aucun changement de logique, de badge, de parcours ou d'orientation. */

/* Tous les trains : couleurs un peu plus vives, opacité pleine, séparation du fond. */
html body .cow-marker .cow-glyph{
  opacity:1!important;
  filter:
    saturate(1.34)
    brightness(1.16)
    contrast(1.08)
    drop-shadow(0 1px .45px rgba(0,5,12,.96))
    drop-shadow(0 0 1.15px rgba(164,242,255,.36))!important;
}

/* Retard léger : on garde le liseré de statut mais on rehausse aussi le cœur du train. */
html body .cow-marker:has(.train-delay-badge--moderate) .cow-glyph{
  opacity:1!important;
  filter:
    saturate(1.38)
    brightness(1.17)
    contrast(1.08)
    drop-shadow(0 0 .45px rgba(0,0,0,.98))
    drop-shadow(0 0 .95px rgba(255,196,64,.94))
    drop-shadow(0 0 1.55px rgba(255,196,64,.34))!important;
}

/* Retard moyen. */
html body .cow-marker:has(.train-delay-badge--major) .cow-glyph{
  opacity:1!important;
  filter:
    saturate(1.40)
    brightness(1.18)
    contrast(1.09)
    drop-shadow(0 0 .5px rgba(0,0,0,.98))
    drop-shadow(0 0 1.05px rgba(255,145,86,.96))
    drop-shadow(0 0 1.8px rgba(255,145,86,.38))!important;
}

/* Gros retard. */
html body .cow-marker:has(.train-delay-badge--severe) .cow-glyph{
  opacity:1!important;
  filter:
    saturate(1.42)
    brightness(1.18)
    contrast(1.10)
    drop-shadow(0 0 .55px rgba(0,0,0,.99))
    drop-shadow(0 0 1.2px rgba(176,49,71,.98))
    drop-shadow(0 0 2px rgba(176,49,71,.44))!important;
}

/* Suppression : plus contrastée, toujours dans la teinte existante. */
html body .cow-marker.train-cancelled .cow-glyph,
html body .cow-marker:has(.train-delay-badge--cancelled) .cow-glyph{
  opacity:1!important;
  filter:
    saturate(1.38)
    brightness(1.14)
    contrast(1.12)
    drop-shadow(0 0 .55px rgba(0,0,0,.99))
    drop-shadow(0 0 1.25px rgba(128,32,52,.98))
    drop-shadow(0 0 2.15px rgba(128,32,52,.48))!important;
}

/* Pas d'animation supplémentaire : garde la carte fluide. */
html body .cow-marker .cow-glyph{
  transition:none!important;
}
</style>
<!-- LB_TRAIN_CONTRAST_BOOST_V1 END -->'''

pattern=re.compile(re.escape(start)+r'.*?'+re.escape(end),re.S)
if pattern.search(text):
    text=pattern.sub(block,text,count=1)
else:
    if '</head>' not in text:
        raise SystemExit('ERREUR: </head> introuvable')
    text=text.replace('</head>',block+'\n</head>',1)

if text.count(start)!=1 or text.count(end)!=1:
    raise SystemExit('ERREUR: bloc contrast dupliqué/incomplet')

path.write_text(text,encoding='utf-8')
print('✅ boost contraste installé')
PY

echo
echo "=== CONTRÔLES ==="
grep -q 'LB_TRAIN_CONTRAST_BOOST_V1 START' "$FILE"
grep -q 'saturate(1.34)' "$FILE"
grep -q 'brightness(1.16)' "$FILE"
grep -q 'train-delay-badge--severe' "$FILE"
grep -q 'train-delay-badge--cancelled' "$FILE"
# Vérifier les briques fonctionnelles clés.
grep -q 'LB_STATUS_VISIBILITY_MODAL_V1 START' "$FILE"
grep -q 'LB_MARKER_BADGE_FIX_V2 START' "$FILE"
grep -q 'LB_PARTIAL_GHOST_V2_JS START' "$FILE"
echo "✅ contraste général renforcé"
echo "✅ liserés retard/suppression conservés et rehaussés"
echo "✅ aucune animation ajoutée"
echo "✅ badges / moteur / fantômes conservés"

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
echo "✅ BOOST CONTRASTE TRAINS V1 INSTALLÉ"
echo "Sauvegarde : $BACKUP"
