#!/usr/bin/env bash
set -euo pipefail

NUMBER="${1:-2807}"
RAW_DATE="${2:-$(date +%Y%m%d)}"
CORE_COMMIT="e1cb3ac9e7438c335e44617b64348e848507789e"
CORE_URL="https://raw.githubusercontent.com/TekMaTe-lux/Assistant-train/${CORE_COMMIT}/vps/map-v2/audit-sncf-2807-geojson.sh"
TMP="$(mktemp -d /tmp/lb-sncf-geojson-v2.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT
CORE="$TMP/core.sh"

DATE_ISO="$(python3 - "$RAW_DATE" <<'PY'
import re,sys
s=sys.argv[1].strip()
if re.fullmatch(r'\d{8}',s):
    print(f'{s[:4]}-{s[4:6]}-{s[6:]}')
elif re.fullmatch(r'\d{4}-\d{2}-\d{2}',s):
    print(s)
else:
    raise SystemExit('ERREUR: date attendue YYYYMMDD ou YYYY-MM-DD')
PY
)"

echo "V2: date véhicule Navitia normalisée: $DATE_ISO"
curl -fsSL "$CORE_URL" -o "$CORE"

python3 - "$CORE" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1]); text=p.read_text(encoding='utf-8')
old="m=re.search(r'SNCF:(\\d{8}):',str(vj.get('id') or ''))\ndate=m.group(1) if m else ''"
new="m=re.search(r'SNCF:(\\d{4})-(\\d{2})-(\\d{2}):',str(vj.get('id') or ''))\ndate=''.join(m.groups()) if m else ''"
if text.count(old)!=1:
    raise SystemExit(f'ERREUR V2: extraction date VJ trouvée {text.count(old)} fois')
text=text.replace(old,new,1)
p.write_text(text,encoding='utf-8')
PY

exec bash "$CORE" "$NUMBER" "$DATE_ISO"
