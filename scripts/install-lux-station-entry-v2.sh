#!/usr/bin/env bash
set -Eeuo pipefail

BRANCH="${LB_V4_BRANCH:-refonte-v4-command-center}"
RAW="https://raw.githubusercontent.com/TekMaTe-lux/Assistant-train/${BRANCH}"
ROOT="/opt/labetaillere-map-v2-src/map-v2/public"
WRAPPER="${ROOT}/carte-preview.html"
CORE="${ROOT}/carte-core-preview.html"
ENTRY="${ROOT}/lb-lux-station-entry-v2.js"
HOST="${ROOT}/lb-lux-station-host-v2.js"
STAMP="$(date +%Y%m%d-%H%M%S)"
TMP="$(mktemp -d /tmp/lb-lux-station-v2.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  echo "ERREUR: lancer avec sudo bash." >&2
  exit 2
fi
for cmd in curl python3; do command -v "$cmd" >/dev/null || { echo "ERREUR: $cmd absent" >&2; exit 2; }; done
[[ -f "$WRAPPER" ]] || { echo "ERREUR: wrapper introuvable: $WRAPPER" >&2; exit 3; }
[[ -f "$CORE" ]] || { echo "ERREUR: coeur carte introuvable: $CORE" >&2; exit 3; }

curl -fL --retry 3 --connect-timeout 8 --max-time 30 "${RAW}/assets/map-lux-station-entry-v2.js" -o "$TMP/entry.js"
curl -fL --retry 3 --connect-timeout 8 --max-time 30 "${RAW}/assets/map-lux-station-host-v2.js" -o "$TMP/host.js"

if command -v node >/dev/null 2>&1; then
  node --check "$TMP/entry.js"
  node --check "$TMP/host.js"
fi

cp -a "$WRAPPER" "$WRAPPER.bak-lux-station-v2-$STAMP"
cp -a "$CORE" "$CORE.bak-lux-station-v2-$STAMP"
echo "=== SAUVEGARDES ==="
echo "$WRAPPER.bak-lux-station-v2-$STAMP"
echo "$CORE.bak-lux-station-v2-$STAMP"

install -m 0644 "$TMP/entry.js" "$ENTRY"
install -m 0644 "$TMP/host.js" "$HOST"

python3 - "$WRAPPER" "$CORE" <<'PY'
from pathlib import Path
import re, sys
wrapper = Path(sys.argv[1])
core = Path(sys.argv[2])

w = wrapper.read_text(encoding='utf-8')
c = core.read_text(encoding='utf-8')

# Nettoyage du mauvais branchement V1 dans le wrapper.
w = re.sub(r'\s*<script[^>]+lb-lux-station-entry-v1\.js[^>]*></script>\s*', '\n', w, flags=re.I)

host_marker = 'lb-lux-station-host-v2.js'
if host_marker not in w:
    if '</body>' not in w:
        raise SystemExit('ERREUR: </body> absent de carte-preview.html')
    w = w.replace('</body>', '<script src="./lb-lux-station-host-v2.js?v=20260827-2"></script>\n</body>', 1)

entry_marker = 'lb-lux-station-entry-v2.js'
if entry_marker not in c:
    if '</body>' not in c:
        raise SystemExit('ERREUR: </body> absent de carte-core-preview.html')
    c = c.replace('</body>', '<script src="./lb-lux-station-entry-v2.js?v=20260827-2"></script>\n</body>', 1)

wrapper.write_text(w, encoding='utf-8')
core.write_text(c, encoding='utf-8')
PY

grep -q 'lb-lux-station-host-v2.js' "$WRAPPER" || { echo "ERREUR: hôte V2 non branché" >&2; exit 4; }
grep -q 'lb-lux-station-entry-v2.js' "$CORE" || { echo "ERREUR: entrée V2 non branchée au coeur" >&2; exit 4; }
[[ -s "$ENTRY" && -s "$HOST" ]] || { echo "ERREUR: assets V2 absents" >&2; exit 4; }

if grep -q 'lb-lux-station-entry-v1.js' "$WRAPPER"; then
  echo "ERREUR: ancien branchement V1 encore présent dans le wrapper" >&2
  exit 4
fi

echo
echo "==============================================="
echo "ACCÈS GARE DYNAMIQUE LUXEMBOURG V2 — INSTALLÉ"
echo "==============================================="
echo "✅ bouton injecté dans carte-core-preview.html"
echo "✅ visible uniquement dans la fiche Gare de Luxembourg"
echo "✅ Départs / Arrivées conservés"
echo "✅ clic = gare dynamique dans la même zone Carte"
echo "✅ bouton ← Retour à la carte ajouté dans le wrapper"
echo "✅ ancien mauvais branchement V1 retiré du wrapper"
echo "✅ aucun nginx / systemd / moteur ferroviaire modifié"
echo
echo "Recharge ensuite la preview avec Ctrl+F5."
