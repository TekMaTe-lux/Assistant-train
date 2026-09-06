#!/usr/bin/env bash
set -euo pipefail

ROOT="/opt/labetaillere-map-v2-src"
ENGINE="/opt/lb-rail-engine-v1"
SERVICE="lb-rail-engine-v1.service"
PROD_SERVICE="labetaillere-map-v2.service"
# 3120 appartient déjà à labetaillere-data-v4.service sur le VPS.
# Le moteur V1 utilise donc 3121 par défaut, tout en restant surchargeable explicitement.
PORT="${LB_RAIL_ENGINE_PORT:-3121}"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="/opt/lb-rail-engine-v1-backups/$STAMP"

need() { command -v "$1" >/dev/null 2>&1 || { echo "ERREUR: commande absente: $1" >&2; exit 2; }; }
need python3; need git; need curl; need systemctl; need ss

if [[ ! -d "$ROOT/.git" ]]; then
  echo "ERREUR: dépôt introuvable: $ROOT" >&2
  exit 2
fi
if [[ ! -f "$ROOT/map-v2/data/sources/sncf-gtfs.zip" || ! -f "$ROOT/map-v2/data/sources/lux-gtfs.zip" ]]; then
  echo "ERREUR: GTFS source manquant, rien n'est modifié." >&2
  exit 2
fi

if ss -ltnH | awk '{print $4}' | grep -Eq "(^|:)${PORT}$"; then
  echo "ERREUR: port ${PORT} déjà utilisé. Rien n'est modifié." >&2
  exit 2
fi

PROD_BEFORE="$(systemctl show "$PROD_SERVICE" -p ActiveState -p SubState -p MainPID 2>/dev/null || true)"
echo "=== PRODUCTION AVANT ==="
echo "$PROD_BEFORE"

echo "=== SAUVEGARDE ENGINE PRECEDENT SI PRESENT ==="
if [[ -d "$ENGINE" || -f "/etc/systemd/system/$SERVICE" ]]; then
  sudo mkdir -p "$BACKUP"
  [[ -d "$ENGINE" ]] && sudo cp -a "$ENGINE/app" "$ENGINE/config" "$BACKUP/" 2>/dev/null || true
  [[ -f "/etc/systemd/system/$SERVICE" ]] && sudo cp -a "/etc/systemd/system/$SERVICE" "$BACKUP/" || true
  echo "backup: $BACKUP"
else
  echo "première installation"
fi

echo "=== CREATION ARBORESCENCE ISOLEE ==="
sudo mkdir -p "$ENGINE"/{app,config,sources,data,logs,tmp}
sudo chown -R ubuntu:ubuntu "$ENGINE"

cd "$ROOT"
git fetch origin main

git show origin/main:lb-datahub-v1/engine/build_timetable_sqlite_v1.py > /tmp/build_timetable_sqlite_v1.py
git show origin/main:lb-datahub-v1/engine/server_v1.py > /tmp/lb_rail_server_v1.py
python3 -m py_compile /tmp/build_timetable_sqlite_v1.py /tmp/lb_rail_server_v1.py
install -m 0755 /tmp/build_timetable_sqlite_v1.py "$ENGINE/app/build_timetable_sqlite_v1.py"
install -m 0755 /tmp/lb_rail_server_v1.py "$ENGINE/app/server_v1.py"
chown ubuntu:ubuntu "$ENGINE/app/"*.py

echo "=== SNAPSHOT SOURCES ==="
install -m 0644 "$ROOT/map-v2/data/sources/sncf-gtfs.zip" "$ENGINE/sources/sncf-gtfs.zip"
install -m 0644 "$ROOT/map-v2/data/sources/lux-gtfs.zip" "$ENGINE/sources/lux-gtfs.zip"
chown ubuntu:ubuntu "$ENGINE/sources/"*.zip
sha256sum "$ENGINE/sources/"*.zip | tee "$ENGINE/sources/SHA256SUMS"
chown ubuntu:ubuntu "$ENGINE/sources/SHA256SUMS"

echo "=== BUILD SQLITE ATOMIQUE ==="
sudo -u ubuntu python3 "$ENGINE/app/build_timetable_sqlite_v1.py" \
  --sncf "$ENGINE/sources/sncf-gtfs.zip" \
  --lux "$ENGINE/sources/lux-gtfs.zip" \
  --out "$ENGINE/data/timetable.sqlite"

python3 - "$ENGINE/data/timetable.sqlite" <<'PY'
import sqlite3, sys
p=sys.argv[1]
db=sqlite3.connect(f'file:{p}?mode=ro', uri=True)
print('integrity:', db.execute('PRAGMA integrity_check').fetchone()[0])
print('trips:', db.execute('SELECT source,mode,COUNT(*) FROM trips GROUP BY source,mode ORDER BY source,mode').fetchall())
print('days:', db.execute('SELECT MIN(service_date),MAX(service_date),COUNT(DISTINCT service_date) FROM day_trips').fetchone())
q="""SELECT t.source,t.mode,COUNT(*)
FROM day_trips dt
JOIN trips t ON t.source=dt.source AND t.trip_id=dt.trip_id
WHERE dt.service_date=?
GROUP BY t.source,t.mode
ORDER BY t.source,t.mode"""
print('20260906:', db.execute(q, ('20260906',)).fetchall())
print('20260907:', db.execute(q, ('20260907',)).fetchall())
PY

echo "=== SYSTEMD ISOLE ==="
cat > /tmp/$SERVICE <<EOF
[Unit]
Description=La Betaillere Rail Engine v1 (isolated localhost)
After=network.target

[Service]
Type=simple
User=ubuntu
Group=ubuntu
WorkingDirectory=$ENGINE
ExecStart=/usr/bin/python3 $ENGINE/app/server_v1.py --db $ENGINE/data/timetable.sqlite --host 127.0.0.1 --port $PORT
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=$ENGINE/logs $ENGINE/tmp
ProtectHome=true

[Install]
WantedBy=multi-user.target
EOF
sudo install -m 0644 /tmp/$SERVICE /etc/systemd/system/$SERVICE
sudo systemctl daemon-reload
sudo systemctl enable --now "$SERVICE"

sleep 1

echo "=== HEALTH ==="
systemctl --no-pager --full status "$SERVICE" | sed -n '1,18p'
echo
curl -fsS "http://127.0.0.1:${PORT}/status" | python3 -m json.tool
echo
curl -fsS "http://127.0.0.1:${PORT}/day/2026-09-06" | python3 -m json.tool
echo
curl -fsS "http://127.0.0.1:${PORT}/day/2026-09-07" | python3 -m json.tool

echo "=== PRODUCTION APRES ==="
PROD_AFTER="$(systemctl show "$PROD_SERVICE" -p ActiveState -p SubState -p MainPID 2>/dev/null || true)"
echo "$PROD_AFTER"
if [[ "$PROD_BEFORE" != "$PROD_AFTER" ]]; then
  echo "ATTENTION: l'état/PID du service production a changé pendant l'installation." >&2
  echo "AVANT:" >&2; echo "$PROD_BEFORE" >&2
  echo "APRES:" >&2; echo "$PROD_AFTER" >&2
  exit 3
fi

echo
echo "OK: LB Rail Engine v1 installé en parallèle sur 127.0.0.1:${PORT}"
echo "Aucune route nginx ajoutée. Aucun fichier map-v2/public modifié. Aucun redémarrage de $PROD_SERVICE."
