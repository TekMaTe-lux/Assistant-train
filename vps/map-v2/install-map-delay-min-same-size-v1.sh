#!/usr/bin/env bash
set -euo pipefail

ROOT="${LB_MAP_ROOT:-/opt/labetaillere-map-v2-src}"
CORE="$ROOT/map-v2/public/carte-core-preview.html"
STAMP="$(date +%Y%m%d-%H%M%S-%N)"
BACKUP="${CORE}.bak-delay-min-same-size-v1-${STAMP}"
SUCCESS=0

rollback(){
  if [[ "$SUCCESS" -eq 1 ]]; then return; fi
  echo "ERREUR — restauration automatique" >&2
  [[ -f "$BACKUP" ]] && cp -a "$BACKUP" "$CORE"
}
trap rollback EXIT

[[ -f "$CORE" ]] || { echo "ERREUR: fichier introuvable: $CORE" >&2; exit 2; }
grep -q 'LB_DELAY_BADGE_TRON_FILL_V2_CSS START' "$CORE" || { echo "ERREUR: style retard officiel V2 absent" >&2; exit 3; }
grep -q "content:' min'!important" "$CORE" || { echo "ERREUR: unité min actuelle introuvable" >&2; exit 4; }

cp -a "$CORE" "$BACKUP"

python3 - "$CORE" <<'PY'
from pathlib import Path
import re, sys

p = Path(sys.argv[1])
s = p.read_text(encoding='utf-8')

style_id = 'lb-delay-min-same-size-v1'
# Idempotence : remplacer notre ancien override s'il existe déjà.
s = re.sub(
    rf'<style\s+id=["\']{re.escape(style_id)}["\'][^>]*>.*?</style>\s*',
    '',
    s,
    flags=re.S | re.I,
)

css = r'''
<style id="lb-delay-min-same-size-v1">
/* LB_DELAY_MIN_SAME_SIZE_V1
   Le « min » du retard officiel a exactement la même taille/hauteur que la valeur.
   Aucun changement de couleur, dimensions du badge, logique retard ou position. */
html body .cow-marker .train-delay-badge.train-delay-badge--moderate::after,
html body .cow-marker .train-delay-badge.train-delay-badge--major::after,
html body .cow-marker .train-delay-badge.train-delay-badge--severe::after{
  font-size:1em!important;
  font-weight:900!important;
  line-height:inherit!important;
  vertical-align:baseline!important;
  opacity:1!important;
}
</style>
'''

pos = s.lower().rfind('</head>')
if pos < 0:
    raise SystemExit('ERREUR: </head> absent')
s = s[:pos] + css + '\n' + s[pos:]

if s.count('LB_DELAY_MIN_SAME_SIZE_V1') != 1:
    raise SystemExit('ERREUR: override min non unique')
if s.count(f'id="{style_id}"') != 1:
    raise SystemExit('ERREUR: style min dupliqué')

p.write_text(s, encoding='utf-8')
PY

grep -q 'LB_DELAY_MIN_SAME_SIZE_V1' "$CORE"
grep -q 'font-size:1em!important' "$CORE"
grep -q 'font-weight:900!important' "$CORE"
grep -q 'vertical-align:baseline!important' "$CORE"

echo "Installation terminée."
echo "- Retard officiel: +15min"
echo "- 'min': même taille que '15'"
echo "- 'min': même ligne / même hauteur"
echo "- Couleurs: non modifiées"
echo "- Position du badge: non modifiée"
echo "- Retard communautaire: non modifié"
echo "- Flèche train: non modifiée"
echo "Core: $(sha256sum "$CORE" | awk '{print $1}')"

SUCCESS=1
trap - EXIT
