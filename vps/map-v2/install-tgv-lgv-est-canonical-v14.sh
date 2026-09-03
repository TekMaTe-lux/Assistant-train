#!/usr/bin/env bash
set -euo pipefail

TMP="$(mktemp -d /tmp/lb-tgv-lgv-est-v14.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT
BASE_URL="https://raw.githubusercontent.com/TekMaTe-lux/Assistant-train/7125bfa27b4fd8b7c183d42486042c2f98074d1d/vps/map-v2/install-tgv-lgv-est-canonical-v13.sh"

echo "============================================================"
echo "TGV LGV EST V14 — CORRECTION DU TAG PARIS EST"
echo "aucune modification avant les préflights internes"
echo "============================================================"

curl -fsSL "$BASE_URL" -o "$TMP/v13.sh"

# V13 avait la bonne topologie et le waypoint Champagne, mais son helper injecté
# dépendait du norm() historique du builder. On remplace uniquement ce helper par
# une normalisation locale/autonome et on laisse V13 gérer couverture, rollback
# et health-check.
python3 - "$TMP/v13.sh" "$TMP/v14.sh" <<'PY'
from pathlib import Path
import sys
src=Path(sys.argv[1]).read_text(encoding='utf-8')

old = "new=\"    if 'PARIS EST' in n:\\n        return 'paris'\""
new = "new=\"    import unicodedata,re\\n    raw=unicodedata.normalize('NFKD',str(name or ''))\\n    raw=''.join(c for c in raw if not unicodedata.combining(c)).upper()\\n    compact=re.sub(r'[^A-Z0-9]+','',raw)\\n    if 'PARISEST' in compact:\\n        return 'paris'\""

count=src.count(old)
if count != 1:
    raise SystemExit(f'ERREUR V14 : helper Paris Est attendu 1 fois, trouvé {count}')
src=src.replace(old,new,1)

# Le script généré doit être une vraie V14, mais on ne touche pas à sa logique
# transactionnelle héritée de V13.
src=src.replace('V13','V14').replace('v13','v14')
Path(sys.argv[2]).write_text(src,encoding='utf-8')
print('V14 préparée : Paris Est reconnu indépendamment de norm()')
PY

bash -n "$TMP/v14.sh"
bash "$TMP/v14.sh"
