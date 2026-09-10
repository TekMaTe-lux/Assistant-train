#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="/opt/lb-rail-engine-v1"
APP="$ROOT/app"
STATE="$ROOT/state"
BACKUPS="$ROOT/data/backups"
TAG="$(date +%Y%m%d-%H%M%S)"
INSTALL_BAK="$BACKUPS/install-global-hs-v7-$TAG"
REPO_RAW="https://raw.githubusercontent.com/TekMaTe-lux/Assistant-train/main/vps/map-v2"
ROUTER="$APP/moorail_router_global_v7.py"
ENGINE="$APP/moorail_global_hs_v7.py"
DROPIN_DIR="/etc/systemd/system/lb-rail-v3-gtfs-update.service.d"
DROPIN="$DROPIN_DIR/95-global-hs-v7.conf"
OLD_OUEST="$DROPIN_DIR/90-lgv-ouest-v1.conf"
TMP_ROUTER="$(mktemp /tmp/moorail-router-global-v7.XXXXXX.py)"
TMP_ENGINE="$(mktemp /tmp/moorail-global-hs-v7.XXXXXX.py)"

cleanup(){ rm -f "$TMP_ROUTER" "$TMP_ENGINE"; }
trap cleanup EXIT

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "ERREUR : lance cet installateur avec sudo." >&2
  exit 2
fi

mkdir -p "$APP" "$STATE" "$BACKUPS" "$INSTALL_BAK"

echo "========================================================================================================================"
echo " MOO RAIL — INSTALL GLOBAL HIGH-SPEED V7"
echo " Tous corridors HGV + international + logique segmentaire + barreau provisoire Pasilly/Aisy"
echo "========================================================================================================================"

echo "1/6 Téléchargement et contrôle syntaxique…"
curl -fsSL "$REPO_RAW/moorail-router-global-v7.py?$TAG" -o "$TMP_ROUTER"
curl -fsSL "$REPO_RAW/moorail-global-hs-v7.py?$TAG" -o "$TMP_ENGINE"
python3 -m py_compile "$TMP_ROUTER" "$TMP_ENGINE"

echo "2/6 Sauvegarde de la configuration précédente…"
[[ -f "$ROUTER" ]] && cp -a "$ROUTER" "$INSTALL_BAK/moorail_router_global_v7.py.previous"
[[ -f "$ENGINE" ]] && cp -a "$ENGINE" "$INSTALL_BAK/moorail_global_hs_v7.py.previous"
[[ -f "$DROPIN" ]] && cp -a "$DROPIN" "$INSTALL_BAK/95-global-hs-v7.conf.previous"
[[ -f "$OLD_OUEST" ]] && cp -a "$OLD_OUEST" "$INSTALL_BAK/90-lgv-ouest-v1.conf.previous"

install -m 0644 "$TMP_ROUTER" "$ROUTER"
install -m 0755 "$TMP_ENGINE" "$ENGINE"
python3 -m py_compile "$ROUTER" "$ENGINE"

echo "3/6 Désactivation du vieux hook Ouest ciblé (supplanté par V7 globale)…"
if [[ -f "$OLD_OUEST" ]]; then
  rm -f "$OLD_OUEST"
fi

echo "4/6 Calcul + publication sécurisée de la DB France…"
python3 -u "$ENGINE" --apply

echo "5/6 Persistance après chaque reconstruction GTFS…"
if systemctl cat lb-rail-v3-gtfs-update.service >/dev/null 2>&1; then
  mkdir -p "$DROPIN_DIR"
  cat > "$DROPIN" <<EOF
[Service]
# MooRail GLOBAL HIGH-SPEED V7 : recalcule les géométries HGV après chaque GTFS.
# Le '-' évite de transformer une anomalie de routage en échec du téléchargement GTFS.
ExecStartPost=-/usr/bin/python3 $ENGINE --apply --post-update
EOF
  systemctl daemon-reload
else
  echo "ATTENTION : lb-rail-v3-gtfs-update.service absent ; le correctif actuel est appliqué mais le hook quotidien n'est pas installé."
fi

echo "6/6 Vérifications finales…"
python3 -m py_compile "$ROUTER" "$ENGINE"

echo
echo "--- HEALTH GLOBAL HS V7 ---"
cat "$STATE/moorail-global-hs-v7-health.json" 2>/dev/null || true

echo
echo "--- GTFS ExecStartPost ---"
systemctl show lb-rail-v3-gtfs-update.service -p ExecStartPost --no-pager 2>/dev/null || true

echo
echo "--- SNAPSHOT FRANCE ---"
systemctl is-active lb-rail-v3-france-hot-snapshot-preview || true
python3 - <<'PY'
import json
from pathlib import Path
p=Path('/opt/labetaillere-map-v2-src/map-v2/public/data/france-v3-active-now.json')
if p.exists():
    d=json.loads(p.read_text(encoding='utf-8'))
    print({'ok':d.get('ok'),'count':d.get('count'),'generatedAt':d.get('generatedAt') or d.get('generated_at')})
PY

echo
echo "========================================================================================================================"
echo " FIN OK — GLOBAL HIGH-SPEED V7 INSTALLÉ"
echo " Routeur : $ROUTER"
echo " Moteur  : $ENGINE"
echo " Backup  : $INSTALL_BAK"
echo " HTML    : INCHANGÉ"
echo "========================================================================================================================"
