#!/usr/bin/env bash
set -euo pipefail

ROOT="${MOORAIL_ROOT:-/opt/labetaillere-map-v2-src/map-v2}"
FILE="$ROOT/public/moorail-route-editor.html"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$ROOT/backups/route-editor-topology-v1d1-$STAMP"
BASE="https://raw.githubusercontent.com/TekMaTe-lux/Assistant-train/main/vps/map-v2/route-editor"
TMP="$(mktemp -d /tmp/moorail-v1d1.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

[ -f "$FILE" ] || { echo "ERREUR: $FILE introuvable" >&2; exit 1; }
mkdir -p "$BACKUP"
cp -a "$FILE" "$BACKUP/moorail-route-editor.html"

printf 'Version actuelle: '
grep -oE 'V1[A-Z0-9. ·-]*' "$FILE" | head -1 || true

: > "$TMP/editor.b64"
for n in 1 2 3 4; do
  curl -fsSL "$BASE/v1d.part${n}.b64?$(date +%s)-$n" >> "$TMP/editor.b64"
done

ACTUAL_B64_SHA="$(sha256sum "$TMP/editor.b64" | awk '{print $1}')"
EXPECTED_B64_SHA="671c3f84934ee968274a160d150b64144af8e477eb5609c5831ea2a1fcc087b3"
if [ "$ACTUAL_B64_SHA" != "$EXPECTED_B64_SHA" ]; then
  echo "ERREUR: payload V1D incomplet ($ACTUAL_B64_SHA)" >&2
  exit 2
fi

base64 -d "$TMP/editor.b64" | gzip -dc > "$TMP/moorail-route-editor.html"

python3 - "$TMP/moorail-route-editor.html" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1])
s=p.read_text(encoding='utf-8')
# Le payload V1D avait gardé l'ancien badge. On le corrige ici avant les contrôles.
s=s.replace('<span class="badge">V1 · SAFE</span>','<span class="badge">V1D · NŒUDS</span>',1)
s=s.replace('<title>MooRail — Route Editor V1</title>','<title>MooRail — Route Editor V1D · NŒUDS</title>',1)
required=[
    'MOORAIL_TOPOLOGY_EDITOR_V1D',
    'function addManualGraphLink(',
    'function autoConnectVisibleJunctions(',
    'function beginRouteDrag(',
    'function endRouteDrag(',
    'function startLinkMode(',
    '🔀 Créer nœud / raccord',
    'V1D · NŒUDS',
]
missing=[x for x in required if x not in s]
if missing:
    raise SystemExit('ERREUR: fonctions V1D manquantes: '+', '.join(missing))
p.write_text(s,encoding='utf-8')
print('Contrôles fonctionnels V1D: OK')
PY

TMPJS="$TMP/editor.js"
python3 - "$TMP/moorail-route-editor.html" "$TMPJS" <<'PY'
from pathlib import Path
import re,sys
s=Path(sys.argv[1]).read_text(encoding='utf-8')
scripts=re.findall(r'<script(?: [^>]*)?>(.*?)</script>',s,re.S)
if not scripts:
    raise SystemExit('ERREUR: aucun script inline')
Path(sys.argv[2]).write_text(scripts[-1],encoding='utf-8')
PY
node --check "$TMPJS"

# Installation atomique seulement après tous les tests.
install -m 0644 "$TMP/moorail-route-editor.html" "$FILE"

# Vérification du fichier réellement installé.
grep -q 'V1D · NŒUDS' "$FILE"
grep -q 'MOORAIL_TOPOLOGY_EDITOR_V1D' "$FILE"
grep -q 'function beginRouteDrag' "$FILE"
grep -q 'function addManualGraphLink' "$FILE"

# Test via le serveur existant sans redémarrage.
OK=0
for i in $(seq 1 10); do
  if curl -fsS --max-time 3 "http://127.0.0.1:3111/moorail-route-editor.html?v=$STAMP" > "$TMP/public.html" 2>/dev/null; then
    if grep -q 'V1D · NŒUDS' "$TMP/public.html" && grep -q 'MOORAIL_TOPOLOGY_EDITOR_V1D' "$TMP/public.html"; then
      OK=1
      break
    fi
  fi
  sleep 1
done

if [ "$OK" != "1" ]; then
  echo "ERREUR: la page V1D n'est pas visible via le serveur. Restauration du HTML précédent." >&2
  cp -a "$BACKUP/moorail-route-editor.html" "$FILE"
  exit 4
fi

echo
echo "============================================================"
echo " MOO RAIL ROUTE EDITOR V1D.1 — NŒUDS / DRAG OK"
echo "============================================================"
echo "Page   : https://vps.labetaillere.fr/map-v2/moorail-route-editor.html"
echo "Backup : $BACKUP/moorail-route-editor.html"
echo
echo "Vérifié avant installation :"
echo " - drag direct du tracé cyan"
echo " - poignées déplaçables"
echo " - nœuds RFN visibles"
echo " - raccords proches reconnectés automatiquement"
echo " - création manuelle d'un raccord entre deux rails"
echo " - syntaxe JavaScript valide"
echo " - page réellement servie par 3111"
