#!/usr/bin/env bash
set -euo pipefail

ROOT="${LB_WEB_ROOT:-/var/www/html}"
HTML="$ROOT/index.html"
ASSET_REL="assets/lb-home-favorites-next-date-v1.js"
ASSET="$ROOT/$ASSET_REL"
RAW="https://raw.githubusercontent.com/TekMaTe-lux/Assistant-train/main/assets/lb-home-favorites-next-date-v1.js"
STAMP="$(date +%Y%m%d-%H%M%S)"
HTML_BACKUP="$HTML.bak-home-fav-next-date-$STAMP"
ASSET_BACKUP="$ASSET.bak-$STAMP"
TMP_ASSET="$(mktemp /tmp/lb-home-favorites-next-date.XXXXXX.js)"
TMP_HTML="$(mktemp /tmp/lb-home-index.XXXXXX.html)"
trap 'rm -f "$TMP_ASSET" "$TMP_HTML"' EXIT

[[ -f "$HTML" ]] || { echo "ERREUR: $HTML introuvable" >&2; exit 2; }

curl -fsSL "$RAW?$(date +%s)" -o "$TMP_ASSET"

grep -q "home-fav-next-service" "$TMP_ASSET" || {
  echo "ERREUR: asset téléchargé incomplet" >&2
  exit 3
}

if command -v node >/dev/null 2>&1; then
  node --check "$TMP_ASSET"
fi

mkdir -p "$(dirname "$ASSET")"
cp -a "$HTML" "$HTML_BACKUP"
if [[ -f "$ASSET" ]]; then
  cp -a "$ASSET" "$ASSET_BACKUP"
fi
install -m 0644 "$TMP_ASSET" "$ASSET"

python3 - "$HTML" "$TMP_HTML" <<'PY'
import re
import sys
from pathlib import Path

src = Path(sys.argv[1])
out = Path(sys.argv[2])
s = src.read_text(encoding='utf-8')

# Retire uniquement une ancienne inclusion de CE patch, s'il y en a une.
s = re.sub(
    r'\n?[ \t]*<script\b[^>]*src=["\'][^"\']*lb-home-favorites-next-date-v1\.js[^"\']*["\'][^>]*>\s*</script>[ \t]*\n?',
    '\n',
    s,
    flags=re.I,
)
tag = '<script src="./assets/lb-home-favorites-next-date-v1.js?v=20260906-1"></script>'

body_matches = list(re.finditer(r'</body\s*>', s, flags=re.I))
if len(body_matches) != 1:
    raise SystemExit(f"ERREUR: </body> trouvé {len(body_matches)} fois")

m = body_matches[0]
s = s[:m.start()] + tag + '\n' + s[m.start():]

if s.count('lb-home-favorites-next-date-v1.js') != 1:
    raise SystemExit('ERREUR: inclusion du patch non unique')

out.write_text(s, encoding='utf-8')
PY

# Validation avant remplacement du fichier live.
grep -q 'lb-home-favorites-next-date-v1.js?v=20260906-1' "$TMP_HTML"
grep -q '</body>' "$TMP_HTML"

install -m 0644 "$TMP_HTML" "$HTML"

echo "OK: date de prochaine circulation ajoutée sous les horaires des raccourcis favoris."
echo "HTML sauvegardé: $HTML_BACKUP"
if [[ -f "$ASSET_BACKUP" ]]; then
  echo "Asset précédent sauvegardé: $ASSET_BACKUP"
fi
echo "Asset installé: $ASSET"
