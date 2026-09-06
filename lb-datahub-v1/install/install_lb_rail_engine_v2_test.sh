#!/usr/bin/env bash
set -euo pipefail

ROOT="/opt/labetaillere-map-v2-src"
ENGINE="/opt/lb-rail-engine-v1"
V2_DB="$ENGINE/data/timetable-v2.sqlite"
SERVICE="lb-rail-engine-v2-test.service"
PORT="${LB_RAIL_ENGINE_V2_PORT:-3122}"
V1_PORT="3121"
PROD_SERVICE="labetaillere-map-v2.service"
V1_SERVICE="lb-rail-engine-v1.service"

need() { command -v "$1" >/dev/null 2>&1 || { echo "ERREUR: commande absente: $1" >&2; exit 2; }; }
need python3; need git; need curl; need systemctl; need ss

if [[ ! -d "$ROOT/.git" ]]; then
  echo "ERREUR: dépôt introuvable: $ROOT" >&2
  exit 2
fi
if [[ ! -f "$V2_DB" ]]; then
  echo "ERREUR: base V2 absente: $V2_DB" >&2
  exit 2
fi
if ! curl -fsS --max-time 3 "http://127.0.0.1:${V1_PORT}/status" >/dev/null; then
  echo "ERREUR: moteur V1 de référence indisponible sur ${V1_PORT}. Rien n'est modifié." >&2
  exit 2
fi

# If this exact test service already owns the port, stop it before refreshing.
if systemctl is-active --quiet "$SERVICE" 2>/dev/null; then
  sudo systemctl stop "$SERVICE"
fi
if ss -ltnH | awk '{print $4}' | grep -Eq "(^|:)${PORT}$"; then
  echo "ERREUR: port ${PORT} déjà utilisé par autre chose. Rien n'est modifié." >&2
  exit 2
fi

PROD_BEFORE="$(systemctl show "$PROD_SERVICE" -p ActiveState -p SubState -p MainPID 2>/dev/null || true)"
V1_BEFORE="$(systemctl show "$V1_SERVICE" -p ActiveState -p SubState -p MainPID 2>/dev/null || true)"
echo "=== SERVICES AVANT ==="
echo "PROD:"; echo "$PROD_BEFORE"
echo "V1  :"; echo "$V1_BEFORE"

echo "=== VALIDATION SQLITE V2 ==="
python3 - "$V2_DB" <<'PY'
import sqlite3,sys
p=sys.argv[1]
db=sqlite3.connect(f"file:{p}?mode=ro",uri=True)
print("integrity:",db.execute("PRAGMA integrity_check").fetchone()[0])
print("schema:",dict(db.execute("SELECT key,value FROM meta")).get("schema_version"))
print("trips:",db.execute("SELECT source,mode,COUNT(*) FROM trips GROUP BY source,mode ORDER BY source,mode").fetchall())
PY

echo "=== INSTALL SERVER V2 ISOLE ==="
cd "$ROOT"
git fetch origin main
git show origin/main:lb-datahub-v1/engine/server_v2.py > /tmp/lb_rail_server_v2.py
python3 -m py_compile /tmp/lb_rail_server_v2.py
sudo install -o ubuntu -g ubuntu -m 0755 /tmp/lb_rail_server_v2.py "$ENGINE/app/server_v2.py"

cat > /tmp/$SERVICE <<EOF
[Unit]
Description=La Betaillere Rail Engine v2 test (isolated localhost)
After=network.target

[Service]
Type=simple
User=ubuntu
Group=ubuntu
WorkingDirectory=$ENGINE
ExecStart=/usr/bin/python3 $ENGINE/app/server_v2.py --db $V2_DB --host 127.0.0.1 --port $PORT
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true

[Install]
WantedBy=multi-user.target
EOF
sudo install -m 0644 /tmp/$SERVICE /etc/systemd/system/$SERVICE
sudo systemctl daemon-reload
sudo systemctl enable --now "$SERVICE"
sleep 1

echo "=== HEALTH V2 ==="
systemctl --no-pager --full status "$SERVICE" | sed -n '1,16p'
echo
curl -fsS "http://127.0.0.1:${PORT}/status" | python3 -m json.tool

echo "=== PARITE HTTP V1 (3121) / V2 (${PORT}) ==="
python3 - "$V1_PORT" "$PORT" <<'PY'
import json,sys,urllib.request
p1,p2=sys.argv[1],sys.argv[2]

def get(port,path):
    with urllib.request.urlopen(f"http://127.0.0.1:{port}{path}",timeout=30) as r:
        return json.load(r)

def check(path):
    a=get(p1,path); b=get(p2,path)
    if a!=b:
        print("ERREUR PARITE:",path)
        # compact first useful difference
        if isinstance(a,dict) and isinstance(b,dict):
            for k in sorted(set(a)|set(b)):
                if a.get(k)!=b.get(k):
                    print(" clé:",k)
                    va=a.get(k); vb=b.get(k)
                    print(" V1:",repr(va)[:1000])
                    print(" V2:",repr(vb)[:1000])
                    break
        raise SystemExit(10)
    print("OK",path)

paths=[
    "/day/2026-09-06",
    "/day/2026-09-07",
    "/day/2026-09-06?full=1&limit=20000",
    "/day/2026-09-07?full=1&limit=20000",
    "/day/2026-09-07?source=FR&mode=rail&number=88501&full=1",
    "/train/88501?date=2026-09-06",
    "/train/88501?date=2026-09-07",
]
for p in paths:
    check(p)
print("PARITE HTTP CRITIQUE OK")
PY

echo "=== SERVICES APRES ==="
PROD_AFTER="$(systemctl show "$PROD_SERVICE" -p ActiveState -p SubState -p MainPID 2>/dev/null || true)"
V1_AFTER="$(systemctl show "$V1_SERVICE" -p ActiveState -p SubState -p MainPID 2>/dev/null || true)"
echo "PROD:"; echo "$PROD_AFTER"
echo "V1  :"; echo "$V1_AFTER"

if [[ "$PROD_BEFORE" != "$PROD_AFTER" ]]; then
  echo "ERREUR: service production modifié pendant le test." >&2
  exit 20
fi
if [[ "$V1_BEFORE" != "$V1_AFTER" ]]; then
  echo "ERREUR: moteur V1 de référence modifié pendant le test." >&2
  exit 21
fi

echo
echo "OK: V2 test actif sur 127.0.0.1:${PORT}, V1 intact sur 127.0.0.1:${V1_PORT}, production intacte."
echo "Aucun nginx modifié. Aucun fichier map-v2/public modifié."
