#!/usr/bin/env bash
set -Eeuo pipefail

BRANCH="${LB_V4_BRANCH:-refonte-v4-command-center}"
RAW="https://raw.githubusercontent.com/TekMaTe-lux/Assistant-train/${BRANCH}"
ENGINE_DIR="/opt/labetaillere-data-v4"
SERVICE_FILE="/etc/systemd/system/labetaillere-data-v4.service"
STAMP="$(date +%Y%m%d-%H%M%S)"
TMP="$(mktemp -d /tmp/labetaillere-data-v4-v3.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then echo "ERREUR: lancer avec sudo bash." >&2; exit 2; fi
for cmd in python3 curl systemctl; do command -v "$cmd" >/dev/null || { echo "ERREUR: $cmd absent." >&2; exit 2; }; done

echo "=== PRÉFLIGHT + BASE V2 ==="
curl -fsSL "${RAW}/scripts/install-v4-data-engine-v2.sh" | LB_V4_BRANCH="$BRANCH" bash

curl -fL --retry 3 --connect-timeout 8 --max-time 30 \
  "${RAW}/backend/data-engine-v4/server-adapter-v3.py" \
  -o "$TMP/server-adapter-v3.py"
chmod 0755 "$TMP/server-adapter-v3.py"
python3 -m py_compile "$TMP/server-adapter-v3.py"

cp "$ENGINE_DIR/server.py" "$TMP/server.py"
cp "$ENGINE_DIR/server-adapter-v2.py" "$TMP/server-adapter-v2.py"
python3 "$TMP/server-adapter-v3.py" --adapter-v3-fixture-test >/dev/null

[[ -f "$ENGINE_DIR/server-adapter-v3.py" ]] && cp -a "$ENGINE_DIR/server-adapter-v3.py" "$ENGINE_DIR/server-adapter-v3.py.bak-$STAMP"
install -m 0755 -o root -g root "$TMP/server-adapter-v3.py" "$ENGINE_DIR/server-adapter-v3.py"
cp -a "$SERVICE_FILE" "$SERVICE_FILE.bak-v3-$STAMP"
python3 - "$SERVICE_FILE" <<'PY'
import sys
p=sys.argv[1]
s=open(p,encoding='utf-8').read()
s=s.replace('/opt/labetaillere-data-v4/server-adapter-v2.py','/opt/labetaillere-data-v4/server-adapter-v3.py')
s=s.replace('Data Engine V4 V2 (preview parallele)','Data Engine V4 V3 (stations + map)')
open(p,'w',encoding='utf-8').write(s)
PY

systemctl daemon-reload
systemctl restart labetaillere-data-v4.service

ok=0
for _ in $(seq 1 20); do
  if curl -fsS --max-time 2 http://127.0.0.1:3120/api/v4/health >/dev/null 2>&1; then ok=1; break; fi
  sleep 1
done
(( ok == 1 )) || { systemctl --no-pager --full status labetaillere-data-v4.service || true; exit 6; }

curl -fsS http://127.0.0.1:3120/api/v4/stations > "$TMP/stations.json"
curl -fsS http://127.0.0.1:3120/api/v4/stations/Luxembourg > "$TMP/luxembourg.json"
curl -fsS http://127.0.0.1:3120/api/v4/map > "$TMP/map.json"
python3 - "$TMP/stations.json" "$TMP/luxembourg.json" "$TMP/map.json" <<'PY'
import json,sys
stations=json.load(open(sys.argv[1],encoding='utf-8'))
lux=json.load(open(sys.argv[2],encoding='utf-8'))
mp=json.load(open(sys.argv[3],encoding='utf-8'))
assert stations.get('apiVersion')==4 and isinstance(stations.get('stations'),list)
assert lux.get('apiVersion')==4 and isinstance(lux.get('trains'),list)
assert mp.get('apiVersion')==4 and isinstance(mp.get('trains'),list)
print(f"✅ V4 V3: {len(stations['stations'])} gares · Luxembourg {len(lux['trains'])} trains · map {len(mp['trains'])} trains")
PY

echo "✅ Service: labetaillere-data-v4.service"
echo "✅ Local API: http://127.0.0.1:3120/api/v4/"
echo "ℹ️ Ce script n'expose pas Nginx publiquement : aucune modification de vhost n'est faite sans inspection préalable."
