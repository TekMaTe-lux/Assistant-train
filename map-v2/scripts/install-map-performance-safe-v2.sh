#!/usr/bin/env bash
set -euo pipefail

ROOT="${LB_MAP_ROOT:-/opt/labetaillere-map-v2-src}"
PUBLIC="$ROOT/map-v2/public"
CORE="$PUBLIC/carte-core-preview.html"
WRAPPER="$PUBLIC/carte-preview.html"
V1="$PUBLIC/assets/lb-community-traveler-v1.js"
V2="$PUBLIC/assets/lb-community-traveler-compact-v2.js"
TARGET_MOBILE="$PUBLIC/carte-mobile-readonly.html"
STAMP="$(date +%Y%m%d-%H%M%S-%N)"
BACKUP="$ROOT/backups/map-performance-safe-v2-$STAMP"
TMP="$(mktemp -d /tmp/lb-map-perf-v2-XXXXXX)"

cleanup(){ rm -rf "$TMP"; }
trap cleanup EXIT

for f in "$CORE" "$WRAPPER" "$V1" "$V2"; do
  [[ -f "$f" ]] || { echo "ERREUR: fichier introuvable: $f" >&2; exit 2; }
done

mkdir -p "$BACKUP"
cp -a "$CORE" "$BACKUP/carte-core-preview.html"
cp -a "$WRAPPER" "$BACKUP/carte-preview.html"
cp -a "$V1" "$BACKUP/lb-community-traveler-v1.js"
cp -a "$V2" "$BACKUP/lb-community-traveler-compact-v2.js"
[[ -f "$TARGET_MOBILE" ]] && cp -a "$TARGET_MOBILE" "$BACKUP/carte-mobile-readonly.html"

rollback(){
  echo "ERREUR: restauration automatique..." >&2
  cp -a "$BACKUP/carte-core-preview.html" "$CORE"
  cp -a "$BACKUP/carte-preview.html" "$WRAPPER"
  cp -a "$BACKUP/lb-community-traveler-v1.js" "$V1"
  cp -a "$BACKUP/lb-community-traveler-compact-v2.js" "$V2"
  if [[ -f "$BACKUP/carte-mobile-readonly.html" ]]; then
    cp -a "$BACKUP/carte-mobile-readonly.html" "$TARGET_MOBILE"
  else
    rm -f "$TARGET_MOBILE"
  fi
}
trap rollback ERR

# Le checkout du VPS peut être sparse et ne pas matérialiser vps/map-v2/.
# On lit donc les fichiers directement depuis l'objet Git déjà récupéré par git pull.
git -C "$ROOT" show origin/main:vps/map-v2/install-community-fast-marker-stack-v1.sh > "$TMP/fast.sh"
git -C "$ROOT" show origin/main:carte-mobile-readonly.html > "$TMP/carte-mobile-readonly.html"
chmod 700 "$TMP/fast.sh"

grep -q 'LB_COMMUNITY_FAST_MARKER_STACK_V1' "$TMP/fast.sh"
grep -q 'REFRESH_OK=15000' "$TMP/carte-mobile-readonly.html"
grep -q '/api/map-v2/trains?bbox=' "$TMP/carte-mobile-readonly.html"

# 1) Desktop : conserve toutes les fonctions, retire uniquement les rescans globaux coûteux.
LB_MAP_ROOT="$ROOT" bash "$TMP/fast.sh"

# 2) Mobile : installe la vue lecture seule légère.
install -m 0644 "$TMP/carte-mobile-readonly.html" "$TARGET_MOBILE"

CORE_AFTER_FAST="$(sha256sum "$CORE" | awk '{print $1}')"

# 3) Routeur mobile dans le wrapper uniquement. Le core desktop ne doit plus bouger.
python3 - "$WRAPPER" <<'PY'
from pathlib import Path
import re
import sys

p = Path(sys.argv[1])
s = p.read_text(encoding='utf-8')
marker = 'LB_MOBILE_READONLY_ROUTER_V2'

s = re.sub(
    r'\s*<script id="lb-mobile-readonly-router-v[12]">.*?</script>\s*',
    '\n', s, flags=re.I | re.S,
)

router = r'''
<script id="lb-mobile-readonly-router-v2">
/* LB_MOBILE_READONLY_ROUTER_V2 : téléphone = lecture seule légère ; desktop inchangé. */
(() => {
  try {
    const narrow = matchMedia('(max-width: 820px)').matches;
    const coarse = matchMedia('(pointer: coarse)').matches;
    const touch = navigator.maxTouchPoints > 0;
    const forceFull = new URLSearchParams(location.search).get('full') === '1';
    if (!forceFull && narrow && (coarse || touch)) {
      const target = new URL('./carte-mobile-readonly.html', location.href);
      target.searchParams.set('v', '20260906-2');
      location.replace(target.href);
    }
  } catch (_) {}
})();
</script>
'''

pos = s.lower().find('</head>')
if pos < 0:
    raise SystemExit('ERREUR: </head> absent du wrapper')
s = s[:pos] + router + '\n' + s[pos:]
if s.count(marker) != 1:
    raise SystemExit('ERREUR: routeur mobile non unique')
p.write_text(s, encoding='utf-8')
PY

[[ "$CORE_AFTER_FAST" == "$(sha256sum "$CORE" | awk '{print $1}')" ]] || {
  echo "ERREUR: le routeur mobile a modifié le core desktop" >&2
  exit 4
}

# Vérifications syntaxiques et garde-fous.
node --check "$V1"
node --check "$V2"

grep -q 'LB_COMMUNITY_FAST_MARKER_STACK_V1: pas de rescan global par icône' "$V1"
grep -q 'LB_COMMUNITY_FAST_MARKER_STACK_V1: rendu déjà final, aucun rescan par icône' "$V2"
grep -q 'LB_COMMUNITY_MARKER_STACK_CSS_V1' "$CORE"
grep -q 'LB_SERVICE_DAY_ROLLOVER_V1' "$CORE"
grep -q 'LB_MOBILE_READONLY_ROUTER_V2' "$WRAPPER"
grep -q 'REFRESH_OK=15000' "$TARGET_MOBILE"

if grep -q 'lb-map-visual-stability-v1' "$CORE"; then
  echo "ERREUR: ancien module lourd visual-stability détecté" >&2
  exit 5
fi

TMP_JS="$TMP/mobile-inline.js"
python3 - "$TARGET_MOBILE" "$TMP_JS" <<'PY'
from pathlib import Path
import re, sys
html = Path(sys.argv[1]).read_text(encoding='utf-8')
scripts = re.findall(r'<script(?:\s[^>]*)?>(.*?)</script>', html, flags=re.I|re.S)
inline = [x for x in scripts if x.strip()]
if not inline:
    raise SystemExit('ERREUR: script inline mobile absent')
Path(sys.argv[2]).write_text('\n'.join(inline), encoding='utf-8')
PY
node --check "$TMP_JS"

trap - ERR

echo
echo "OK — optimisation carte v2 installée."
echo "Backup: $BACKUP"
echo "Desktop: fonctions conservées ; rescans globaux par icône supprimés."
echo "Mobile <= 820 px tactile: lecture seule légère, refresh 15 s."
echo "Service: non redémarré."
echo "Forcer la carte complète sur mobile: ?full=1"
echo "Core:    $(sha256sum "$CORE" | awk '{print $1}')"
echo "Wrapper: $(sha256sum "$WRAPPER" | awk '{print $1}')"
