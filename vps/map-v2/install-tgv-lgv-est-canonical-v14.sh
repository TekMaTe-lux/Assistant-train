#!/usr/bin/env bash
set -euo pipefail

TMP="$(mktemp -d /tmp/lb-tgv-lgv-est-v14.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

BASE_URL="https://raw.githubusercontent.com/TekMaTe-lux/Assistant-train/7125bfa27b4fd8b7c183d42486042c2f98074d1d/vps/map-v2/install-tgv-lgv-est-canonical-v13.sh"

echo "============================================================"
echo "TGV LGV EST V14 — PARIS EST NORMALISÉ + CONTRÔLE 313 KM"
echo "001000 -> 070000 -> 005000 -> 005341 -> 090000 -> 089000"
echo "============================================================"

curl -fsSL "$BASE_URL" -o "$TMP/v13.sh"

python3 - "$TMP/v13.sh" "$TMP/v14.sh" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1])
src=p.read_text(encoding='utf-8')

# Le norm() du builder n'a pas exactement le même format que le norm() du préflight
# externe. En V12/V13, le test littéral "PARIS EST" ne matchait donc pas dans le
# builder : les couples Paris Est-* retombaient sur l'ancien moteur V4, d'où 59
# variantes seulement et le Paris-Metz direct à 401 km.
old_ext="    if 'PARIS EST' in n:return 'paris'"
new_ext="    if 'PARISEST' in ''.join(ch for ch in n if ch.isalnum()):return 'paris'"
if src.count(old_ext)!=1:
    raise SystemExit(f'ERREUR V14 : tag Paris externe attendu 1 fois, trouvé {src.count(old_ext)}')
src=src.replace(old_ext,new_ext,1)

old_inner='new="    if \'PARIS EST\' in n:\\n        return \'paris\'"'
new_inner='new="    compact=\'\'.join(ch for ch in n if ch.isalnum())\\n    if \'PARISEST\' in compact:\\n        return \'paris\'"'
if src.count(old_inner)!=1:
    raise SystemExit(f'ERREUR V14 : tag Paris builder attendu 1 fois, trouvé {src.count(old_inner)}')
src=src.replace(old_inner,new_inner,1)

# On ajoute au script dérivé un contrôle explicite du classifieur réellement chargé
# dans build_dataset.py avant toute installation.
needle="src=src.replace(old_func,new_func,1)\n\n# 3) La reconstruction doit couvrir exactement le même ensemble que le préflight externe."
insert="""src=src.replace(old_func,new_func,1)

# 2b) Vérifier le tag Paris Est DANS LE BUILDER et verrouiller la longueur directe.
old_cache_line="c=b.ber_v11_cache(graph)\\n"
new_cache_line="""if b.ber_v11_tag_stop('Paris Est')!='paris':raise SystemExit('ERREUR V11: builder ne reconnaît pas Paris Est')
if b.ber_v11_tag_stop('Paris Gare de Lyon Hall 1 - 2') is not None:raise SystemExit('ERREUR V11: faux Paris capturé dans le builder')
print('TAG BUILDER V11 OK: Paris Est=paris ; Gare de Lyon=exclue')
c=b.ber_v11_cache(graph)
"""
if src.count(old_cache_line)!=1:raise SystemExit(f'ERREUR insertion tag builder: {src.count(old_cache_line)}')
src=src.replace(old_cache_line,new_cache_line,1)

old_print="    print(f'OK V11 {a} -> {z}: {len(nodes)} noeuds, {length/1000:.2f} km')"
new_print="""    if {a,z}=={'Paris Est','Metz'} and not (300000.0 <= length <= 330000.0):
        raise SystemExit(f'ERREUR V11 longueur Paris-Metz hors corridor LGV: {length/1000:.2f} km')
    print(f'OK V11 {a} -> {z}: {len(nodes)} noeuds, {length/1000:.2f} km')"""
if src.count(old_print)!=1:raise SystemExit(f'ERREUR insertion garde longueur: {src.count(old_print)}')
src=src.replace(old_print,new_print,1)

# 3) La reconstruction doit couvrir exactement le même ensemble que le préflight externe."""
if src.count(needle)!=1:
    raise SystemExit(f'ERREUR V14 : point insertion contrôles attendu 1 fois, trouvé {src.count(needle)}')
src=src.replace(needle,insert,1)

# Versionnement final du wrapper et du script qu'il génère.
src=src.replace('V13','V14').replace('v13','v14')
Path(sys.argv[2]).write_text(src,encoding='utf-8')
print('V14 préparée : Paris Est compact PARISEST + garde 300/330 km + couverture complète')
PY

bash -n "$TMP/v14.sh"
bash "$TMP/v14.sh"
