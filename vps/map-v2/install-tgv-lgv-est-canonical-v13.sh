#!/usr/bin/env bash
set -euo pipefail

ROOT="/opt/labetaillere-map-v2-src/map-v2"
TRIPS="$ROOT/data/generated/trips.json"
TMP="$(mktemp -d /tmp/lb-tgv-lgv-est-v13.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT
BASE_URL="https://raw.githubusercontent.com/TekMaTe-lux/Assistant-train/0c8913e1893dca23e627e28a83a358ccdbd13805/vps/map-v2/install-tgv-lgv-est-canonical-v11.sh"

echo "============================================================"
echo "TGV LGV EST V13 — PARIS EST STRICT + DIRECT VIA CHAMPAGNE"
echo "001000 -> 070000 -> 005000 -> 005341 -> 090000 -> 089000"
echo "============================================================"

[[ -f "$TRIPS" ]] || { echo "ERREUR : $TRIPS absent" >&2; exit 3; }

# Compte de référence indépendant du builder : on exige ensuite que la reconstruction
# recalcule exactement le même ensemble de variantes, notamment toutes les 2807.
python3 - "$TRIPS" "$TMP/expected.env" <<'PY'
import json,sys,unicodedata,re
trips=json.load(open(sys.argv[1],encoding='utf-8'))
def norm(s):
    s=unicodedata.normalize('NFKD',str(s or ''))
    s=''.join(c for c in s if not unicodedata.combining(c)).upper()
    return re.sub(r'[^A-Z0-9]+',' ',s).strip()
def tag(name):
    n=norm(name)
    if 'PARIS EST' in n:return 'paris'
    if 'CHAMPAGNE' in n or 'MEUSE TGV' in n:return 'lgv'
    if 'METZ' in n:return 'metz'
    return None
def kind(a,z):
    p={tag(a),tag(z)}
    if p=={'paris','lgv'}:return 'paris_lgv'
    if p=={'paris','metz'}:return 'paris_metz'
    if p=={'lgv','metz'}:return 'lgv_metz'
    return None
eligible=[]; e2807=[]; false=[]
for tid,t in trips.items():
    if str(t.get('category') or '').lower()!='tgv':continue
    names=[str(x.get('name') or '') for x in (t.get('stops') or [])]
    for name in names:
        n=norm(name)
        if 'PARIS' in n and 'PARIS EST' not in n and tag(name)=='paris':false.append((tid,name))
    if any(kind(names[i],names[i+1]) for i in range(len(names)-1)):
        eligible.append((tid,t))
        if str(t.get('number') or '')=='2807':e2807.append((tid,t))
print('TGV éligibles attendus V13:',len(eligible))
print('variantes 2807 attendues V13:',len(e2807))
print('faux Paris capturés:',len(false))
for _,t in e2807[:8]:print('  2807:',[x.get('name') for x in (t.get('stops') or [])])
if false:raise SystemExit(f'ERREUR faux Paris: {false[:5]}')
if not eligible or not e2807:raise SystemExit('ERREUR sélection V13 vide')
open(sys.argv[2],'w').write(f'BER_EXPECTED_ELIGIBLE={len(eligible)}\nBER_EXPECTED_2807={len(e2807)}\n')
PY
source "$TMP/expected.env"
export BER_EXPECTED_ELIGIBLE BER_EXPECTED_2807

curl -fsSL "$BASE_URL" -o "$TMP/base-v11.sh"

python3 - "$TMP/base-v11.sh" "$TMP/v13.sh" <<'PY'
from pathlib import Path
import sys
src=Path(sys.argv[1]).read_text(encoding='utf-8')

# 1) Paris : uniquement Paris Est.
old="    if 'PARIS' in n:\n        return 'paris'"
new="    if 'PARIS EST' in n:\n        return 'paris'"
if src.count(old)!=1:raise SystemExit(f'ERREUR tag Paris attendu 1 fois, trouvé {src.count(old)}')
src=src.replace(old,new,1)

