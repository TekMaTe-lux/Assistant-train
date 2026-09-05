#!/usr/bin/env bash
set -euo pipefail

ROOT="${LB_MAP_ROOT:-/opt/labetaillere-map-v2-src}"
PUBLIC="$ROOT/map-v2/public"
TARGET="$PUBLIC/community-site-test-v1"
STAMP="$(date +%Y%m%d-%H%M%S-%N)"
WORK="$(mktemp -d)"
ARCHIVE="$WORK/site.tar.gz"
UNPACK="$WORK/unpack"
STAGING="$PUBLIC/.community-site-test-v1.staging-$STAMP"
ARCHIVE_URL="https://codeload.github.com/TekMaTe-lux/Assistant-train/tar.gz/refs/heads/feat/voix-betail-carte-gps-v1"

cleanup(){ rm -rf "$WORK" "$STAGING"; }
trap cleanup EXIT

[[ -d "$PUBLIC" ]] || { echo "ERREUR: dossier public introuvable: $PUBLIC" >&2; exit 2; }

curl -fsSL --retry 3 --connect-timeout 20 "$ARCHIVE_URL" -o "$ARCHIVE"
mkdir -p "$UNPACK" "$STAGING"
tar -xzf "$ARCHIVE" -C "$UNPACK"
SOURCE="$(find "$UNPACK" -mindepth 1 -maxdepth 1 -type d -print -quit)"
[[ -f "$SOURCE/index.html" ]] || { echo "ERREUR: index de la branche introuvable" >&2; exit 3; }

cp -a "$SOURCE"/. "$STAGING"/
rm -rf "$STAGING/.github" "$STAGING/vps" "$STAGING/tests"

python3 - "$STAGING" <<'PY'
from pathlib import Path
import sys

root = Path(sys.argv[1])
index = root / "index.html"
text = index.read_text(encoding="utf-8")
text = text.replace(
    './assets/home-major-alerts.js?v=20260905-1',
    './assets/home-major-alerts.js?v=20260905-2',
)
for name in ("confidentialite.html", "mentions-legales.html", "jeuBETA1.html"):
    text = text.replace(f'href="/{name}', f'href="./{name}')
text = text.replace('src="/ber_icons_pack/', 'src="./ber_icons_pack/')
index.write_text(text, encoding="utf-8")

preview = root / "assets" / "lb-v4-live-preview.js"
if preview.exists():
    js = preview.read_text(encoding="utf-8")
    js = js.replace("'/assets/", "'./assets/").replace('"/assets/', '"./assets/')
    preview.write_text(js, encoding="utf-8")
PY

for required in \
  "$STAGING/index.html" \
  "$STAGING/carte.html" \
  "$STAGING/assets/lb-community-map-bridge-v1.js"; do
  [[ -f "$required" ]] || { echo "ERREUR: fichier de test absent: $required" >&2; exit 4; }
done

grep -q 'lbCommunityDemo' "$STAGING/assets/lb-community-map-bridge-v1.js" || {
  echo "ERREUR: le mode démonstration sécurisé est absent" >&2
  exit 5
}
grep -q 'carte-community-test-v1.html' "$STAGING/carte.html" || {
  echo "ERREUR: la page ne pointe pas vers la carte VPS de test" >&2
  exit 6
}

if [[ -d "$TARGET" ]]; then
  mv "$TARGET" "$TARGET.bak-$STAMP"
fi
mv "$STAGING" "$TARGET"

echo "Site de test VPS installé; production inchangée."
echo "URL: https://vps.labetaillere.fr/map-v2/community-site-test-v1/?lbCommunityDemo=1&lbCommunityTrain=88733#carte"
echo "Index: $(sha256sum "$TARGET/index.html" | awk '{print $1}')"
echo "Retour arrière: rm -rf '$TARGET'"
