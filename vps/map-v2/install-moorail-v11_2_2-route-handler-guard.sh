#!/usr/bin/env bash
set -euo pipefail

RAW="https://raw.githubusercontent.com/TekMaTe-lux/Assistant-train/main/vps/map-v2/install-moorail-v11_2-route-handler-guard.sh"
TMP="$(mktemp -d /tmp/moorail-v1122.XXXXXX)"
BASE="$TMP/v112.sh"
cleanup(){ rm -rf "$TMP"; }
trap cleanup EXIT

curl -fsSL "$RAW?$(date +%s)" -o "$BASE"

# IMPORTANT V11.2.2 : le heredoc externe s'appelle PYWRAP, et non PY.
# Le script V11.2 contient lui-même des heredocs <<'PY'; utiliser le même
# délimiteur coupait le wrapper Python en plein milieu (SyntaxError triple quote).
python3 - "$BASE" <<'PYWRAP'
from pathlib import Path
import sys
p=Path(sys.argv[1]);s=p.read_text(encoding='utf-8')

s=s.replace('MOO RAIL V11.2 — GARDE ROUTEUR / FIN DES DOUBLE-REPONSES','MOO RAIL V11.2.2 — GARDE ROUTEUR / PREFLIGHT RECOVERY',1)
s=s.replace('MOO RAIL V11.2 INSTALLE ET VALIDE','MOO RAIL V11.2.2 INSTALLE ET VALIDE',1)

old='''systemctl is-active --quiet "$SERVICE"
systemctl is-active --quiet "$TIMER"
curl -fsS --max-time 5 http://127.0.0.1:3111/api/map-v2/health > "$TMP/health-before.json"
python3 - "$TMP/health-before.json" <<'PY'
import json,sys
h=json.load(open(sys.argv[1])); assert h.get('ok') is True,h; print('Health :',h)
PY
'''
new='''# V11.2.2 : le bug que nous réparons peut justement mettre Map V2 en restart loop.
# Le pre-flight ne doit donc pas annuler le correctif seulement parce que /health
# tombe pendant une fenêtre de redémarrage.
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

s=s.replace(
    'echo "=== 0/8 PRE-FLIGHT ==="',
    'echo "=== 0/8 PRE-FLIGHT RECOVERY V11.2.2 ==="\necho "LB_MOORAIL_V1122_PREFLIGHT_RECOVERY"',
    1
)

p.write_text(s,encoding='utf-8')
print('Correctif V11.2.2 préparé :')
print(' - collision de heredoc PY corrigée')
print(' - pre-flight /health avec retry 30 s')
print(' - panne initiale autorisée uniquement avant patch')
print(' - contrôles node/structure conservés')
print(' - restart + self-tests HTTP V11.2 conservés intégralement')
PYWRAP

# Vérifie le wrapper généré AVANT de l'exécuter.
bash -n "$BASE"
chmod 700 "$BASE"
exec bash "$BASE"
