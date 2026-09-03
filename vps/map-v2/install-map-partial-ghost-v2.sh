#!/usr/bin/env bash
set -euo pipefail

ROOT="/opt/labetaillere-map-v2-src"
FILE="$ROOT/map-v2/public/carte-core-preview.html"
EXPECTED_BEFORE="9e28126dd2cd1a0ef4748a3c0c979f8413287d4eed9749d3dffdc9e99f69e4b0"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="${FILE}.bak-partial-ghost-v2-${STAMP}"
TMP_JS="/tmp/lb-partial-ghost-v2-${STAMP}.js"
TMP_CSS="/tmp/lb-partial-ghost-v2-${STAMP}.css"
EMBEDDED_JS="/tmp/lb-partial-ghost-v2-embedded-${STAMP}.js"
RAW_BASE="https://raw.githubusercontent.com/TekMaTe-lux/Assistant-train/main/vps/map-v2"
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

if [[ ! -f "$FILE" ]]; then
  echo "ERREUR: fichier introuvable: $FILE" >&2
  exit 2
fi

for needle in \
  'computeTrainDelayInfo' \
  'glyphForTrain' \
  'iconForTrain' \
  'trainIconSignature' \
  'renderTripPanel' \
  'pathBetweenStops' \
  'LB_STATUS_VISIBILITY_MODAL_V1'; do
  if ! grep -q "$needle" "$FILE"; then
    echo "ERREUR: structure inattendue, élément absent: $needle" >&2
    exit 3
  fi
done

echo "=== 1. VERSION ACTUELLE ==="
CURRENT="$(sha256sum "$FILE" | awk '{print $1}')"
echo "Attendu avant première installation : $EXPECTED_BEFORE"
echo "Présent                         : $CURRENT"

if [[ "$CURRENT" != "$EXPECTED_BEFORE" ]] && ! grep -q 'LB_PARTIAL_GHOST_V2_JS START' "$FILE"; then
  echo "❌ La carte a changé depuis le dernier contrôle — arrêt sans modification." >&2
  echo "   Envoie-moi cette empreinte avant de continuer : $CURRENT" >&2
  exit 4
fi

echo
echo "=== 2. TÉLÉCHARGEMENT DU CORRECTIF ==="
curl -fL "${RAW_BASE}/lb-partial-ghost-v2.js?t=$(date +%s)" -o "$TMP_JS"
curl -fL "${RAW_BASE}/lb-partial-ghost-v2.css?t=$(date +%s)" -o "$TMP_CSS"
[[ -s "$TMP_JS" && -s "$TMP_CSS" ]] || { echo "ERREUR: correctif téléchargé vide" >&2; exit 5; }
echo "JS  : $(wc -c < "$TMP_JS") octets"
echo "CSS : $(wc -c < "$TMP_CSS") octets"

if command -v node >/dev/null 2>&1; then
  node --check "$TMP_JS" >/dev/null
  echo "✅ JavaScript téléchargé valide"
else
  echo "⚠️ node absent : contrôle syntaxique JS téléchargé ignoré"
fi

echo
echo "=== 3. SAUVEGARDE ==="
cp -p "$FILE" "$BACKUP"
echo "Sauvegarde : $BACKUP"

echo
echo "=== 4. INSTALLATION ==="
python3 - "$FILE" "$TMP_CSS" "$TMP_JS" <<'PY'
from pathlib import Path
import re
import sys

html_path = Path(sys.argv[1])
css_path = Path(sys.argv[2])
js_path = Path(sys.argv[3])
text = html_path.read_text(encoding='utf-8')
css = css_path.read_text(encoding='utf-8').strip()
js = js_path.read_text(encoding='utf-8').strip()

css_start = '<!-- LB_PARTIAL_GHOST_V2_CSS START -->'
css_end = '<!-- LB_PARTIAL_GHOST_V2_CSS END -->'
js_start = '<!-- LB_PARTIAL_GHOST_V2_JS START -->'
js_end = '<!-- LB_PARTIAL_GHOST_V2_JS END -->'

css_block = f'''{css_start}\n<style id="lb-partial-ghost-v2-css">\n{css}\n</style>\n{css_end}'''
js_block = f'''{js_start}\n<script id="lb-partial-ghost-v2-js">\n{js}\n</script>\n{js_end}'''

