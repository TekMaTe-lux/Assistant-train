#!/usr/bin/env bash
set -euo pipefail

ROOT="/opt/labetaillere-map-v2-src/map-v2"
TRIPS="$ROOT/data/generated/trips.json"
TMP="$(mktemp -d /tmp/lb-tgv-lgv-est-v12.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

BASE_URL="https://raw.githubusercontent.com/TekMaTe-lux/Assistant-train/0c8913e1893dca23e627e28a83a358ccdbd13805/vps/map-v2/install-tgv-lgv-est-canonical-v11.sh"

printf '%s\n' "============================================================"
printf '%s\n' "TGV LGV EST — PARIS EST UNIQUEMENT V12"
printf '%s\n' "001000 -> 070000 -> 005000 -> 005341 -> 090000 -> 089000"
printf '%s\n' "============================================================"

[[ -f "$TRIPS" ]] || { echo "ERREUR : $TRIPS absent" >&2; exit 3; }

# Préflight de sélection : le moteur canonique ne doit JAMAIS attraper Gare de Lyon,
# Montparnasse, Nord, etc. Seul Paris Est est l'ancre parisienne de ce corridor.
echo "=== 0/3 Préflight sélection Paris Est — aucune modification ==="
python3 - "$TRIPS" <<'PY'
import json,sys,unicodedata,re
trips=json.load(open(sys.argv[1],encoding='utf-8'))

def norm(s):
    s=unicodedata.normalize('NFKD',str(s or ''))
    s=''.join(c for c in s if not unicodedata.combining(c)).upper()
    return re.sub(r'[^A-Z0-9]+',' ',s).strip()

def tag(name):
    n=norm(name)
    if 'PARIS EST' in n:
        return 'paris'
    if 'CHAMPAGNE' in n or 'MEUSE TGV' in n:
        return 'lgv'
    if 'METZ' in n:
        return 'metz'
    return None

def kind(a,z):
    ta,tz=tag(a),tag(z); pair={ta,tz}
    if pair=={'paris','lgv'}: return 'paris_lgv'
    if pair=={'paris','metz'}: return 'paris_metz'
    if pair=={'lgv','metz'}: return 'lgv_metz'
    return None

eligible=0; e2807=0; false_paris=[]
for tid,t in trips.items():
    if str(t.get('category') or '').lower()!='tgv': continue
    s=t.get('stops') or []
    names=[str(x.get('name') or '') for x in s]
    for name in names:
        n=norm(name)
        if 'PARIS' in n and 'PARIS EST' not in n and tag(name)=='paris':
            false_paris.append((tid,name))
    if any(kind(names[i],names[i+1]) for i in range(len(names)-1)):
        eligible+=1
        if str(t.get('number') or '')=='2807':
            e2807+=1
            if e2807<=8: print('  2807:',names)

print('TGV éligibles V12:',eligible)
print('variantes 2807 éligibles:',e2807)
print('faux Paris capturés:',len(false_paris))
if false_paris:
    for x in false_paris[:20]: print('  FAUX PARIS:',x)
    raise SystemExit('ERREUR : une gare parisienne autre que Paris Est est encore capturée')
if eligible<1 or e2807<1:
    raise SystemExit('ERREUR : sélection V12 vide ou 2807 absent')
PY

curl -fsSL "$BASE_URL" -o "$TMP/v11.sh"

# V12 = même topologie et mêmes micro-soudures validées que V11,
# mais le tag parisien est STRICTEMENT Paris Est.
python3 - "$TMP/v11.sh" "$TMP/v12.sh" <<'PY'
from pathlib import Path
import sys
src=Path(sys.argv[1]).read_text(encoding='utf-8')
old="    if 'PARIS' in n:\n        return 'paris'"
new="    if 'PARIS EST' in n:\n        return 'paris'"
count=src.count(old)
if count!=1:
    raise SystemExit(f'ERREUR : tag Paris V11 attendu exactement une fois, trouvé {count}')
src=src.replace(old,new,1)
# Métadonnées/version/backup distincts.
src=src.replace('V11','V12').replace('v11','v12')
Path(sys.argv[2]).write_text(src,encoding='utf-8')
print('V12 préparée : Paris Est strict, autres gares parisiennes exclues')
PY

bash -n "$TMP/v12.sh"

echo "=== 1/3 Exécution V12 transactionnelle ==="
# Le script dérivé conserve : préflight topologique complet, backup, rollback,
# reconstruction ciblée, contrôle 2807 et health-check.
bash "$TMP/v12.sh"

echo "=== 2/3 FIN V12 ==="
