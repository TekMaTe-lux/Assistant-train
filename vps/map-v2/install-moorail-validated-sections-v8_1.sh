#!/usr/bin/env bash
set -euo pipefail

ROOT="${MOORAIL_ROOT:-/opt/labetaillere-map-v2-src/map-v2}"
PUBLIC="$ROOT/public"
SERVICE="labetaillere-map-v2.service"
STAMP="$(date +%Y%m%d-%H%M%S)"
TRANS_BACKUP="$ROOT/backups/moorail-v8_1-transition-$STAMP"
TMP="$(mktemp -d /tmp/moorail-v8_1.XXXXXX)"
BASE="https://raw.githubusercontent.com/TekMaTe-lux/Assistant-train/main/vps/map-v2"
SUCCESS=0
TOUCHED=0

cleanup(){ rm -rf "$TMP"; }
rollback(){
  [[ "$SUCCESS" == 1 ]] && return 0
  if [[ "$TOUCHED" == 1 && -d "$TRANS_BACKUP/current" ]]; then
    echo "ROLLBACK TRANSITION V8.1 : restauration des moteurs V5.3 d'origine..." >&2
    for f in "$TRANS_BACKUP/current"/*.html; do
      [[ -f "$f" ]] || continue
      cp -a "$f" "$PUBLIC/$(basename "$f")"
    done
    systemctl restart "$SERVICE" >/dev/null 2>&1 || true
  fi
}
finish(){ rc=$?; trap - EXIT; rollback; cleanup; exit "$rc"; }
trap finish EXIT

[[ ${EUID:-$(id -u)} -eq 0 ]] || { echo "ERREUR: lancer avec sudo/root" >&2; exit 2; }

echo "============================================================"
echo " MOO RAIL V8.1 — TRANSITION SURE V5.3 -> VALIDATED SECTIONS"
echo "============================================================"

systemctl is-active --quiet "$SERVICE"
curl -fsS --max-time 5 http://127.0.0.1:3111/api/map-v2/health > "$TMP/health-before.json"
python3 - "$TMP/health-before.json" <<'PY'
import json,sys
h=json.load(open(sys.argv[1],encoding='utf-8'))
assert h.get('ok') is True,h
print('Health avant :',h)
PY

TARGETS=()
V53_TARGETS=()
for name in carte-core-canonical-v4-preview.html carte-core-preview.html france-v3-preview.html; do
  f="$PUBLIC/$name"
  [[ -f "$f" ]] || continue
  if grep -qF 'function lbMoorailPathBetweenStops(stopA,stopB)' "$f"; then
    TARGETS+=("$f")
    if grep -qF 'LB_MOORAIL_COMPOSED_PATH_V53' "$f"; then
      V53_TARGETS+=("$f")
    fi
  fi
done
[[ ${#TARGETS[@]} -gt 0 ]] || { echo "ERREUR: aucun moteur France V3 MooRail détecté" >&2; exit 3; }

echo "Moteurs MooRail détectés : ${#TARGETS[@]}"
echo "Moteurs portant V5.3     : ${#V53_TARGETS[@]}"

if [[ ${#V53_TARGETS[@]} -gt 0 ]]; then
  echo "=== 1/6 Recherche du backup exact créé avant V5.3 ==="
  V53_BACKUP="$(python3 - "$ROOT/backups" <<'PY'
from pathlib import Path
import sys
root=Path(sys.argv[1])
items=[p for p in root.glob('moorail-composed-sections-v5_3-*') if p.is_dir()]
items.sort(key=lambda p:p.stat().st_mtime, reverse=True)
print(items[0] if items else '')
PY
)"
  [[ -n "$V53_BACKUP" && -d "$V53_BACKUP" ]] || {
    echo "ERREUR: V5.3 est active mais son backup pré-V5.3 est introuvable." >&2
    echo "Aucune modification effectuée." >&2
    exit 4
  }
  echo "Backup pré-V5.3 : $V53_BACKUP"

  mkdir -p "$TRANS_BACKUP/current" "$TRANS_BACKUP/pre-v53"
  for f in "${V53_TARGETS[@]}"; do
    name="$(basename "$f")"
    src="$V53_BACKUP/$name"
    [[ -f "$src" ]] || { echo "ERREUR: $src absent" >&2; exit 4; }
    grep -qF 'LB_MOORAIL_LIVE_PATH_V44' "$src" || { echo "ERREUR: backup $name ne contient pas V4.4 live" >&2; exit 4; }
    grep -qF 'function lbMoorailPathBetweenStops(stopA,stopB)' "$src" || { echo "ERREUR: backup $name n'est pas un moteur MooRail compatible" >&2; exit 4; }
    # V5.2 peut ne pas être dans tous les fichiers, mais s'il était dans l'actuel il doit exister dans le backup.
    if grep -qF 'LB_MOORAIL_SELECTED_ROUTE_V52' "$f"; then
      grep -qF 'LB_MOORAIL_SELECTED_ROUTE_V52' "$src" || { echo "ERREUR: $name perdrait V5.2 pendant la transition" >&2; exit 4; }
    fi
    cp -a "$f" "$TRANS_BACKUP/current/$name"
    cp -a "$src" "$TRANS_BACKUP/pre-v53/$name"
  done

  echo "=== 2/6 Retrait contrôlé de V5.3 par restauration de son propre backup ==="
  TOUCHED=1
  for f in "${V53_TARGETS[@]}"; do
    name="$(basename "$f")"
    cp -a "$TRANS_BACKUP/pre-v53/$name" "$f"
    if grep -qF 'LB_MOORAIL_COMPOSED_PATH_V53' "$f"; then
      echo "ERREUR: V5.3 encore présente après restauration dans $name" >&2
      exit 5
    fi
    grep -qF 'LB_MOORAIL_LIVE_PATH_V44' "$f"
    grep -qF 'function lbMoorailPathBetweenStops(stopA,stopB)' "$f"
    echo "Nettoyé proprement : $name"
  done
else
  echo "=== 1/6 Aucun V5.3 actif : transition inutile ==="
  echo "=== 2/6 Moteurs déjà compatibles avec V8 ==="
fi

# Vérifie que France V3 est toujours saine avant d'appeler V8.
systemctl restart "$SERVICE"
for _ in $(seq 1 30); do
  if systemctl is-active --quiet "$SERVICE" && curl -fsS --max-time 2 http://127.0.0.1:3111/api/map-v2/health >/dev/null 2>&1; then break; fi
  sleep 1
done
systemctl is-active --quiet "$SERVICE"

echo "=== 3/6 Téléchargement de l'installateur V8 canonique ==="
curl -fsSL "$BASE/install-moorail-validated-sections-v8.sh?$STAMP" -o "$TMP/v8.sh"
chmod 0755 "$TMP/v8.sh"
grep -qF 'MOO RAIL V8 — VALIDATED SECTIONS' "$TMP/v8.sh"

echo "=== 4/6 Installation V8 avec ses 10 contrôles internes ==="
bash "$TMP/v8.sh"

# A partir d'ici V8 a annoncé SUCCESS. On vérifie encore depuis l'extérieur.
echo "=== 5/6 Contrôles indépendants après V8 ==="
for _ in $(seq 1 30); do
  if systemctl is-active --quiet "$SERVICE" && curl -fsS --max-time 2 http://127.0.0.1:3111/api/map-v2/health >/dev/null 2>&1; then break; fi
  sleep 1
done
systemctl is-active --quiet "$SERVICE"
curl -fsS --max-time 5 http://127.0.0.1:3111/api/map-v2/health > "$TMP/health-after.json"
python3 - "$TMP/health-after.json" <<'PY'
import json,sys
h=json.load(open(sys.argv[1],encoding='utf-8'));assert h.get('ok') is True,h
print('Health après :',h)
PY

curl -fsS --max-time 8 "http://127.0.0.1:3111/moorail-route-editor.html?v=$STAMP" -o "$TMP/editor.html"
grep -qF 'V8 · VALIDATED SECTIONS' "$TMP/editor.html"

curl -fsS --max-time 8 "http://127.0.0.1:3111/data/moorail-network-v8/network.json?v=$STAMP" -o "$TMP/network.json"
python3 - "$TMP/network.json" <<'PY'
import json,sys
p=json.load(open(sys.argv[1],encoding='utf-8'))
assert p.get('version')==8,p.get('version')
assert int(p.get('strictTripsToday') or 0)>100,p.get('strictTripsToday')
c=p.get('controls') or {}
assert all((c.get('mustBePresent') or {}).values()),c
assert all((c.get('mustBeAbsent') or {}).values()),c
print('Network V8 :',p.get('strictTripsToday'),'GV /', (p.get('stats') or {}).get('tasks'),'briques')
print('Contrôles  :',c)
PY

systemctl is-active --quiet moorail-network-v8-refresh.timer

# Il ne doit plus rester de moteur de composition libre V5.3.
for f in "${TARGETS[@]}"; do
  [[ -f "$f" ]] || continue
  if grep -qF 'LB_MOORAIL_COMPOSED_PATH_V53' "$f"; then
    echo "ERREUR: V5.3 libre encore présente dans $f après V8" >&2
    exit 6
  fi
  grep -qF 'LB_MOORAIL_LIVE_PATH_V44' "$f"
done

echo "=== 6/6 Transition V5.3 -> V8 validée ==="
SUCCESS=1
trap - EXIT
cleanup

echo
echo "============================================================"
echo " MOO RAIL V8.1 INSTALLE ET VALIDE"
echo "============================================================"
echo " - V5.3 libre retirée à partir de son backup exact"
echo " - V8 Validated Sections installée"
echo " - éditeur V8 servi"
echo " - réseau V8 servi"
echo " - filtre GV strict validé"
echo " - timer de refresh actif"
echo " - health Map V2 OK"
echo "Transition backup : $TRANS_BACKUP"
echo "============================================================"
