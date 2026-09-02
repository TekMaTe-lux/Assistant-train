#!/usr/bin/env bash
set -euo pipefail

ROOT="/opt/labetaillere-map-v2-src/map-v2"
PUBLIC="$ROOT/public"
SOURCE_WRAPPER="$PUBLIC/carte-preview.html"
V4_CORE="$PUBLIC/carte-core-current-v4-preview.html"
DEST_WRAPPER="$PUBLIC/carte-current-v4-preview.html"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$ROOT/backups/current-wrapper-v4-$STAMP"
TMP="$(mktemp -d /tmp/lb-current-wrapper-v4.XXXXXX)"
SUCCESS=0

cleanup(){ rm -rf "$TMP"; }
rollback(){
  if [[ "$SUCCESS" -eq 1 ]]; then return; fi
  echo
  echo "ERREUR : rollback du wrapper preview..."
  if [[ -f "$BACKUP/$(basename "$DEST_WRAPPER")" ]]; then
    cp -a "$BACKUP/$(basename "$DEST_WRAPPER")" "$DEST_WRAPPER"
  else
    rm -f "$DEST_WRAPPER"
  fi
}
trap 'rollback; cleanup' EXIT

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  echo "ERREUR : lancer avec sudo/root" >&2
  exit 2
fi

for f in "$SOURCE_WRAPPER" "$V4_CORE"; do
  [[ -f "$f" ]] || { echo "ERREUR : fichier absent: $f" >&2; exit 3; }
done

# La logique métier V4/CFL doit déjà être présente dans le core testé.
grep -q 'LB_CANONICAL_MAP_PREVIEW_V1' "$V4_CORE" || { echo "ERREUR : V4 absent du core preview" >&2; exit 4; }
grep -q 'LB_CFL_OFFICIAL_MOTION_V3' "$V4_CORE" || { echo "ERREUR : correctif CFL V3 absent du core preview" >&2; exit 5; }

mkdir -p "$BACKUP"
[[ -f "$DEST_WRAPPER" ]] && cp -a "$DEST_WRAPPER" "$BACKUP/$(basename "$DEST_WRAPPER")"
cp -a "$SOURCE_WRAPPER" "$TMP/carte-current-v4-preview.html"

SOURCE_SHA_BEFORE="$(sha256sum "$SOURCE_WRAPPER" | awk '{print $1}')"
CACHE_BUST="$(date +%s)"

echo "============================================================"
echo "ALIGNEMENT PREVIEW V4 SUR LE WRAPPER ACTUEL"
echo "============================================================"
echo "Wrapper source : $SOURCE_WRAPPER"
echo "SHA source     : $SOURCE_SHA_BEFORE"
echo "Core V4        : $V4_CORE"
echo

python3 - "$TMP/carte-current-v4-preview.html" "$CACHE_BUST" <<'PY'
from pathlib import Path
import re,sys

path=Path(sys.argv[1])
version=sys.argv[2]
text=path.read_text(encoding='utf-8')
original=text

# IMPORTANT : on conserve intégralement le wrapper utilisé aujourd'hui par la
# carte (tableaux, tabs, bouton Gare dynamique, responsive, pont postMessage).
# La seule chose remplacée est la cible du core cartographique.
pattern=re.compile(r'carte-core-preview\.html(?:\?[^\"\'\s<>]*)?')
matches=pattern.findall(text)
if not matches:
    raise SystemExit('ERREUR : aucune référence carte-core-preview.html dans le wrapper actuel')

replacement=f'carte-core-current-v4-preview.html?v={version}'
text=pattern.sub(replacement,text)

# Le wrapper actuel doit porter au moins la logique UI Luxembourg d'une façon
# ou d'une autre. On n'invente pas cette UI : on la reprend de la production.
lux_markers=(
    'lb:open-lux-dynamic',
    'Gare dynamique',
    'luxembourg-user-preview',
)
if not any(marker in original for marker in lux_markers):
    raise SystemExit('ERREUR : wrapper actuel sans marqueur de gare dynamique Luxembourg')

# Sécurité : aucune autre transformation n'est autorisée.
restored=text.replace(replacement,'carte-core-preview.html')
normalized_original=pattern.sub('carte-core-preview.html',original)
if restored != normalized_original:
    raise SystemExit('ERREUR : le wrapper a subi une modification autre que la cible core')

if 'carte-core-current-v4-preview.html' not in text:
    raise SystemExit('ERREUR : cible V4 absente après patch')
if 'carte-core-preview.html' in pattern.sub('', text):
    raise SystemExit('ERREUR : ancienne cible core restante')

path.write_text(text,encoding='utf-8')
print(f'Wrapper actuel conservé ; {len(matches)} référence(s) core redirigée(s) vers V4')
print('Marqueur Luxembourg :', next(marker for marker in lux_markers if marker in original))
PY

install -m 0644 "$TMP/carte-current-v4-preview.html" "$DEST_WRAPPER"

# Le wrapper de production ne doit jamais être modifié.
SOURCE_SHA_AFTER="$(sha256sum "$SOURCE_WRAPPER" | awk '{print $1}')"
if [[ "$SOURCE_SHA_AFTER" != "$SOURCE_SHA_BEFORE" ]]; then
  echo "ERREUR CRITIQUE : le wrapper de production a changé" >&2
  exit 6
fi

python3 - "$SOURCE_WRAPPER" "$DEST_WRAPPER" <<'PY'
from pathlib import Path
import sys
src=Path(sys.argv[1]).read_text(encoding='utf-8')
dst=Path(sys.argv[2]).read_text(encoding='utf-8')
assert 'carte-core-current-v4-preview.html' in dst
for marker in ('lb:open-lux-dynamic','Gare dynamique','luxembourg-user-preview'):
    if marker in src:
        assert marker in dst, marker
print(f'Structure wrapper conservée : source={len(src)} octets · preview={len(dst)} octets')
PY

SUCCESS=1
trap - EXIT
cleanup

echo
echo "============================================================"
echo "PREVIEW V4 ALIGNEE SUR LA CARTE ACTUELLE"
echo "============================================================"
echo "Tableaux / tabs actuels : CONSERVES"
echo "Gare dynamique Lux      : CONSERVEE"
echo "Core métier             : V4 + shapes CFL"
echo "Production              : NON MODIFIEE"
echo
echo "URL : https://vps.labetaillere.fr/map-v2/carte-current-v4-preview.html"
echo "============================================================"
