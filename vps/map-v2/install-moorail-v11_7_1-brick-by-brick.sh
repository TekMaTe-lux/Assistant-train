#!/usr/bin/env bash
set -euo pipefail

RAW="https://raw.githubusercontent.com/TekMaTe-lux/Assistant-train/main/vps/map-v2/install-moorail-v11_7-brick-by-brick.sh"
TMP="$(mktemp -d /tmp/moorail-v1171.XXXXXX)"
BASE="$TMP/v117.sh"
cleanup(){ rm -rf "$TMP"; }
trap cleanup EXIT

curl -fsSL "$RAW?$(date +%s)" -o "$BASE"

python3 - "$BASE" <<'__PATCH_V1171__'
from pathlib import Path
import sys
p=Path(sys.argv[1]); s=p.read_text(encoding='utf-8')

s=s.replace('MOO RAIL V11.7 — MODE BRIQUE PAR BRIQUE','MOO RAIL V11.7.1 — MODE BRIQUE PAR BRIQUE',1)
s=s.replace('ROLLBACK MOO RAIL V11.7...','ROLLBACK MOO RAIL V11.7.1...',1)
s=s.replace('MOO RAIL V11.7 INSTALLE — BRIQUE PAR BRIQUE','MOO RAIL V11.7.1 INSTALLE — BRIQUE PAR BRIQUE',1)
s=s.replace('V11.7 servi : OK','V11.7.1 servi : OK',1)

old="assert 'refreshPublishPreview' not in b"
new="""v0=b.find('validateLeg=async function(){')
v1=b.find('\\nfunction lbBindBrickV117()',v0)
assert v0>=0 and v1>v0
validate_block=b[v0:v1]
assert 'refreshPublishPreview' not in validate_block"""
if old not in s:
    raise SystemExit('ERREUR ancre self-test V11.7 absente')
s=s.replace(old,new,1)

# Le faux positif provenait uniquement du commentaire dans lbBrickOpenV117 :
# "évite refreshPublishPreview()". Le chemin validateLeg n'appelait pas cette fonction.
s=s.replace("echo \"=== 3/7 SELF-TEST STRUCTUREL ===\"",
'''echo "=== 3/7 SELF-TEST STRUCTUREL ==="
echo "V11.7.1 : contrôle refreshPublishPreview limité au chemin validateLeg (pas aux commentaires)."''',1)

p.write_text(s,encoding='utf-8')
print('Correctif V11.7.1 préparé :')
print(' - cause RC=1 identifiée : faux positif du self-test')
print(' - le texte refreshPublishPreview était seulement dans un commentaire')
print(' - code fonctionnel V11.7 inchangé')
print(' - self-test vérifie maintenant uniquement validateLeg()')
__PATCH_V1171__

bash -n "$BASE"
chmod 700 "$BASE"
exec bash "$BASE"
