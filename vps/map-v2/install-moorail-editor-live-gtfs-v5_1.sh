#!/usr/bin/env bash
set -euo pipefail

ROOT="${MOORAIL_ROOT:-/opt/labetaillere-map-v2-src/map-v2}"
API="$ROOT/server/route-editor-api.mjs"
SERVICE="labetaillere-map-v2.service"
STAMP="$(date +%Y%m%d-%H%M%S)"
TMP="$(mktemp -d /tmp/moorail-v51.XXXXXX)"
RAW="https://raw.githubusercontent.com/TekMaTe-lux/Assistant-train/main/vps/map-v2"

cleanup(){ rm -rf "$TMP"; }
trap cleanup EXIT

echo "============================================================"
echo " MOO RAIL V5.1 — CORRECTIF CATALOGUE GTFS LIVE"
echo "============================================================"

[[ ${EUID:-$(id -u)} -eq 0 ]] || { echo "ERREUR: lancer avec sudo/root" >&2; exit 2; }
[[ -f "$API" ]] || { echo "ERREUR API absente: $API" >&2; exit 3; }

# Le rollback V5 doit avoir restauré l'API V4/V4.5 fonctionnelle.
node --check "$API"
grep -qF 'function buildCatalog(' "$API" || {
  echo "ERREUR: buildCatalog absent de l'API avant installation." >&2
  echo "Ne pas poursuivre: le rollback précédent n'a pas restauré la bonne API." >&2
  exit 4
}

# Vérifie également que le catalogue actuel ne fait pas tomber le service.
curl -fsS --max-time 10 \
  "http://127.0.0.1:3111/api/map-v2/route-editor/catalog?preflight=$STAMP" \
  -o "$TMP/preflight.json"
python3 - "$TMP/preflight.json" <<'PY'
import json,sys
p=json.load(open(sys.argv[1],encoding='utf-8'))
print('Catalogue avant V5.1 :',len(p.get('routes') or []),'routes')
PY

echo "=== Téléchargement V5 de base ==="
curl -fsSL "$RAW/install-moorail-editor-live-gtfs-v5.sh?$STAMP" -o "$TMP/v5.sh"

# V5 remplaçait par erreur la PREMIERE occurrence textuelle de
# buildCatalog(trips,state), qui se trouve dans la déclaration
# `function buildCatalog(trips, state)`. Résultat: la fonction disparaissait
# et GET /catalog déclenchait ReferenceError: buildCatalog is not defined.
# V5.1 cible uniquement l'appel présent dans le handler GET /catalog.
python3 - "$TMP/v5.sh" "$TMP/v51.sh" <<'PY'
from pathlib import Path
import sys
src=Path(sys.argv[1]).read_text(encoding='utf-8')

bad="    s2,n=re.subn(r'buildCatalog\\(trips\\s*,\\s*state\\)', 'mergedEditorCatalog(state)', s, count=1)"
replacement='''    target="const state=loadState(), catalog=buildCatalog(trips,state);"
    replacement="const state=loadState(), catalog=mergedEditorCatalog(state);"
    if target in s:
        s2=s.replace(target,replacement,1); n=1
    elif replacement in s:
        s2=s; n=1
    else:
        s2=s; n=0'''

if bad not in src:
    raise SystemExit('ERREUR: motif bug V5 introuvable; refus de patcher au hasard')
src=src.replace(bad,replacement,1)

# L'union GTFS peut produire ~900 variantes : laisse davantage de temps au
# premier contrôle HTTP sans changer le comportement du serveur.
src=src.replace('--max-time 10 "http://127.0.0.1:3111/api/map-v2/route-editor/catalog?t=$STAMP"',
                '--max-time 30 "http://127.0.0.1:3111/api/map-v2/route-editor/catalog?t=$STAMP"',1)

Path(sys.argv[2]).write_text(src,encoding='utf-8')
PY
chmod 0700 "$TMP/v51.sh"

# Contrôle que le correctif n'a pas laissé la regex dangereuse.
if grep -qF "s2,n=re.subn(r'buildCatalog\\(trips\\s*,\\s*state\\)'" "$TMP/v51.sh"; then
  echo "ERREUR: ancien patch dangereux encore présent" >&2
  exit 5
fi

echo "=== Exécution V5.1 ==="
bash "$TMP/v51.sh"

echo
echo "=== CONTROLE FINAL V5.1 ==="
node --check "$API"
grep -qF 'function buildCatalog(' "$API"
grep -qF 'catalog=mergedEditorCatalog(state)' "$API"

for _ in $(seq 1 30); do
  if systemctl is-active --quiet "$SERVICE" && \
     curl -fsS --max-time 3 http://127.0.0.1:3111/api/map-v2/health >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
systemctl is-active --quiet "$SERVICE"

curl -fsS --max-time 30 \
  "http://127.0.0.1:3111/api/map-v2/route-editor/catalog?final=$STAMP" \
  -o "$TMP/final.json"
python3 - "$TMP/final.json" <<'PY'
import json,sys
cat=json.load(open(sys.argv[1],encoding='utf-8'))
routes=cat.get('routes') or []
print('Routes catalogue :',len(routes))
print('GTFS live        :',cat.get('liveGtfs'))
print('GTFS stats       :',cat.get('liveGtfsStats'))
for num in ('5454','2509'):
    hits=[r for r in routes if num in [str(x) for x in (r.get('trainNumbers') or [])]]
    print(f'TGV {num} : {len(hits)} variante(s)')
    for r in hits[:5]:
        p=r.get('progress') or {}
        print(' ',r.get('id'),'|',p.get('validated'),'/',p.get('total'),'|',r.get('signature'))
PY

echo "============================================================"
echo " MOO RAIL V5.1 INSTALLE"
echo "============================================================"
echo "Le catalogue conserve buildCatalog() et fusionne maintenant"
echo "data/generated + GTFS actif sans faire tomber le serveur."
echo "============================================================"
