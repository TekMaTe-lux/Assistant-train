#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="/opt/lb-rail-engine-v1"
APP="$ROOT/app"
STATE="$ROOT/state"
PY="$APP/fix_moorail_lgv_ouest_v1.py"
DROPIN_DIR="/etc/systemd/system/lb-rail-v3-gtfs-update.service.d"
DROPIN="$DROPIN_DIR/90-lgv-ouest-v1.conf"
URL="https://raw.githubusercontent.com/TekMaTe-lux/Assistant-train/main/vps/map-v2/fix-moorail-lgv-ouest-v1.py"
TAG="$(date +%Y%m%d-%H%M%S)"
BACKUP="$ROOT/data/backups/install-lgv-ouest-v1-$TAG"
TMP="$(mktemp /tmp/fix-moorail-lgv-ouest-v1.XXXXXX.py)"

cleanup(){ rm -f "$TMP"; }
trap cleanup EXIT

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "ERREUR : lance cet installateur avec sudo." >&2
  exit 2
fi

mkdir -p "$APP" "$STATE" "$ROOT/data/backups" "$BACKUP"

echo "========================================================================================================================"
echo " MOO RAIL — INSTALL FIX LGV OUEST V1"
echo " TGV/OUIGO Ouest : suppression du mauvais passage Paris–Chartres–Nogent–Le Mans"
echo "========================================================================================================================"

echo "1/5 Téléchargement du correctif…"
curl -fsSL "$URL?$TAG" -o "$TMP"
python3 -m py_compile "$TMP"

if [[ ! -f "$APP/compiler_moorail_auto_lgv_v4_1.py" ]]; then
  if [[ -f /home/ubuntu/compiler-moorail-auto-lgv-v4.1.py ]]; then
    install -m 0644 /home/ubuntu/compiler-moorail-auto-lgv-v4.1.py "$APP/compiler_moorail_auto_lgv_v4_1.py"
  else
    echo "ERREUR : compilateur V4.1 absent." >&2
    exit 2
  fi
fi

if [[ ! -f "$APP/moorail_auto_lgv_router_v3.py" ]]; then
  if [[ -f /home/ubuntu/moorail-auto-lgv-router-v3.py ]]; then
    install -m 0644 /home/ubuntu/moorail-auto-lgv-router-v3.py "$APP/moorail_auto_lgv_router_v3.py"
  else
    echo "ERREUR : routeur V3 absent." >&2
    exit 2
  fi
fi

python3 -m py_compile "$APP/compiler_moorail_auto_lgv_v4_1.py" "$APP/moorail_auto_lgv_router_v3.py"

echo "2/5 Sauvegarde du script/hook précédents…"
[[ -f "$PY" ]] && cp -a "$PY" "$BACKUP/fix_moorail_lgv_ouest_v1.py.previous"
[[ -f "$DROPIN" ]] && cp -a "$DROPIN" "$BACKUP/90-lgv-ouest-v1.conf.previous"

install -m 0755 "$TMP" "$PY"

echo "3/5 Correction sécurisée des SQLite actives…"
python3 -u "$PY" --apply

echo "4/5 Installation de la persistance après chaque mise à jour GTFS…"
if systemctl cat lb-rail-v3-gtfs-update.service >/dev/null 2>&1; then
  mkdir -p "$DROPIN_DIR"
  cat > "$DROPIN" <<EOF
[Service]
# Le '-' laisse l'update GTFS finir même si le garde Ouest refuse une géométrie.
# Le correctif écrit alors son état dans $STATE/lgv-ouest-v1-health.json.
ExecStartPost=-/usr/bin/python3 $PY --apply --post-update
EOF
  systemctl daemon-reload
else
  echo "ATTENTION : lb-rail-v3-gtfs-update.service absent ; correction actuelle OK, hook automatique non installé."
fi

echo "5/5 Contrôles finaux…"
python3 -m py_compile "$PY"
cat "$STATE/lgv-ouest-v1-health.json" 2>/dev/null || true

echo
echo "ExecStartPost GTFS :"
systemctl show lb-rail-v3-gtfs-update.service -p ExecStartPost --no-pager 2>/dev/null || true

echo
echo "========================================================================================================================"
echo " FIN OK — LGV OUEST V1 INSTALLÉE"
echo " Backup installateur : $BACKUP"
echo " Correctif            : $PY"
echo " Health               : $STATE/lgv-ouest-v1-health.json"
echo " Aucun HTML de france-v3-preview.html n'a été modifié."
echo "========================================================================================================================"
