#!/usr/bin/env bash
set -euo pipefail

ROOT="/opt/labetaillere-map-v2-src/map-v2"
PUBLIC="$ROOT/public"
SOURCE_WRAPPER="$PUBLIC/carte-preview.html"
CORE_V4="$PUBLIC/carte-core-current-v4-preview.html"
DEST_WRAPPER="$PUBLIC/carte-current-v4-preview.html"
STAMP="$(date +%Y%m%d-%H%M%S)"
CACHE_BUST="$(date +%s)"
BACKUP="$ROOT/backups/current-wrapper-v4-v2-$STAMP"
TMP="$(mktemp -d /tmp/lb-current-wrapper-v4-v2.XXXXXX)"
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

for f in "$SOURCE_WRAPPER" "$CORE_V4"; do
  [[ -f "$f" ]] || { echo "ERREUR : fichier absent: $f" >&2; exit 3; }
done

# Le core métier doit déjà être la version V4 complète validée.
grep -q 'LB_CANONICAL_MAP_PREVIEW_V1' "$CORE_V4" || {
  echo "ERREUR : core V4 sans moteur canonique" >&2; exit 4;
}
grep -q 'LB_CFL_OFFICIAL_MOTION_V3' "$CORE_V4" || {
  echo "ERREUR : core V4 sans correctif shapes CFL" >&2; exit 5;
}

mkdir -p "$BACKUP"
[[ -f "$DEST_WRAPPER" ]] && cp -a "$DEST_WRAPPER" "$BACKUP/$(basename "$DEST_WRAPPER")"

SOURCE_SHA_BEFORE="$(sha256sum "$SOURCE_WRAPPER" | awk '{print $1}')"
CORE_SHA="$(sha256sum "$CORE_V4" | awk '{print $1}')"

printf '%s\n' "============================================================"
printf '%s\n' "WRAPPER V4 V2 — COPIE EXACTE DE LA CARTE ACTUELLE"
printf '%s\n' "============================================================"
printf 'Wrapper production : %s\n' "$SOURCE_WRAPPER"
printf 'SHA wrapper         : %s\n' "$SOURCE_SHA_BEFORE"
printf 'Core V4             : %s\n' "$CORE_V4"
printf 'SHA core V4         : %s\n' "$CORE_SHA"
printf '\n'

python3 - "$SOURCE_WRAPPER" "$TMP/carte-current-v4-preview.html" "$CACHE_BUST" <<'PY'
from pathlib import Path
import re,sys

src = Path(sys.argv[1])
dst = Path(sys.argv[2])
stamp = sys.argv[3]
text = src.read_text(encoding='utf-8')

# On ne suppose RIEN sur la façon dont la gare dynamique est implémentée dans
# le wrapper actuel. On garde donc le fichier strictement identique et on ne
# remplace que les URL qui pointent vers l'ancien core.
pattern = re.compile(
    r'(?P<url>(?:https://vps\.labetaillere\.fr/map-v2/|/map-v2/|\./)?carte-core-preview\.html)'
    r'(?:\?[^\"\'`\s<>]*)?'
)

matches = [m.group(0) for m in pattern.finditer(text)]
print('Références core détectées :', len(matches))
for item in matches:
    print(' -', item)

if not matches:
    # Diagnostic utile sans toucher au wrapper de production.
    candidates=[]
    for line in text.splitlines():
        low=line.lower()
        if 'iframe' in low or 'carte-core' in low or ('src=' in low and '.html' in low):
            candidates.append(line.strip())
    print('\nExtraits wrapper pertinents :')
    for line in candidates[:60]:
        print(' >', line[:500])
    raise SystemExit('ERREUR : aucune référence carte-core-preview.html détectée')

replacement = f'carte-core-current-v4-preview.html?v4preview={stamp}'
patched, count = pattern.subn(replacement, text)
if count != len(matches) or count < 1:
    raise SystemExit(f'ERREUR : remplacement incohérent {count}/{len(matches)}')

# Protection : aucune autre transformation ne doit être faite par ce script.
# Une fois les nouvelles URL retransformées en un token neutre, le nombre de
# caractères hors URL doit rester identique.
neutral_src = pattern.sub('__LB_CORE__', text)
neutral_dst = re.sub(
    r'carte-core-current-v4-preview\.html\?v4preview=\d+',
    '__LB_CORE__',
    patched
)
if neutral_src != neutral_dst:
    raise SystemExit('ERREUR : le wrapper aurait subi une modification hors URL core')

# Le contenu UI / scripts / tabs / ponts existants reste donc intégralement
# celui du wrapper de production, qu'il contienne ou non un marqueur nommé.
dst.write_text(patched, encoding='utf-8')
print(f'Wrapper cloné : {count} URL core remplacée(s), aucune autre modification')
PY

install -m 0644 "$TMP/carte-current-v4-preview.html" "$DEST_WRAPPER"

# Contrôles après écriture.
grep -q 'carte-core-current-v4-preview.html?v4preview=' "$DEST_WRAPPER" || {
  echo "ERREUR : destination sans core V4" >&2; exit 6;
}
if grep -qE '(^|[/])carte-core-preview\.html([?"'"'"'[:space:]<]|$)' "$DEST_WRAPPER"; then
  echo "ERREUR : une référence vers l'ancien core subsiste" >&2
  exit 7
fi

SOURCE_SHA_AFTER="$(sha256sum "$SOURCE_WRAPPER" | awk '{print $1}')"
if [[ "$SOURCE_SHA_AFTER" != "$SOURCE_SHA_BEFORE" ]]; then
  echo "ERREUR CRITIQUE : carte-preview.html de production a changé" >&2
  exit 8
fi

DEST_SIZE="$(stat -c%s "$DEST_WRAPPER")"
SOURCE_SIZE="$(stat -c%s "$SOURCE_WRAPPER")"

SUCCESS=1
trap - EXIT
cleanup

printf '\n%s\n' "============================================================"
printf '%s\n' "PREVIEW V4 ALIGNEE SANS TOUCHER A L'UI"
printf '%s\n' "============================================================"
printf 'Wrapper UI actuel    : copie exacte\n'
printf 'Seule différence     : core -> V4 + shapes CFL\n'
printf 'Wrapper production   : INTACT (%s)\n' "$SOURCE_SHA_AFTER"
printf 'Taille source/dest   : %s / %s octets\n' "$SOURCE_SIZE" "$DEST_SIZE"
printf 'Production           : NON MODIFIEE\n'
printf '\nURL : https://vps.labetaillere.fr/map-v2/carte-current-v4-preview.html?v=%s\n' "$CACHE_BUST"
printf '%s\n' "============================================================"
