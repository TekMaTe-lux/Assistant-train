#!/usr/bin/env bash
set -euo pipefail

RAW="https://raw.githubusercontent.com/TekMaTe-lux/Assistant-train/main/vps/map-v2/install-moorail-v11_3-production-ui-finalizer.sh"
TMP="$(mktemp -d /tmp/moorail-v1131.XXXXXX)"
BASE="$TMP/v113.sh"
cleanup(){ rm -rf "$TMP"; }
trap cleanup EXIT

curl -fsSL "$RAW?$(date +%s)" -o "$BASE"

python3 - "$BASE" <<'__PATCH_V1131__'
from pathlib import Path
import sys
p=Path(sys.argv[1])
s=p.read_text(encoding='utf-8')

s=s.replace(
    'JS="$ROOT/public/moorail-route-editor-stops.js"\nHTML="$ROOT/public/moorail-route-editor.html"',
    'JS="$ROOT/public/moorail-route-editor-stops.js"\nHTML="$ROOT/public/moorail-route-editor.html"\nSERVER="$ROOT/server/server.mjs"',
    1
)

s=s.replace(
    'MOO RAIL V11.3 — FIN DU SPINNER / SUIVANTE AUTOMATIQUE',
    'MOO RAIL V11.3.1 — FIN DU SPINNER / PREFLIGHT CORRIGE',
    1
)
s=s.replace(
    'MOO RAIL V11.3 INSTALLE ET VALIDE',
    'MOO RAIL V11.3.1 INSTALLE ET VALIDE',
    1
)

old='''for marker in LB_MOORAIL_PRODUCTION_V11 LB_MOORAIL_PRODUCTION_RECOVERY_V111 LB_MOORAIL_ROUTE_HANDLER_GUARD_V112 LB_MOORAIL_PRODUCTION_WATCHDOG_V112; do
  grep -qF "$marker" "$JS" || { echo "ERREUR marqueur absent: $marker" >&2; exit 4; }
done'''
new='''# V11.3.1 : les marqueurs ne vivent pas tous dans le même fichier.
# - V11 / V11.1 / watchdog V11.2 sont côté navigateur (JS)
# - la garde double-réponse V11.2 est côté serveur (server.mjs)
for marker in LB_MOORAIL_PRODUCTION_V11 LB_MOORAIL_PRODUCTION_RECOVERY_V111 LB_MOORAIL_PRODUCTION_WATCHDOG_V112; do
  grep -qF "$marker" "$JS" || { echo "ERREUR marqueur JS absent: $marker" >&2; exit 4; }
done
grep -qF 'LB_MOORAIL_ROUTE_HANDLER_GUARD_V112' "$SERVER" || { echo "ERREUR garde serveur V11.2 absente" >&2; exit 4; }
echo "Pre-flight marqueurs : JS + SERVER OK"'''
if old not in s:
    raise SystemExit('ERREUR: bloc marqueurs V11.3 introuvable')
s=s.replace(old,new,1)

# Renomme le verdict servi pour qu'il soit explicite.
s=s.replace('echo "V11.3 servi : OK"','echo "V11.3.1 servi : OK"',1)

p.write_text(s,encoding='utf-8')
print('Correctif V11.3.1 préparé :')
print(' - garde HTTP V11.2 vérifiée dans server.mjs')
print(' - marqueurs UI vérifiés dans moorail-route-editor-stops.js')
print(' - logique deadlock V11.3 inchangée')
print(' - auto-reload de secours inchangé')
__PATCH_V1131__

bash -n "$BASE"
chmod 700 "$BASE"
exec bash "$BASE"
