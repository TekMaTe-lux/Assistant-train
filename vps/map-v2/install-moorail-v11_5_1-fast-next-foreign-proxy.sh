#!/usr/bin/env bash
set -euo pipefail

RAW="https://raw.githubusercontent.com/TekMaTe-lux/Assistant-train/main/vps/map-v2/install-moorail-v11_5-fast-next-foreign-proxy.sh"
TMP="$(mktemp -d /tmp/moorail-v1151.XXXXXX)"
BASE="$TMP/v115.sh"
cleanup(){ rm -rf "$TMP"; }
trap cleanup EXIT

curl -fsSL "$RAW?$(date +%s)" -o "$BASE"

python3 - "$BASE" <<'__PATCH_V1151__'
from pathlib import Path
import re,sys
p=Path(sys.argv[1]); s=p.read_text(encoding='utf-8')

s=s.replace('MOO RAIL V11.5 — NEXT RAPIDE + PROXY ETRANGER DIRECT','MOO RAIL V11.5.1 — NEXT RAPIDE + PROXY ETRANGER DIRECT',1)
s=s.replace('MOO RAIL V11.5 INSTALLE','MOO RAIL V11.5.1 INSTALLE',1)
s=s.replace('ROLLBACK MOO RAIL V11.5...','ROLLBACK MOO RAIL V11.5.1...',1)
s=s.replace("grep -qF 'LB_MOORAIL_LIVE_PATH_V44' \"$PREVIEW\" || { echo \"ERREUR France V3 ne contient pas l'override MooRail LIVE V4.4\" >&2; exit 4; }",
'''if grep -qF 'LB_MOORAIL_LIVE_PATH_V44' "$PREVIEW"; then
  echo "INFO France V3 : ancien override LIVE V4.4 détecté"
else
  echo "INFO France V3 : marqueur LIVE V4.4 absent — cela ne bloque PAS la correction de l’éditeur"
fi''',1)

start=s.find('echo "=== 7/8 PREUVE FRANCE V3 UTILISE LES VALIDATIONS ==="')
end=s.find('echo "=== 8/8 HEALTH / VERDICT ==="',start)
if start<0 or end<0:
    raise SystemExit('ERREUR bloc preuve France V3 introuvable')
replacement=r'''echo "=== 7/8 AUDIT FRANCE V3 — INFORMATIF, NON BLOQUANT ==="
curl -fsS --max-time 8 "http://127.0.0.1:3111/france-v3-preview.html?$(date +%s)" -o "$TMP/preview.html"
if grep -qF 'LB_MOORAIL_LIVE_PATH_V44' "$TMP/preview.html"; then
  echo "France V3 : marqueur LIVE V4.4 PRESENT"
else
  echo "France V3 : marqueur LIVE V4.4 ABSENT"
fi
for m in LB_MOORAIL_LIVE_PATH_V44 LB_MOORAIL_SELECTED_ROUTE_V52 LB_MOORAIL_COMPOSED_PATH_V53 LB_MOORAIL_VALIDATED_SECTIONS_V8; do
  if grep -qF "$m" "$TMP/preview.html"; then echo "  marker $m : PRESENT"; else echo "  marker $m : absent"; fi
done
python3 - "$LIVE" <<'PY'
import json,sys
p=json.load(open(sys.argv[1],encoding='utf-8'))
print('Sections LIVE orientées :',len(p.get('pairs') or []))
PY

echo "NOTE : V11.5.1 corrige uniquement l’éditeur. L’intégration exacte de France V3 sera auditée séparément si le marqueur V4.4 est absent."

'''
s=s[:start]+replacement+s[end:]

s=s.replace(' - France V3 Preview : override MooRail contrôlé actif\n',' - France V3 Preview : audit informatif uniquement\n',1)
s=s.replace(' - France V3 Preview : override MooRail contrôlé actif',' - France V3 Preview : audit informatif uniquement',1)

p.write_text(s,encoding='utf-8')
print('Correctif V11.5.1 préparé :')
print(' - le marqueur France V3 V4.4 n’est plus un prérequis')
print(' - next rapide + proxy étranger inchangés')
print(' - audit France V3 conservé mais non bloquant')
__PATCH_V1151__

bash -n "$BASE"
chmod 700 "$BASE"
exec bash "$BASE"
