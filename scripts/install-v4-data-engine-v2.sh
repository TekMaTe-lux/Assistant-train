#!/usr/bin/env bash
set -Eeuo pipefail

BRANCH="${LB_V4_BRANCH:-refonte-v4-command-center}"
RAW="https://raw.githubusercontent.com/TekMaTe-lux/Assistant-train/${BRANCH}"
ENGINE_DIR="/opt/labetaillere-data-v4"
ENV_FILE="/etc/labetaillere-data-v4.env"
SERVICE_FILE="/etc/systemd/system/labetaillere-data-v4.service"
PREVIEW_ROOT="/opt/labetaillere-map-v2-src/map-v2/public"
PREVIEW_DIR="${PREVIEW_ROOT}/v4-preview"
SNAPSHOT_FILE="${PREVIEW_DIR}/data/snapshot.json"
STAMP="$(date +%Y%m%d-%H%M%S)"
TMP="$(mktemp -d /tmp/labetaillere-data-v4-v2.XXXXXX)"
cleanup(){ rm -rf "$TMP"; }
trap cleanup EXIT

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then echo "ERREUR: lancer avec sudo bash." >&2; exit 2; fi
for cmd in python3 curl runuser systemctl; do command -v "$cmd" >/dev/null || { echo "ERREUR: $cmd absent." >&2; exit 2; }; done
id ubuntu >/dev/null 2>&1 || { echo "ERREUR: utilisateur ubuntu introuvable." >&2; exit 2; }
[[ -d "$PREVIEW_ROOT" ]] || { echo "ERREUR: racine preview absente: $PREVIEW_ROOT" >&2; exit 2; }

fetch(){ curl -fL --retry 3 --connect-timeout 8 --max-time 30 "${RAW}/$1" -o "$2"; }
find_candidates(){
  local name="$1" root
  for root in /opt /var/www /srv /home/ubuntu; do
    [[ -d "$root" ]] || continue
    find "$root" -maxdepth 10 \( -type f -o -type l \) -name "$name" -printf '%T@|%p\n' 2>/dev/null || true
  done | sort -t'|' -k1,1nr
}
choose_source(){
  local name="$1" candidates preferred
  candidates="$(find_candidates "$name")"
  [[ -n "$candidates" ]] || return 1
  preferred="$(printf '%s\n' "$candidates" | awk -F'|' '$2 ~ /\/gtfs\// {print; exit}')"
  if [[ -n "$preferred" ]]; then printf '%s' "${preferred#*|}"; else printf '%s' "$(printf '%s\n' "$candidates" | head -n1 | cut -d'|' -f2-)"; fi
}

SNCF="$(choose_source retards_nancymetzlux.json || true)"
CFL="$(choose_source retards_cfl.json || true)"
ARR="$(choose_source retards_cfl_arrivals.json || true)"
SIRI="$(choose_source siri_sx_alertes.json || true)"
COMPO="$(choose_source Compotrains.json || true)"

missing=0
for pair in "SNCF:$SNCF" "CFL:$CFL" "ARRIVEES_LUX:$ARR" "SIRI:$SIRI"; do
  key="${pair%%:*}"; value="${pair#*:}"
  if [[ -z "$value" ]]; then echo "❌ source obligatoire introuvable: $key"; missing=1; fi
done
(( missing == 0 )) || { echo "ABANDON. Aucun service modifié."; exit 3; }

echo "=== SOURCES DÉTECTÉES ==="
echo "SNCF         : $SNCF"
echo "CFL/HAFAS    : $CFL"
echo "Arrivées Lux : $ARR"
echo "SIRI SX      : $SIRI"

mkdir -p "$TMP/stage"
chmod 0755 "$TMP" "$TMP/stage"
fetch "backend/data-engine-v4/server.py" "$TMP/stage/server.py"
fetch "backend/data-engine-v4/server-adapter-v2.py" "$TMP/stage/server-adapter-v2.py"
chmod 0755 "$TMP/stage/server.py" "$TMP/stage/server-adapter-v2.py"
python3 -m py_compile "$TMP/stage/server.py" "$TMP/stage/server-adapter-v2.py"
python3 "$TMP/stage/server-adapter-v2.py" --adapter-fixture-test >/dev/null
python3 "$TMP/stage/server-adapter-v2.py" --fixture-test >/dev/null

