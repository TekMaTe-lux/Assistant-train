#!/usr/bin/env bash
set -euo pipefail

ROOT="/opt/labetaillere-map-v2-src/map-v2"
TRIPS="$ROOT/data/generated/trips.json"
TMP="$(mktemp -d /tmp/lb-tgv-pagny-v8.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  echo "ERREUR : lancer avec sudo/root" >&2
  exit 2
fi
[[ -f "$TRIPS" ]] || { echo "ERREUR : $TRIPS absent" >&2; exit 3; }

echo "============================================================"
echo "TGV PARIS/CHAMPAGNE <-> METZ — CORRIDOR RFN CANONIQUE V8"
echo "005000 -> 005341 -> 090000 -> 089000"
echo "============================================================"

echo "=== 0/4 Préflight éligibilité — avant toute modification ==="
python3 - "$TRIPS" <<'PY'
import json,sys,unicodedata,re
trips=json.load(open(sys.argv[1],encoding='utf-8'))

def norm(s):
    s=unicodedata.normalize('NFKD',str(s or ''))
    s=''.join(c for c in s if not unicodedata.combining(c)).upper()
    return re.sub(r'[^A-Z0-9]+',' ',s).strip()

def pair(a,z):
    a=norm(a); z=norm(z)
    west=('PARIS','REIMS','CHAMPAGNE','MEUSE TGV')
    a_w=any(t in a for t in west); z_w=any(t in z for t in west)
    a_m='METZ' in a; z_m='METZ' in z
    return (a_w and z_m) or (a_m and z_w)

eligible=[]; e2807=[]
for tid,t in trips.items():
    if str(t.get('category') or '').lower()!='tgv':
        continue
    s=t.get('stops') or []
    if any(pair(s[i].get('name',''),s[i+1].get('name','')) for i in range(len(s)-1)):
        eligible.append((tid,t))
        if str(t.get('number') or '')=='2807': e2807.append((tid,t))
print('TGV éligibles V8:',len(eligible))
print('variantes 2807 éligibles:',len(e2807))
for tid,t in e2807[:8]:
    print('  2807:',[str(x.get('name') or '') for x in (t.get('stops') or [])])
if not eligible:
    raise SystemExit('ERREUR : préflight V8 ne trouve aucun TGV éligible')
if not e2807:
    raise SystemExit('ERREUR : préflight V8 ne trouve aucune variante 2807')
PY

echo "=== 1/4 Préparation du moteur V8 à partir du V7 validé topologiquement ==="
# On part exactement du V7 qui avait validé les jonctions RFN (8.3 m / 22 m / 0.5 m),
# mais qui ne sélectionnait aucun train à cause d'un matching de noms trop strict.
BASE_URL="https://raw.githubusercontent.com/TekMaTe-lux/Assistant-train/2dee2302b964bb853a8da2d337968a3f1f91e90a/vps/map-v2/install-tgv-pagny-canonical-v7.sh"
curl -fsSL "$BASE_URL" -o "$TMP/v7.sh"
python3 - "$TMP/v7.sh" "$TMP/v8.sh" <<'PY'
from pathlib import Path
import sys
src=Path(sys.argv[1]).read_text(encoding='utf-8')
old="west=('PARIS EST','CHAMPAGNE-ARDENNE TGV','MEUSE TGV')"
new="west=('PARIS','REIMS','CHAMPAGNE','MEUSE TGV')"
if src.count(old)!=1:
    raise SystemExit(f'ERREUR : matching V7 attendu {src.count(old)} fois')
src=src.replace(old,new,1)
old2="if 'PARIS EST' in west_name:"
new2="if 'PARIS' in west_name:"
if src.count(old2)!=1:
    raise SystemExit(f'ERREUR : branche Paris V7 attendue {src.count(old2)} fois')
src=src.replace(old2,new2,1)
# Versionner réellement le patch pour que les métadonnées et les backups ne se confondent pas avec V7.
src=src.replace('V7','V8').replace('v7','v8')
Path(sys.argv[2]).write_text(src,encoding='utf-8')
print('V8 préparée : matching robuste PARIS/REIMS/CHAMPAGNE/MEUSE <-> METZ')
PY
bash -n "$TMP/v8.sh"

echo "=== 2/4 Exécution transactionnelle V8 ==="
# Le script dérivé conserve le backup, le rollback, les contrôles de jonctions,
# la reconstruction, le contrôle 2807 et le health-check du V7.
bash "$TMP/v8.sh"