# 2) Un Paris Est -> Metz direct doit suivre EXACTEMENT le même sillon physique
# qu'un Paris Est -> Champagne puis Champagne -> Metz. On impose donc un point
# technique sur 005000 à Champagne-Ardenne TGV au lieu de laisser la topologie
# complète de 005000 choisir une branche de 401 km.
old_func="""def ber_v11_forward_paris_to_metz(graph,paris_coord,metz_coord):
    c=ber_v11_cache(graph)
    p=ber_v11_nearest_node(graph,paris_coord,c['nodes']['001000'])
    z=ber_v11_nearest_node(graph,metz_coord,c['nodes']['089000'])
    if not p or not z or p[0]>1000 or z[0]>1000:return None
    p1=ber_v11_line_route(graph,p[1],c['j001_e'],'001000')
    p7=ber_v11_line_route(graph,c['j070_w'],c['j070_e'],'070000')
    p5=ber_v11_line_route(graph,c['j005_w'],c['j005_e'],'005000')
    p9=ber_v11_line_route(graph,c['j090_w'],c['j090_e'],'090000')
    p8=ber_v11_line_route(graph,c['j089_w'],z[1],'089000')
    if not p1 or not p7 or not p5 or not p9 or not p8:return None
    return ber_v11_dedupe((p1,p7,p5,c['raccord'],p9,p8))
"""
new_func="""def ber_v11_forward_paris_to_metz(graph,paris_coord,metz_coord):
    # Waypoint technique sur la LGV Est à Champagne-Ardenne TGV.
    champagne_coord=(3.994523,49.214769)
    left=ber_v11_forward_paris_to_lgv(graph,paris_coord,champagne_coord)
    right=ber_v11_forward_lgv_to_metz(graph,champagne_coord,metz_coord)
    if not left or not right:return None
    return ber_v11_dedupe((left,right))
"""
if src.count(old_func)!=1:raise SystemExit(f'ERREUR fonction Paris-Metz attendue 1 fois, trouvé {src.count(old_func)}')
src=src.replace(old_func,new_func,1)

# 3) La reconstruction doit couvrir exactement le même ensemble que le préflight externe.
old_checks="""if changed<1:raise SystemExit('aucun TGV recalculé V11')
if n2807<1:raise SystemExit('2807 non recalculé V11')
print('TGV recalculés V11:',changed,'variantes 2807:',n2807)
"""
new_checks="""expected=int(__import__('os').environ.get('BER_EXPECTED_ELIGIBLE','0'))
expected2807=int(__import__('os').environ.get('BER_EXPECTED_2807','0'))
if changed != expected:raise SystemExit(f'ERREUR couverture V11: recalculés={changed} attendus={expected}')
if n2807 != expected2807:raise SystemExit(f'ERREUR couverture 2807 V11: recalculés={n2807} attendus={expected2807}')
print('TGV recalculés V11:',changed,'variantes 2807:',n2807,'— couverture complète')
"""
if src.count(old_checks)!=1:raise SystemExit(f'ERREUR bloc contrôle couverture attendu 1 fois, trouvé {src.count(old_checks)}')
src=src.replace(old_checks,new_checks,1)

# 4) Le serveur map peut mettre plusieurs secondes à recharger le gros dataset.
# V11 faisait un seul curl après 1 seconde, alors que les anciens installateurs
# attendaient déjà le health-check. On rétablit un vrai wait + diagnostic.
old_health="""sleep 1
curl -fsS http://127.0.0.1:3111/api/map-v2/health
printf '\\n'
"""
new_health="""echo 'Attente du service map-v2 (max 30 s)...'
HEALTH_OK=0
for _ in $(seq 1 30); do
  if systemctl is-active --quiet \"$SERVICE\" && curl -fsS --max-time 2 http://127.0.0.1:3111/api/map-v2/health >\"$TMP/health.json\" 2>/dev/null; then
    HEALTH_OK=1
    break
  fi
  sleep 1
done
if [[ \"$HEALTH_OK\" -ne 1 ]]; then
  echo 'ERREUR : service map-v2 non sain après 30 s' >&2
  systemctl --no-pager --full status \"$SERVICE\" || true
  journalctl -u \"$SERVICE\" -n 80 --no-pager || true
  exit 1
fi
cat \"$TMP/health.json\"
printf '\\n'
"""
if src.count(old_health)!=1:raise SystemExit(f'ERREUR health-check attendu 1 fois, trouvé {src.count(old_health)}')
src=src.replace(old_health,new_health,1)

# Versionnement final.
src=src.replace('V11','V13').replace('v11','v13')
Path(sys.argv[2]).write_text(src,encoding='utf-8')
print('V13 préparée : Paris Est strict + direct via Champagne + couverture complète + health retry')
PY

bash -n "$TMP/v13.sh"
echo "=== EXÉCUTION TRANSACTIONNELLE V13 ==="
bash "$TMP/v13.sh"
