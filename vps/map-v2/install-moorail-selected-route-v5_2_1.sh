#!/usr/bin/env bash
set -euo pipefail

STAMP="$(date +%Y%m%d-%H%M%S)"
TMP="$(mktemp -d /tmp/moorail-v521.XXXXXX)"
RAW="https://raw.githubusercontent.com/TekMaTe-lux/Assistant-train/main/vps/map-v2/install-moorail-selected-route-v5_2.sh"

cleanup(){ rm -rf "$TMP"; }
trap cleanup EXIT

[[ ${EUID:-$(id -u)} -eq 0 ]] || { echo "ERREUR: lancer avec sudo/root" >&2; exit 2; }

echo "============================================================"
echo " MOO RAIL V5.2.1 — CORRECTIF CONTROLE PAGE LOCALE"
echo "============================================================"

echo "=== Téléchargement V5.2 ==="
curl -fsSL "$RAW?$STAMP" -o "$TMP/v52.sh"

# Le serveur Node écoute directement sur 3111 à la racine de son public/.
# /map-v2/ est le préfixe du reverse-proxy public, pas celui du serveur local.
python3 - "$TMP/v52.sh" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1])
s=p.read_text(encoding='utf-8')
old='http://127.0.0.1:3111/map-v2/carte-core-canonical-v4-preview.html'
new='http://127.0.0.1:3111/carte-core-canonical-v4-preview.html'
if old not in s:
    raise SystemExit('ERREUR: URL de contrôle V5.2 attendue absente')
s=s.replace(old,new,1)
p.write_text(s,encoding='utf-8')
PY

chmod 700 "$TMP/v52.sh"

echo "=== Exécution V5.2 corrigée ==="
bash "$TMP/v52.sh"

echo

echo "============================================================"
echo " MOO RAIL V5.2.1 INSTALLE"
echo "============================================================"
echo "Le seul correctif V5.2.1 concerne le contrôle HTTP local :"
echo " - public : /map-v2/... via reverse proxy"
echo " - local  : /... directement sur :3111"
echo "============================================================"
