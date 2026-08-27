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
TMP="$(mktemp -d /tmp/labetaillere-data-v4-install.XXXXXX)"
cleanup(){ rm -rf "$TMP"; }
trap cleanup EXIT

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then echo "ERREUR: lancer avec sudo bash." >&2; exit 2; fi
command -v python3 >/dev/null || { echo "ERREUR: python3 absent." >&2; exit 2; }
command -v curl >/dev/null || { echo "ERREUR: curl absent." >&2; exit 2; }
id ubuntu >/dev/null 2>&1 || { echo "ERREUR: utilisateur ubuntu introuvable." >&2; exit 2; }
[[ -d "$PREVIEW_ROOT" ]] || { echo "ERREUR: $PREVIEW_ROOT introuvable." >&2; exit 2; }

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

show_candidates(){
  local name="$1"
  echo "--- candidats $name ---"
  find_candidates "$name" | head -n 6 | sed 's/^[^|]*|/  /' || true
}

SNFC="$(choose_source retards_nancymetzlux.json || true)"
CFL="$(choose_source retards_cfl.json || true)"
ARR="$(choose_source retards_cfl_arrivals.json || true)"
SIRI="$(choose_source siri_sx_alertes.json || true)"
COMPO="$(choose_source Compotrains.json || true)"

missing=0
for pair in "SNCF:$SNFC" "CFL:$CFL" "ARRIVEES_LUX:$ARR" "SIRI:$SIRI"; do
  key="${pair%%:*}"; value="${pair#*:}"
  if [[ -z "$value" ]]; then echo "❌ source obligatoire introuvable: $key"; missing=1; fi
done
if (( missing )); then
  echo
  show_candidates retards_nancymetzlux.json
  show_candidates retards_cfl.json
  show_candidates retards_cfl_arrivals.json
  show_candidates siri_sx_alertes.json
  echo "ABANDON AVANT TOUTE MODIFICATION DE SERVICE."
  exit 3
fi

mkdir -p "$TMP/stage"
chmod 0755 "$TMP" "$TMP/stage"
fetch "backend/data-engine-v4/server.py" "$TMP/stage/server.py"
chmod 0755 "$TMP/stage/server.py"
python3 -m py_compile "$TMP/stage/server.py"
python3 "$TMP/stage/server.py" --fixture-test >/dev/null

if [[ -z "$COMPO" ]]; then
  echo "ℹ️ Compotrains.json local absent : copie statique depuis le dépôt main pour la preview."
  curl -fL --retry 3 --connect-timeout 8 --max-time 30 \
    "https://raw.githubusercontent.com/TekMaTe-lux/Assistant-train/main/Compotrains.json" -o "$TMP/stage/Compotrains.json"
  COMPO_PREFLIGHT="$TMP/stage/Compotrains.json"
else
  COMPO_PREFLIGHT="$COMPO"
fi

python3 - "$SNFC" "$CFL" "$ARR" "$SIRI" "$COMPO_PREFLIGHT" <<'PY'
import json,sys
for p in sys.argv[1:]:
    with open(p,encoding='utf-8') as f: json.load(f)
    print('✅ JSON valide:',p)
PY

echo
echo "=== AUTO-TEST SUR LES VRAIES DONNÉES ==="
set +e
runuser -u ubuntu -- env \
  LB_SOURCE_SNCF_RT="$SNFC" \
  LB_SOURCE_CFL_RT="$CFL" \
  LB_SOURCE_CFL_ARRIVALS="$ARR" \
  LB_SOURCE_TRAFFIC="$SIRI" \
  LB_SOURCE_COMPOSITIONS="$COMPO_PREFLIGHT" \
  python3 "$TMP/stage/server.py" --self-test | tee "$TMP/self-test.json"
rc=${PIPESTATUS[0]}
set -e
if (( rc != 0 )); then
  echo "❌ Auto-test V4 refusé. Aucun service V4 n'a été installé ou redémarré."
  exit 4
fi
python3 - "$TMP/self-test.json" <<'PY'
import json,sys
x=json.load(open(sys.argv[1])); n=int(x.get('meta',{}).get('trainCount',0))
if not x.get('ok') or n < 1: raise SystemExit('auto-test invalide ou 0 train')
print(f'✅ Auto-test réel: {n} trains normalisés')
print('   CFL:',x.get('meta',{}).get('cflTrainCount',0),'trains · arrivées Lux:',x.get('meta',{}).get('arrivalTrainCount',0),'· compos:',x.get('meta',{}).get('compositionCount',0))
PY

echo
echo "=== MISE À JOUR DE LA PREVIEW V4 ==="
curl -fsSL "${RAW}/scripts/install-v4-preview.sh" | LB_V4_BRANCH="$BRANCH" bash
install -d -m 0755 -o ubuntu -g ubuntu "$PREVIEW_DIR/data"

install -d -m 0755 -o root -g root "$ENGINE_DIR"
if [[ -f "$ENGINE_DIR/server.py" ]]; then cp -a "$ENGINE_DIR/server.py" "$ENGINE_DIR/server.py.bak-$STAMP"; fi
install -m 0755 -o root -g root "$TMP/stage/server.py" "$ENGINE_DIR/server.py"
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
LB_SOURCE_SNCF_RT=$SNFC
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
Description=La Betaillere Data Engine V4 (preview parallele)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=ubuntu
Group=ubuntu
WorkingDirectory=/opt/labetaillere-data-v4
EnvironmentFile=/etc/labetaillere-data-v4.env
ExecStart=/usr/bin/python3 /opt/labetaillere-data-v4/server.py
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
    echo "❌ Le port 3120 est déjà occupé par un autre processus. Aucun processus n'a été tué."
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
  echo "❌ Le moteur V4 n'a pas passé son contrôle de démarrage."
  systemctl --no-pager --full status labetaillere-data-v4.service || true
  journalctl -u labetaillere-data-v4.service -n 50 --no-pager || true
  echo "La production n'a pas été modifiée."
  exit 6
fi

python3 - "$TMP/health.json" "$SNAPSHOT_FILE" <<'PY'
import json,sys,os
h=json.load(open(sys.argv[1])); n=int(h.get('trainCount',0))
if h.get('apiVersion') != 4 or n < 1: raise SystemExit('health V4 invalide')
if not os.path.isfile(sys.argv[2]) or os.path.getsize(sys.argv[2]) < 20: raise SystemExit('snapshot V4 absent')
s=json.load(open(sys.argv[2]));
if s.get('apiVersion') != 4 or not s.get('trains'): raise SystemExit('snapshot V4 invalide')
print(f'✅ Data Engine V4 opérationnel : {n} trains')
print('✅ Snapshot public V4 :',sys.argv[2])
print('✅ Sources :', ', '.join(f"{x.get('name')}={'OK' if x.get('ok') else 'ERREUR'}" for x in h.get('sources',[])))
PY

echo
echo "==============================================="
echo "DATA ENGINE V4 ACTIF EN PARALLÈLE — OK"
echo "==============================================="
echo "SNCF          : $SNFC"
echo "CFL / HAFAS   : $CFL"
echo "Arrivées Lux  : $ARR"
echo "SIRI SX       : $SIRI"
echo "Compositions  : $COMPO"
echo "API locale    : http://127.0.0.1:3120/api/v4/health"
echo "Snapshot V4   : $SNAPSHOT_FILE"
echo "Aperçu        : https://vps.labetaillere.fr/map-v2/v4-preview/site.html"
echo
echo "AUCUN nginx, index public, GTFS générateur, carte ou service métier existant n'a été modifié."