if [[ -z "$COMPO" ]]; then
  echo "ℹ️ Compotrains.json local absent : copie statique du dépôt main pour la preview."
  curl -fL --retry 3 --connect-timeout 8 --max-time 30 \
    "https://raw.githubusercontent.com/TekMaTe-lux/Assistant-train/main/Compotrains.json" \
    -o "$TMP/stage/Compotrains.json"
  COMPO_PREFLIGHT="$TMP/stage/Compotrains.json"
else
  COMPO_PREFLIGHT="$COMPO"
fi

python3 - "$SNCF" "$CFL" "$ARR" "$SIRI" "$COMPO_PREFLIGHT" <<'PY'
import json,sys
for p in sys.argv[1:]:
    with open(p,encoding='utf-8') as f: json.load(f)
    print('✅ JSON valide:',p)
PY

echo
echo "=== AUTO-TEST V2 SUR LES VRAIES DONNÉES ==="
set +e
runuser -u ubuntu -- env \
  LB_SOURCE_SNCF_RT="$SNCF" \
  LB_SOURCE_CFL_RT="$CFL" \
  LB_SOURCE_CFL_ARRIVALS="$ARR" \
  LB_SOURCE_TRAFFIC="$SIRI" \
  LB_SOURCE_COMPOSITIONS="$COMPO_PREFLIGHT" \
  python3 "$TMP/stage/server-adapter-v2.py" --self-test | tee "$TMP/self-test.json"
rc=${PIPESTATUS[0]}
set -e

if (( rc != 0 )); then
  echo
echo "=== DIAGNOSTIC STRUCTURE SNCF (lecture seule) ==="
  python3 - "$SNCF" <<'PY'
import json,sys
p=sys.argv[1]
x=json.load(open(p,encoding='utf-8'))
print('type racine:',type(x).__name__)
if isinstance(x,dict):
    print('clés racine:',list(x.keys())[:30])
    for k,v in list(x.items())[:12]:
        print(' ',k,'=>',type(v).__name__, ('len='+str(len(v)) if hasattr(v,'__len__') else ''))
elif isinstance(x,list):
    print('taille:',len(x))
    if x: print('premier élément:',type(x[0]).__name__, list(x[0].keys())[:30] if isinstance(x[0],dict) else '')
PY
  echo "❌ Auto-test V2 refusé. Aucun service V4 installé ou redémarré."
  exit 4
fi

python3 - "$TMP/self-test.json" <<'PY'
import json,sys
x=json.load(open(sys.argv[1])); m=x.get('meta',{}); n=int(m.get('trainCount',0))
if not x.get('ok') or n < 1: raise SystemExit('auto-test invalide')
print(f"✅ SNCF détecté via {m.get('sncfFormat')} : {m.get('sncfNormalizedCount',n)} circulations normalisées")
print(f"✅ Agrégation: {n} trains · CFL {m.get('cflTrainCount',0)} · arrivées Lux {m.get('arrivalTrainCount',0)} · compos {m.get('compositionCount',0)} · SIRI {m.get('trafficCount',0)}")
PY

echo
echo "=== INSTALLATION PARALLÈLE ==="
# La preview est mise à jour seulement après le préflight réussi.
curl -fsSL "${RAW}/scripts/install-v4-preview.sh" | LB_V4_BRANCH="$BRANCH" bash
install -d -m 0755 -o ubuntu -g ubuntu "$PREVIEW_DIR/data"
install -d -m 0755 -o root -g root "$ENGINE_DIR"
for f in server.py server-adapter-v2.py; do
  [[ -f "$ENGINE_DIR/$f" ]] && cp -a "$ENGINE_DIR/$f" "$ENGINE_DIR/$f.bak-$STAMP"
done
install -m 0755 -o root -g root "$TMP/stage/server.py" "$ENGINE_DIR/server.py"
install -m 0755 -o root -g root "$TMP/stage/server-adapter-v2.py" "$ENGINE_DIR/server-adapter-v2.py"
if [[ -z "$COMPO" ]]; then
  install -m 0644 -o root -g root "$TMP/stage/Compotrains.json" "$ENGINE_DIR/Compotrains.json"
  COMPO="$ENGINE_DIR/Compotrains.json"
