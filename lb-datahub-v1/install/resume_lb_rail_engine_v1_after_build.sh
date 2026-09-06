#!/usr/bin/env bash
set -euo pipefail

ENGINE="/opt/lb-rail-engine-v1"
SERVICE="lb-rail-engine-v1.service"
PROD_SERVICE="labetaillere-map-v2.service"
PORT="${LB_RAIL_ENGINE_PORT:-3121}"
DB="$ENGINE/data/timetable.sqlite"
SERVER="$ENGINE/app/server_v1.py"

need() { command -v "$1" >/dev/null 2>&1 || { echo "ERREUR: commande absente: $1" >&2; exit 2; }; }
need python3; need curl; need systemctl; need ss

[[ -f "$DB" ]] || { echo "ERREUR: base absente: $DB" >&2; exit 2; }
[[ -f "$SERVER" ]] || { echo "ERREUR: serveur absent: $SERVER" >&2; exit 2; }

if ss -ltnH | awk '{print $4}' | grep -Eq "(^|:)${PORT}$"; then
  echo "ERREUR: port ${PORT} déjà utilisé. Rien n'est modifié." >&2
  exit 2
fi

PROD_BEFORE="$(systemctl show "$PROD_SERVICE" -p ActiveState -p SubState -p MainPID 2>/dev/null || true)"
echo "=== PRODUCTION AVANT ==="
echo "$PROD_BEFORE"

echo "=== VALIDATION BASE EXISTANTE — PAS DE REBUILD ==="
python3 - "$DB" <<'PY'
import sqlite3, sys
p=sys.argv[1]
db=sqlite3.connect(f'file:{p}?mode=ro', uri=True)
print('integrity:', db.execute('PRAGMA integrity_check').fetchone()[0])
print('size_bytes:', __import__('os').path.getsize(p))
print('trips:', db.execute('SELECT source,mode,COUNT(*) FROM trips GROUP BY source,mode ORDER BY source,mode').fetchall())
print('days:', db.execute('SELECT MIN(service_date),MAX(service_date),COUNT(DISTINCT service_date) FROM day_trips').fetchone())
q="""SELECT t.source,t.mode,COUNT(*)
FROM day_trips dt
JOIN trips t ON t.source=dt.source AND t.trip_id=dt.trip_id
WHERE dt.service_date=?
GROUP BY t.source,t.mode
ORDER BY t.source,t.mode"""
for d in ('20260906','20260907'):
    print(d + ':', db.execute(q, (d,)).fetchall())
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
ExecStart=/usr/bin/python3 $SERVER --db $DB --host 127.0.0.1 --port $PORT
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
  echo "ATTENTION: l'état/PID production a changé." >&2
  echo "AVANT:" >&2; echo "$PROD_BEFORE" >&2
  echo "APRES:" >&2; echo "$PROD_AFTER" >&2
  exit 3
fi

echo
echo "OK: reprise terminée sans rebuild. LB Rail Engine v1 écoute sur 127.0.0.1:${PORT}."
echo "Aucun nginx modifié. Aucun fichier map-v2/public modifié. Aucun redémarrage de $PROD_SERVICE."
