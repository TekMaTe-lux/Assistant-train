#!/usr/bin/env bash
set -euo pipefail

ROOT="${MOORAIL_ROOT:-/opt/labetaillere-map-v2-src/map-v2}"
FILE="$ROOT/public/moorail-route-editor.html"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$ROOT/backups/route-editor-topology-v1d-$STAMP"
BASE="https://raw.githubusercontent.com/TekMaTe-lux/Assistant-train/main/vps/map-v2/route-editor"
TMP="$(mktemp -d /tmp/moorail-v1d.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

[ -f "$FILE" ] || { echo "ERREUR: $FILE introuvable" >&2; exit 1; }
mkdir -p "$BACKUP"
cp -a "$FILE" "$BACKUP/moorail-route-editor.html"

: > "$TMP/editor.b64"
for n in 1 2 3 4; do
  curl -fsSL "$BASE/v1d.part${n}.b64?$(date +%s)" >> "$TMP/editor.b64"
done

ACTUAL_B64_SHA="$(sha256sum "$TMP/editor.b64" | awk '{print $1}')"
EXPECTED_B64_SHA="671c3f84934ee968274a160d150b64144af8e477eb5609c5831ea2a1fcc087b3"
[ "$ACTUAL_B64_SHA" = "$EXPECTED_B64_SHA" ] || {
  echo "ERREUR: payload V1D incomplet ($ACTUAL_B64_SHA)" >&2
  exit 2
}

base64 -d "$TMP/editor.b64" | gzip -dc > "$TMP/moorail-route-editor.html"
ACTUAL_HTML_SHA="$(sha256sum "$TMP/moorail-route-editor.html" | awk '{print $1}')"
EXPECTED_HTML_SHA="43923dfecb6f0b419943a629b0d386d131dd817482a6948943365661558ed10e"
[ "$ACTUAL_HTML_SHA" = "$EXPECTED_HTML_SHA" ] || {
  echo "ERREUR: HTML V1D incorrect ($ACTUAL_HTML_SHA)" >&2
  exit 3
}

TMPJS="$TMP/editor.js"
python3 - "$TMP/moorail-route-editor.html" "$TMPJS" <<'PY'
from pathlib import Path
import re,sys
s=Path(sys.argv[1]).read_text(encoding='utf-8')
assert 'V1D · NŒUDS' in s
assert 'MOORAIL_TOPOLOGY_EDITOR_V1D' in s
scripts=re.findall(r'<script(?: [^>]*)?>(.*?)</script>',s,re.S)
if not scripts:
    raise SystemExit('aucun script inline')
Path(sys.argv[2]).write_text(scripts[-1],encoding='utf-8')
PY
node --check "$TMPJS"
install -m 0644 "$TMP/moorail-route-editor.html" "$FILE"

echo
echo "============================================================"
echo " MOO RAIL ROUTE EDITOR V1D — TOPOLOGIE / NŒUDS OK"
echo "============================================================"
echo "Page : https://vps.labetaillere.fr/map-v2/moorail-route-editor.html"
echo "Backup : $BACKUP/moorail-route-editor.html"
echo
echo "Nouveautés :"
echo " - attraper et tirer directement le tracé cyan"
echo " - nœuds RFN visibles au zoom >= 12"
echo " - petits raccords géométriques reconnectés automatiquement"
echo " - bouton Créer nœud / raccord pour relier deux rails manuellement"
echo " - raccords manuels conservés avec la section validée"
