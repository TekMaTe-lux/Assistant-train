#!/usr/bin/env bash
set -euo pipefail

TMP="$(mktemp -d /tmp/lb-tgv-lgv-est-v10.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

BASE_URL="https://raw.githubusercontent.com/TekMaTe-lux/Assistant-train/cb146e1e946a475fa512414852687d076e60944b/vps/map-v2/install-tgv-lgv-est-canonical-v9.sh"

printf '%s\n' "============================================================"
printf '%s\n' "TGV LGV EST — CORRECTION VAIRES V10"
printf '%s\n' "070000 -> 005000 -> 005341 -> 090000 -> 089000"
printf '%s\n' "============================================================"

curl -fsSL "$BASE_URL" -o "$TMP/v9.sh"

python3 - "$TMP/v9.sh" "$TMP/v10.sh" <<'PY'
from pathlib import Path
import sys
src=Path(sys.argv[1]).read_text(encoding='utf-8')

# V9 utilisait 001000 pour l'approche de Paris-Est. Or 001000 est Paris-Mulhouse.
# La ligne classique Paris-Est -> Strasbourg/Vaires est 070000 et rejoint la LGV Est 005000 à Vaires.
count=src.count('001000')
if count < 2:
    raise SystemExit(f'ERREUR : références 001000 V9 inattendues ({count})')
src=src.replace('001000','070000')
src=src.replace('V9','V10').replace('v9','v10')
Path(sys.argv[2]).write_text(src,encoding='utf-8')
print(f'V10 préparée : {count} références 001000 remplacées par 070000')
PY

bash -n "$TMP/v10.sh"

# On laisse le préflight interne de la V10 valider toutes les jonctions et les 4 sens
# avant toute modification du builder/dataset live.
bash "$TMP/v10.sh"
