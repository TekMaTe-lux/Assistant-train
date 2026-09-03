#!/usr/bin/env bash
set -euo pipefail

ROOT="/opt/labetaillere-map-v2-src"
FILE="$ROOT/map-v2/public/carte-core-preview.html"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="${FILE}.bak-restore-delay-badge-yesterday-v1-${STAMP}"
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
  'train-delay-badge'; do
  grep -q "$needle" "$FILE" || { echo "ERREUR: structure inattendue, élément absent: $needle" >&2; exit 3; }
done

echo "=== VERSION AVANT ==="
sha256sum "$FILE"

echo
echo "=== SAUVEGARDE ==="
cp -p "$FILE" "$BACKUP"
echo "$BACKUP"

echo
echo "=== RESTAURATION DU BADGE D'HIER ==="
python3 - "$FILE" <<'PY'
from pathlib import Path
import re, sys

path=Path(sys.argv[1])
text=path.read_text(encoding='utf-8')

# 1) Retirer le dernier override LIGHT qui imposait height:16px.
light_start='<!-- LB_DELAY_BADGE_LIGHT_V1 START -->'
light_end='<!-- LB_DELAY_BADGE_LIGHT_V1 END -->'
text, removed = re.subn(
    re.escape(light_start)+r'.*?'+re.escape(light_end)+r'\s*',
    '', text, flags=re.S
)
print(f"ℹ️ bloc LIGHT V1 retiré : {removed}")

# 2) Restaurer exactement le style compact utilisé hier dans MARKER_BADGE_FIX_V2.
start='<!-- LB_MARKER_BADGE_FIX_V2 START -->'
end='<!-- LB_MARKER_BADGE_FIX_V2 END -->'
block=r'''<!-- LB_MARKER_BADGE_FIX_V2 START -->
<style id="lb-marker-badge-fix-v2">
/* Les triangles et leurs liserés restent gérés par le moteur/CSS existant. */
html body .cow-marker .cow-glyph{
  position:relative!important;
  z-index:3!important;
  visibility:visible!important;
}

/* STYLE COMPACT D'HIER : petit badge, plat, sans contour ni ombre. */
html body .cow-marker .train-delay-badge,
html body .cow-marker .train-partial-badge{
  height:auto!important;
  min-height:12px!important;
  padding:1px 3px!important;
  margin-left:2px!important;
  border:0!important;
  outline:0!important;
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
  outline:0!important;
  box-shadow:none!important;
}

/* Pas de hauteur/min-width héritée d'un override récent. */
html body .cow-marker .train-delay-badge{
  width:auto!important;
  min-width:0!important;
  max-width:none!important;
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
    height:auto!important;
    min-height:11px!important;
    padding:1px 2px!important;
    font-size:7px!important;
    border-radius:3px!important;
  }
}
</style>
<!-- LB_MARKER_BADGE_FIX_V2 END -->'''

pattern=re.compile(re.escape(start)+r'.*?'+re.escape(end),re.S)
text,n=pattern.subn(block,text,count=1)
if n!=1:
    raise SystemExit(f'ERREUR: bloc MARKER_BADGE_FIX_V2 attendu 1 fois, trouvé {n}')

path.write_text(text,encoding='utf-8')
print("✅ style badge compact restauré")
PY

echo
echo "=== CONTRÔLES ==="
grep -q 'STYLE COMPACT D.HIER\|STYLE COMPACT D' "$FILE" || true
grep -q 'height:auto!important' "$FILE"
grep -q 'min-height:12px!important' "$FILE"
grep -q 'font-size:7.5px!important' "$FILE"
grep -q 'padding:1px 3px!important' "$FILE"
grep -q 'border-radius:3px!important' "$FILE"
grep -q 'box-shadow:none!important' "$FILE"
if grep -q 'LB_DELAY_BADGE_LIGHT_V1 START' "$FILE"; then
  echo "ERREUR: ancien bloc LIGHT V1 encore présent" >&2
  exit 4
fi
# Les briques fonctionnelles doivent rester présentes.
grep -q 'LB_STATUS_VISIBILITY_MODAL_V1 START' "$FILE"
grep -q 'LB_PARTIAL_GHOST_V2_JS START' "$FILE"
echo "✅ LIGHT V1 supprimé"
echo "✅ hauteur fixe 16px supprimée"
echo "✅ badge restauré à 12px / 7.5px / padding 1x3"
echo "✅ liserés / retards / fantôme conservés"

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
echo "✅ BADGE D'HIER RESTAURÉ"
echo "Sauvegarde : $BACKUP"
