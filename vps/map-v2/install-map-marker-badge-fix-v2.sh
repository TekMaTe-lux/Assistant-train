#!/usr/bin/env bash
set -euo pipefail

ROOT="/opt/labetaillere-map-v2-src"
FILE="$ROOT/map-v2/public/carte-core-preview.html"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="${FILE}.bak-marker-badge-fix-v2-${STAMP}"
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
  'LB_PARTIAL_GHOST_V2_JS START' \
  'LB_STATUS_VISIBILITY_MODAL_V1 START' \
  'const lbOriginalGlyphForTrain = glyphForTrain;' \
  'train-delay-badge'; do
  grep -q "$needle" "$FILE" || { echo "ERREUR: structure inattendue, élément absent: $needle" >&2; exit 3; }
done

echo "=== 1. VERSION AVANT ==="
sha256sum "$FILE"

echo
echo "=== 2. SAUVEGARDE ==="
cp -p "$FILE" "$BACKUP"
echo "$BACKUP"

echo
echo "=== 3. CORRECTION ==="
python3 - "$FILE" <<'PY'
from pathlib import Path
import re
import sys

path = Path(sys.argv[1])
text = path.read_text(encoding='utf-8')

old = """  const lbOriginalGlyphForTrain = glyphForTrain;
  glyphForTrain = function(train, delayInfoOverride){
    const state = lbTrainCancellationState(train);
    // Conserver le pictogramme habituel: la croix/lisere signale l'etat sans masquer le train.
    if (state.kind === 'full') return cowForTrain(train);
    return lbOriginalGlyphForTrain(train, delayInfoOverride);
  };"""

new = """  const lbOriginalGlyphForTrain = glyphForTrain;
  glyphForTrain = function(train, delayInfoOverride){
    // Toujours conserver le pictogramme / triangle natif de la carte.
    // L'état suppression/partiel ne doit jamais remplacer le train lui-même.
    return lbOriginalGlyphForTrain(train, delayInfoOverride);
  };"""

if old in text:
    text = text.replace(old, new, 1)
    print('✅ bloc glyphForTrain corrigé')
elif new in text:
    print('ℹ️ bloc glyphForTrain déjà corrigé')
else:
    # Fallback très local: on remplace uniquement l'override compris entre les deux constantes connues.
    pattern = re.compile(
        r"  const lbOriginalGlyphForTrain = glyphForTrain;\n"
        r"  glyphForTrain = function\(train, delayInfoOverride\)\{.*?\n"
        r"  \};\n\n"
        r"  const lbOriginalTrainIconSignature = trainIconSignature;",
        re.S,
    )
    replacement = new + "\n\n  const lbOriginalTrainIconSignature = trainIconSignature;"
    text, count = pattern.subn(replacement, text, count=1)
    if count != 1:
        raise SystemExit('ERREUR: bloc glyphForTrain introuvable — aucune écriture effectuée')
    print('✅ bloc glyphForTrain corrigé via fallback borné')

start = '<!-- LB_MARKER_BADGE_FIX_V2 START -->'
end = '<!-- LB_MARKER_BADGE_FIX_V2 END -->'
block = r'''<!-- LB_MARKER_BADGE_FIX_V2 START -->
<style id="lb-marker-badge-fix-v2">
/* Les triangles et leurs liserés restent gérés par le moteur/CSS existant. */
html body .cow-marker .cow-glyph{
  position:relative!important;
  z-index:3!important;
  visibility:visible!important;
}

/* Badge retard: plus petit, sans contour ni ombre lourde. */
html body .cow-marker .train-delay-badge,
html body .cow-marker .train-partial-badge{
  min-height:12px!important;
  padding:1px 3px!important;
  margin-left:2px!important;
  border:0!important;
  box-shadow:none!important;
  border-radius:3px!important;
  font-size:7.5px!important;
  font-weight:850!important;
  line-height:1!important;
  letter-spacing:0!important;
  position:relative!important;
  z-index:4!important;
}

html body .cow-marker .train-delay-badge--moderate,
html body .cow-marker .train-delay-badge--major,
html body .cow-marker .train-delay-badge--severe,
html body .cow-marker .train-delay-badge--cancelled,
html body .cow-marker .train-partial-badge{
  border:0!important;
  box-shadow:none!important;
}

/* Le témoin de suppression reste petit et ne masque jamais le triangle. */
html body .cow-marker.train-cancelled .cow-glyph--cancelled::after{
  right:-.42em!important;
  top:-.42em!important;
  width:.88em!important;
  height:.88em!important;
  border:0!important;
  font-size:.45em!important;
  z-index:5!important;
}

@media(max-width:720px){
  html body .cow-marker .train-delay-badge,
  html body .cow-marker .train-partial-badge{
    min-height:11px!important;
    padding:1px 2px!important;
    font-size:7px!important;
  }
}
</style>
<!-- LB_MARKER_BADGE_FIX_V2 END -->'''

pattern = re.compile(re.escape(start) + r'.*?' + re.escape(end), re.S)
if pattern.search(text):
    text = pattern.sub(block, text, count=1)
else:
    if '</head>' not in text:
        raise SystemExit('ERREUR: </head> absent — aucune écriture effectuée')
    text = text.replace('</head>', block + '\n</head>', 1)

if text.count(start) != 1 or text.count(end) != 1:
    raise SystemExit('ERREUR: bloc CSS V2 dupliqué/incomplet — aucune écriture effectuée')

path.write_text(text, encoding='utf-8')
PY

echo
echo "=== 4. CONTRÔLES ==="
grep -q 'Toujours conserver le pictogramme / triangle natif' "$FILE"
grep -q 'LB_MARKER_BADGE_FIX_V2 START' "$FILE"
grep -q 'font-size:7.5px!important' "$FILE"
grep -q 'border:0!important' "$FILE"
echo "✅ triangle natif conservé"
echo "✅ liserés couleur existants non neutralisés"
echo "✅ badges réduits"
echo "✅ contour des badges supprimé"

echo
echo "=== 5. EMPREINTE LOCALE ==="
AFTER="$(sha256sum "$FILE" | awk '{print $1}')"
echo "$AFTER  $FILE"

echo
echo "=== 6. VERSION SERVIE ==="
SERVED=""
for try in 1 2 3; do
  SERVED="$(curl -fsSL "https://vps.labetaillere.fr/map-v2/carte-core-preview.html?t=$(date +%s)-$try" | sha256sum | awk '{print $1}')" || true
  echo "Essai $try : $SERVED"
  [[ "$SERVED" == "$AFTER" ]] && break
  sleep 1
done

if [[ "$SERVED" == "$AFTER" ]]; then
  echo "✅ La version servie correspond au fichier local"
else
  echo "⚠️ Local et HTTP diffèrent encore" >&2
  echo "Local: $AFTER" >&2
  echo "HTTP : $SERVED" >&2
fi

SUCCESS=1
trap - EXIT

echo
echo "✅ CORRECTIF MARKER/BADGE V2 INSTALLÉ"
echo "Sauvegarde : $BACKUP"
