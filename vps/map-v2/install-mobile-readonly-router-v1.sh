#!/usr/bin/env bash
set -euo pipefail

ROOT="${LB_MAP_ROOT:-/opt/labetaillere-map-v2-src}"
PUBLIC="$ROOT/map-v2/public"
SOURCE_MOBILE="$ROOT/carte-mobile-readonly.html"
TARGET_MOBILE="$PUBLIC/carte-mobile-readonly.html"
WRAPPER="$PUBLIC/carte-preview.html"
CORE="$PUBLIC/carte-core-preview.html"
STAMP="$(date +%Y%m%d-%H%M%S-%N)"
MARKER="LB_MOBILE_READONLY_ROUTER_V1"

for f in "$SOURCE_MOBILE" "$WRAPPER" "$CORE"; do
  [[ -f "$f" ]] || { echo "ERREUR: fichier introuvable: $f" >&2; exit 2; }
done

CORE_SHA_BEFORE="$(sha256sum "$CORE" | awk '{print $1}')"
WRAPPER_BACKUP="$WRAPPER.bak-mobile-readonly-router-v1-$STAMP"
cp -a "$WRAPPER" "$WRAPPER_BACKUP"
if [[ -f "$TARGET_MOBILE" ]]; then
  cp -a "$TARGET_MOBILE" "$TARGET_MOBILE.bak-mobile-readonly-router-v1-$STAMP"
fi

install -m 0644 "$SOURCE_MOBILE" "$TARGET_MOBILE"

python3 - "$WRAPPER" <<'PY'
from pathlib import Path
import re
import sys

p = Path(sys.argv[1])
s = p.read_text(encoding='utf-8')
marker = 'LB_MOBILE_READONLY_ROUTER_V1'

# Retire une éventuelle ancienne version du routeur pour rendre l'installation idempotente.
s = re.sub(
    r'\s*<script id="lb-mobile-readonly-router-v1">.*?</script>\s*',
    '\n',
    s,
    flags=re.IGNORECASE | re.DOTALL,
)

router = r'''
<script id="lb-mobile-readonly-router-v1">
/* LB_MOBILE_READONLY_ROUTER_V1
   Téléphone = lecture seule légère. Desktop/tablette non tactile = carte complète inchangée. */
(() => {
  try {
    const narrow = window.matchMedia('(max-width: 820px)').matches;
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    const touch = navigator.maxTouchPoints > 0;
    const forceFull = new URLSearchParams(location.search).get('full') === '1';
    if (!forceFull && narrow && (coarse || touch)) {
      const target = new URL('./carte-mobile-readonly.html', location.href);
      target.searchParams.set('v', '20260906-1');
      location.replace(target.href);
    }
  } catch (_) {}
})();
</script>
'''

lower = s.lower()
pos = lower.find('</head>')
if pos < 0:
    raise SystemExit('ERREUR: </head> absent du wrapper')
s = s[:pos] + router + '\n' + s[pos:]

if s.count(marker) != 1:
    raise SystemExit('ERREUR: routeur mobile non unique')

p.write_text(s, encoding='utf-8')
PY

# Vérifications : le core desktop doit être strictement inchangé.
CORE_SHA_AFTER="$(sha256sum "$CORE" | awk '{print $1}')"
[[ "$CORE_SHA_BEFORE" == "$CORE_SHA_AFTER" ]] || {
  echo "ERREUR CRITIQUE: le core desktop a changé; restauration du wrapper." >&2
  cp -a "$WRAPPER_BACKUP" "$WRAPPER"
  exit 3
}

grep -q "$MARKER" "$WRAPPER"
grep -q "carte-mobile-readonly.html" "$WRAPPER"
grep -q "REFRESH_OK=15000" "$TARGET_MOBILE"
grep -q "/api/map-v2/trains?bbox=" "$TARGET_MOBILE"

# Syntaxe JS du fichier mobile : extrait le script inline principal et le vérifie avec Node.
TMP_JS="$(mktemp)"
trap 'rm -f "$TMP_JS"' EXIT
python3 - "$TARGET_MOBILE" "$TMP_JS" <<'PY'
from pathlib import Path
import re
import sys
html = Path(sys.argv[1]).read_text(encoding='utf-8')
scripts = re.findall(r'<script(?:\s[^>]*)?>(.*?)</script>', html, flags=re.I|re.S)
inline = [x for x in scripts if x.strip()]
if not inline:
    raise SystemExit('ERREUR: script inline mobile absent')
Path(sys.argv[2]).write_text('\n'.join(inline), encoding='utf-8')
PY
node --check "$TMP_JS"

echo "Installation mobile lecture seule terminée."
echo "- Desktop: core inchangé ($CORE_SHA_AFTER)"
echo "- Téléphone <= 820 px tactile: carte-mobile-readonly.html"
echo "- Rafraîchissement visible: 15 s, repli progressif jusqu'à 60 s en cas d'erreur"
echo "- Forcer la carte complète sur téléphone: ?full=1"
echo "- Backup wrapper: $WRAPPER_BACKUP"
echo "- URL mobile directe: https://vps.labetaillere.fr/map-v2/carte-mobile-readonly.html"
