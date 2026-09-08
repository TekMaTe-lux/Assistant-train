#!/usr/bin/env bash
set -euo pipefail

TMP="$(mktemp /tmp/moorail-live-v45.XXXXXX.sh)"
trap 'rm -f "$TMP"' EXIT
BASE="https://raw.githubusercontent.com/TekMaTe-lux/Assistant-train/main/vps/map-v2/install-moorail-live-overrides-v4_4.sh"
STAMP="$(date +%s)"

echo "============================================================"
echo " MOO RAIL V4.5 — CORRECTIF CONTROLE CURL + LIVE TGV"
echo "============================================================"

curl -fsSL "$BASE?$STAMP" -o "$TMP"

python3 - "$TMP" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1])
s=p.read_text(encoding='utf-8')
old='''for f in "${TARGETS[@]}"; do
  name="$(basename "$f")"
  curl -fsS --max-time 5 "http://127.0.0.1:3111/$name?v=$STAMP" | grep -qF 'LB_MOORAIL_LIVE_PATH_V44'
done
'''
new='''for f in "${TARGETS[@]}"; do
  name="$(basename "$f")"
  served="$TMP/served-$name"
  curl -fsS --max-time 8 "http://127.0.0.1:3111/$name?v=$STAMP" -o "$served"
  grep -qF 'LB_MOORAIL_LIVE_PATH_V44' "$served"
done
'''
if old not in s:
    raise SystemExit('ERREUR: contrôle curl|grep V4.4 introuvable')
s=s.replace(old,new,1)
s=s.replace('MOO RAIL V4.4 — VALIDATIONS -> MOUVEMENT LIVE FRANCE V3','MOO RAIL V4.5 — VALIDATIONS -> MOUVEMENT LIVE FRANCE V3',1)
s=s.replace('ROLLBACK MOO RAIL LIVE V4.4...','ROLLBACK MOO RAIL LIVE V4.5...',1)
s=s.replace('MOO RAIL V4.4 INSTALLE — OVERRIDE LIVE ACTIF','MOO RAIL V4.5 INSTALLE — OVERRIDE LIVE ACTIF',1)
p.write_text(s,encoding='utf-8')
PY

bash -n "$TMP"
exec bash "$TMP"