def replace_or_insert(text, start, end, block, closing):
    pattern = re.compile(re.escape(start) + r'.*?' + re.escape(end), re.S)
    if pattern.search(text):
        text, count = pattern.subn(lambda _m: block, text, count=1)
        return text, 'remplacé', count
    if closing not in text:
        raise SystemExit(f'ERREUR: {closing} absent')
    return text.replace(closing, block + '\n' + closing, 1), 'ajouté', 1

text, css_action, _ = replace_or_insert(text, css_start, css_end, css_block, '</head>')
text, js_action, _ = replace_or_insert(text, js_start, js_end, js_block, '</body>')

for marker in (css_start, css_end, js_start, js_end):
    if text.count(marker) != 1:
        raise SystemExit(f'ERREUR: marqueur dupliqué/incomplet: {marker}')

html_path.write_text(text, encoding='utf-8')
print(f'CSS {css_action}; JS {js_action}')
PY

echo
echo "=== 5. CONTRÔLES STRUCTURELS ==="
[[ "$(grep -c 'LB_PARTIAL_GHOST_V2_CSS START' "$FILE")" -eq 1 ]]
[[ "$(grep -c 'LB_PARTIAL_GHOST_V2_JS START' "$FILE")" -eq 1 ]]
[[ "$(grep -c 'id="lb-partial-ghost-v2-css"' "$FILE")" -eq 1 ]]
[[ "$(grep -c 'id="lb-partial-ghost-v2-js"' "$FILE")" -eq 1 ]]

grep -q "Un SUP. n'est autorise que si TOUT le trajet est prouve supprime" "$FILE"
grep -q "train-partial-ghost" "$FILE"
grep -q "train-partial-badge" "$FILE"
grep -q "lbRenderGhostRouteForTrain" "$FILE"
grep -q "dashArray:'8 7'" "$FILE"

echo "✅ distinction total / partiel présente"
echo "✅ pictogramme conservé pour une suppression totale"
echo "✅ état PART. présent pour une circulation partielle"
echo "✅ moteur de trajet fantôme présent"

python3 - "$FILE" "$EMBEDDED_JS" <<'PY'
from pathlib import Path
import re
import sys
text = Path(sys.argv[1]).read_text(encoding='utf-8')
m = re.search(r'<!-- LB_PARTIAL_GHOST_V2_JS START -->\s*<script[^>]*>(.*?)</script>\s*<!-- LB_PARTIAL_GHOST_V2_JS END -->', text, re.S)
if not m:
    raise SystemExit('ERREUR: JS embarqué introuvable')
Path(sys.argv[2]).write_text(m.group(1).strip() + '\n', encoding='utf-8')
PY

if command -v node >/dev/null 2>&1; then
  node --check "$EMBEDDED_JS" >/dev/null
  echo "✅ JavaScript embarqué valide"
fi

echo
echo "=== 6. EMPREINTE FINALE ==="
AFTER="$(sha256sum "$FILE" | awk '{print $1}')"
echo "$AFTER  $FILE"

echo
echo "=== 7. VERSION SERVIE ==="
SERVED=""
for try in 1 2 3; do
  SERVED="$(curl -fsSL "https://vps.labetaillere.fr/map-v2/carte-core-preview.html?t=$(date +%s)-$try" | sha256sum | awk '{print $1}')" || true
  echo "Essai $try : $SERVED"
  [[ "$SERVED" == "$AFTER" ]] && break
  sleep 1
done

if [[ "$SERVED" != "$AFTER" ]]; then
  echo "⚠️ Le fichier local est valide mais la version HTTP n'a pas encore la même empreinte." >&2
  echo "   Local : $AFTER" >&2
  echo "   HTTP  : $SERVED" >&2
else
  echo "✅ La version servie correspond au fichier local"
fi

SUCCESS=1
trap - EXIT

echo
echo "✅ CORRECTIF PARTIAL GHOST V2 INSTALLÉ"
echo "✅ Une gare intermédiaire supprimée/non desservie ne met plus le train en SUP."
echo "✅ SUP. est réservé à une suppression totale prouvée sur tout le trajet"
echo "✅ Le pictogramme du train reste visible ; la croix devient un petit témoin"
echo "✅ Une circulation partielle reçoit un signal PART. gris fantôme"
echo "✅ Une portion supprimée en tête/queue est tracée en trajet fantôme gris bleuté pointillé"
echo "✅ Une gare isolée non desservie est marquée sans fantômiser la voie que le train continue d'emprunter"
echo "Sauvegarde : $BACKUP"
