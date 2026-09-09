#!/usr/bin/env bash
set -euo pipefail

ROOT="${MOORAIL_ROOT:-/opt/labetaillere-map-v2-src/map-v2}"
JS="$ROOT/public/moorail-route-editor-stops.js"
BASE_URL="https://raw.githubusercontent.com/TekMaTe-lux/Assistant-train/main/vps/map-v2/install-moorail-v8_9-endpoint-handles.sh"
TMP="$(mktemp -d /tmp/moorail-v891.XXXXXX)"
cleanup(){ rm -rf "$TMP"; }
trap cleanup EXIT

[[ ${EUID:-$(id -u)} -eq 0 ]] || { echo "ERREUR: lancer avec sudo/root" >&2; exit 2; }
[[ -f "$JS" ]] || { echo "ERREUR JS absent: $JS" >&2; exit 3; }

echo "============================================================"
echo " MOO RAIL V8.9.1 — CORRECTIF POIGNEES A/B"
echo "============================================================"
echo "Cause corrigée : V4 partage les sections via findSharedSection(),"
echo "alors que V8.9 cherchait encore l'ancien saved=state.serverState..."
echo

echo "=== 1/5 AUDIT DE L'ANCRE REELLE ==="
python3 - "$JS" <<'PY'
from pathlib import Path
import sys
s=Path(sys.argv[1]).read_text(encoding='utf-8',errors='replace').splitlines()
hits=[]
for i,line in enumerate(s,1):
    if 'const saved=' in line and ('findSharedSection' in line or 'serverState.sections' in line):
        hits.append((i,line.strip()))
for i,line in hits[:10]:print(f'{i}: {line}')
if not hits:raise SystemExit('ERREUR: aucune ancre const saved=... trouvée')
print('Ancre active détectée : OK')
PY

echo "=== 2/5 TELECHARGEMENT V8.9 CANONIQUE ==="
curl -fsSL "$BASE_URL?$(date +%s)" -o "$TMP/v89.sh"
chmod 700 "$TMP/v89.sh"
bash -n "$TMP/v89.sh"

echo "=== 3/5 CORRECTION DE L'ANCRE saved/waypoints ==="
python3 - "$TMP/v89.sh" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1]);lines=p.read_text(encoding='utf-8').splitlines()
found=0
replacement=r'''pat=re.compile(r"(\s*const saved=[^\n]+;\n)(\s*state\.via=[^\n]+;\n?)")'''
for i,line in enumerate(lines):
    if line.startswith('pat=re.compile') and 'saved=state' in line and 'waypoints' in line:
        print('Ancienne ancre installateur :',line)
        lines[i]=replacement
        found+=1
if found!=1:
    raise SystemExit(f'ERREUR: nombre ancres V8.9 à corriger = {found}')
p.write_text('\n'.join(lines)+'\n',encoding='utf-8')
print('Ancre corrigée : accepte findSharedSection() ET ancien serverState')
PY
bash -n "$TMP/v89.sh"

echo "=== 4/5 EXECUTION V8.9 CORRIGEE ==="
bash "$TMP/v89.sh"

echo "=== 5/5 CONTROLES FINAUX V8.9.1 ==="
node --check "$JS"
grep -qF 'LB_MOORAIL_ENDPOINT_HANDLES_V89' "$JS"
grep -qF 'lbStrictRailAnchorV89' "$JS"
grep -qF 'endpointOverrides' "$JS"

for id in forceA forceB resetEnds; do
  curl -fsS --max-time 5 "http://127.0.0.1:3111/moorail-route-editor.html?$(date +%s)" | grep -q "id=\"$id\""
  echo "  bouton $id : OK"
done

curl -fsS --max-time 5 "http://127.0.0.1:3111/moorail-route-editor-stops.js?$(date +%s)" | grep -qF 'LB_MOORAIL_ENDPOINT_HANDLES_V89'
echo "  JS V8.9 servi : OK"

curl -fsS --max-time 5 http://127.0.0.1:3111/api/map-v2/health

echo
echo "============================================================"
echo " MOO RAIL V8.9.1 INSTALLE ET VALIDE"
echo "============================================================"
echo "Sortie A / Entrée B disponibles et persistantes."
echo "Les poignées orange forcent une seule voie RFN près des gares."
echo "============================================================"
