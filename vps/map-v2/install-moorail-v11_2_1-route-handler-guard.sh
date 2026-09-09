#!/usr/bin/env bash
set -euo pipefail

RAW="https://raw.githubusercontent.com/TekMaTe-lux/Assistant-train/main/vps/map-v2/install-moorail-v11_2-route-handler-guard.sh"
TMP="$(mktemp -d /tmp/moorail-v1121.XXXXXX)"
BASE="$TMP/v112.sh"
cleanup(){ rm -rf "$TMP"; }
trap cleanup EXIT

curl -fsSL "$RAW?$(date +%s)" -o "$BASE"

python3 - "$BASE" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1]);s=p.read_text(encoding='utf-8')

s=s.replace('MOO RAIL V11.2 — GARDE ROUTEUR / FIN DES DOUBLE-REPONSES','MOO RAIL V11.2.1 — GARDE ROUTEUR / PREFLIGHT RECOVERY',1)
s=s.replace('MOO RAIL V11.2 INSTALLE ET VALIDE','MOO RAIL V11.2.1 INSTALLE ET VALIDE',1)

old='''systemctl is-active --quiet "$SERVICE"
systemctl is-active --quiet "$TIMER"
curl -fsS --max-time 5 http://127.0.0.1:3111/api/map-v2/health > "$TMP/health-before.json"
python3 - "$TMP/health-before.json" <<'PY'
import json,sys
h=json.load(open(sys.argv[1])); assert h.get('ok') is True,h; print('Health :',h)
PY
'''
new='''# V11.2.1 : le bug que nous réparons peut justement mettre Map V2 en restart loop.
# Le pre-flight ne doit donc plus annuler le correctif uniquement parce que /health
# tombe pendant une fenêtre de redémarrage. On tente d'abord une récupération courte ;
# si elle échoue, on poursuit les contrôles STRUCTURELS hors-ligne puis V11.2 fera
# un restart propre et ses vrais self-tests HTTP après installation.
systemctl is-active "$SERVICE" || true
systemctl is-active --quiet "$TIMER"
PREHEALTH_OK=0
for i in $(seq 1 30); do
  if curl -fsS --max-time 3 http://127.0.0.1:3111/api/map-v2/health > "$TMP/health-before.json" 2>/dev/null; then
    PREHEALTH_OK=1
    break
  fi
  echo "  attente pre-flight map $i/30..."
  sleep 1
done
if [[ "$PREHEALTH_OK" == 1 ]]; then
  python3 - "$TMP/health-before.json" <<'PY'
import json,sys
h=json.load(open(sys.argv[1])); assert h.get('ok') is True,h; print('Health :',h)
PY
else
  echo "⚠️  /health indisponible avant patch : poursuite autorisée car V11.2 corrige précisément le crash HTTP."
  echo "    Les fichiers seront contrôlés par node --check avant toute installation."
fi
'''
if old not in s:
    raise SystemExit('ERREUR: bloc pre-flight V11.2 introuvable')
s=s.replace(old,new,1)

# Marqueur spécifique wrapper pour vérification de provenance.
s=s.replace('echo "=== 0/8 PRE-FLIGHT ==="','echo "=== 0/8 PRE-FLIGHT RECOVERY V11.2.1 ==="\necho "LB_MOORAIL_V1121_PREFLIGHT_RECOVERY"',1)

p.write_text(s,encoding='utf-8')
print('Correctif V11.2.1 préparé :')
print(' - pre-flight /health avec retry 30 s')
print(' - panne initiale autorisée uniquement avant patch')
print(' - contrôles node/structure conservés')
print(' - restart + self-tests HTTP V11.2 conservés intégralement')
PY

bash -n "$BASE"
chmod 700 "$BASE"
exec bash "$BASE"