fi

for f in "$ENV_FILE" "$SERVICE_FILE"; do [[ -f "$f" ]] && cp -a "$f" "$f.bak-$STAMP"; done
cat > "$ENV_FILE" <<EOF
LB_DATA_HOST=127.0.0.1
LB_DATA_PORT=3120
LB_SNAPSHOT_INTERVAL_SEC=15
LB_SOURCE_TIMEOUT_SEC=7
LB_SOURCE_SNCF_RT=$SNCF
LB_SOURCE_CFL_RT=$CFL
LB_SOURCE_CFL_ARRIVALS=$ARR
LB_SOURCE_TRAFFIC=$SIRI
LB_SOURCE_COMPOSITIONS=$COMPO
LB_SNAPSHOT_FILE=$SNAPSHOT_FILE
LB_STATS_BASE=http://127.0.0.1:3099
EOF
chmod 0644 "$ENV_FILE"

cat > "$SERVICE_FILE" <<'EOF'
[Unit]
Description=La Betaillere Data Engine V4 V2 (preview parallele)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=ubuntu
Group=ubuntu
WorkingDirectory=/opt/labetaillere-data-v4
EnvironmentFile=/etc/labetaillere-data-v4.env
ExecStart=/usr/bin/python3 /opt/labetaillere-data-v4/server-adapter-v2.py
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF
chmod 0644 "$SERVICE_FILE"

if ss -ltn 2>/dev/null | grep -Eq '127\.0\.0\.1:3120\b|0\.0\.0\.0:3120\b'; then
  if ! systemctl is-active --quiet labetaillere-data-v4.service 2>/dev/null; then
    echo "❌ Port 3120 déjà occupé par un autre processus. Rien n'est tué."
    exit 5
  fi
fi

systemctl daemon-reload
systemctl enable labetaillere-data-v4.service >/dev/null
systemctl restart labetaillere-data-v4.service

ok=0
for _ in $(seq 1 20); do
  if curl -fsS --max-time 2 http://127.0.0.1:3120/api/v4/health > "$TMP/health.json" 2>/dev/null; then ok=1; break; fi
  sleep 1
done
if (( ! ok )); then
  echo "❌ Démarrage V4 V2 échoué."
  systemctl --no-pager --full status labetaillere-data-v4.service || true
  journalctl -u labetaillere-data-v4.service -n 60 --no-pager || true
  echo "La production n'a pas été modifiée."
  exit 6
fi

# Attendre également l'écriture effective du snapshot consommé par site.html.
for _ in $(seq 1 10); do
  [[ -s "$SNAPSHOT_FILE" ]] && break
  sleep 1
done
python3 - "$TMP/health.json" "$SNAPSHOT_FILE" <<'PY'
import json,sys,os
h=json.load(open(sys.argv[1])); n=int(h.get('trainCount',0))
if h.get('apiVersion') != 4 or n < 1: raise SystemExit('health invalide')
if not os.path.isfile(sys.argv[2]) or os.path.getsize(sys.argv[2]) < 50: raise SystemExit('snapshot absent')
s=json.load(open(sys.argv[2],encoding='utf-8'))
if s.get('apiVersion') != 4 or not s.get('trains'): raise SystemExit('snapshot invalide')
print(f"✅ Data Engine V4 V2 opérationnel : {n} trains")
print('✅ Format SNCF :',h.get('meta',{}).get('sncfFormat'))
print('✅ Snapshot V4 :',sys.argv[2])
print('✅ Sources :', ', '.join(f"{x.get('name')}={'OK' if x.get('ok') else 'ERREUR'}" for x in h.get('sources',[])))
PY

echo
echo "==============================================="
echo "DATA ENGINE V4 V2 ACTIF EN PARALLÈLE — OK"
echo "==============================================="
echo "API locale  : http://127.0.0.1:3120/api/v4/health"
echo "Snapshot    : $SNAPSHOT_FILE"
echo "Aperçu      : https://vps.labetaillere.fr/map-v2/v4-preview/site.html"
echo "Prod        : NON MODIFIÉE"
