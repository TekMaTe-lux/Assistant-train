#!/usr/bin/env bash
set -euo pipefail

TMP="$(mktemp /tmp/moorail-publish-v41.XXXXXX.sh)"
trap 'rm -f "$TMP"' EXIT
BASE="https://raw.githubusercontent.com/TekMaTe-lux/Assistant-train/main/vps/map-v2/install-moorail-route-editor-publish-v4.sh"
STAMP="$(date +%s)"

echo "============================================================"
echo " MOO RAIL V4.1 — CORRECTIF INSTALLATEUR PUBLICATION"
echo "============================================================"

curl -fsSL "$BASE?$STAMP" -o "$TMP"

python3 - "$TMP" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1])
s=p.read_text(encoding='utf-8')
bad="shared=r'''\\nfunction findSharedSection"
good="shared=r'''\nfunction findSharedSection"
if bad in s:
    s=s.replace(bad,good,1)
elif good not in s:
    raise SystemExit("ERREUR: ancre findSharedSection introuvable dans l'installateur V4")
# Marque la version de l'installateur dans les messages sans modifier le badge fonctionnel attendu.
s=s.replace('MOO RAIL V4 — SECTIONS PARTAGEES + PUBLICATION EN 1 CLIC','MOO RAIL V4.1 — SECTIONS PARTAGEES + PUBLICATION EN 1 CLIC',1)
s=s.replace('ROLLBACK MOO RAIL V4...','ROLLBACK MOO RAIL V4.1...',1)
p.write_text(s,encoding='utf-8')
PY

bash -n "$TMP"
exec bash "$TMP"
