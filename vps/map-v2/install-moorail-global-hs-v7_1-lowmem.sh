#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="/opt/lb-rail-engine-v1"
APP="$ROOT/app"
STATE="$ROOT/state"
BACKUPS="$ROOT/data/backups"
DB="$ROOT/data/timetable-v3-france-preview.sqlite"
TAG="$(date +%Y%m%d-%H%M%S)"
INSTALL_BAK="$BACKUPS/install-global-hs-v7_3-$TAG"
REPO_RAW="https://raw.githubusercontent.com/TekMaTe-lux/Assistant-train/main/vps/map-v2"
ROUTER="$APP/moorail_router_global_v7.py"
ENGINE="$APP/moorail_global_hs_v7.py"
HOT_UNIT="lb-rail-v3-france-hot-snapshot-preview"
HOT_SCRIPT="$APP/hot_snapshot_v3_france_preview.py"
DROPIN_DIR="/etc/systemd/system/lb-rail-v3-gtfs-update.service.d"
DROPIN="$DROPIN_DIR/95-global-hs-v7.conf"
OLD_OUEST="$DROPIN_DIR/90-lgv-ouest-v1.conf"
TMP="$(mktemp -d /tmp/moorail-global-v7_3.XXXXXX)"
BASE_ENGINE="$TMP/moorail-global-hs-v7.py"
BASE_ROUTER="$TMP/moorail-router-global-v7.py"
PATCHER="$TMP/patch-lowmem.py"

cleanup(){ rm -rf "$TMP"; }
trap cleanup EXIT

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "ERREUR : lance cet installateur avec sudo." >&2
  exit 2
fi

mkdir -p "$APP" "$STATE" "$BACKUPS" "$INSTALL_BAK"

echo "========================================================================================================================"
echo " MOO RAIL — GLOBAL HIGH-SPEED V7.3"
echo " LOWMEM + UPSERT + gestion correcte du snapshot France TRANSIENT"
echo "========================================================================================================================"

echo "0/9 Diagnostic + remise en route immédiate du snapshot France…"
echo "Mémoire :"
free -h || true
FRAG="$(systemctl show "$HOT_UNIT.service" -p FragmentPath --value 2>/dev/null || true)"
LOAD="$(systemctl show "$HOT_UNIT.service" -p LoadState --value 2>/dev/null || true)"
ACTIVE="$(systemctl is-active "$HOT_UNIT.service" 2>/dev/null || true)"
echo "Snapshot : load=${LOAD:-?} active=${ACTIVE:-?} fragment=${FRAG:-<absent>}"
if [[ "$FRAG" == /run/systemd/transient/* ]]; then
  echo "CONFIRMÉ : $HOT_UNIT est une unité systemd TRANSIENTE."
  echo "C'est pour cela que 'systemctl start' a retourné 5 après son arrêt."
fi
if ! systemctl is-active --quiet "$HOT_UNIT.service"; then
  if [[ -n "$FRAG" && "$FRAG" != /run/systemd/transient/* ]]; then
    systemctl start "$HOT_UNIT.service"
  else
    [[ -f "$HOT_SCRIPT" ]] || { echo "ERREUR worker France absent: $HOT_SCRIPT" >&2; exit 2; }
    systemd-run \
      --unit="$HOT_UNIT" \
      --description="La Betaillere France V3 Hot Snapshot Preview" \
      --property=Restart=always \
      --property=RestartSec=1s \
      --property=MemoryMax=768M \
      /usr/bin/python3 "$HOT_SCRIPT"
  fi
  sleep 2
fi
systemctl is-active --quiet "$HOT_UNIT.service" || { echo "ERREUR: snapshot France impossible à remettre en route" >&2; exit 3; }
echo "Snapshot France : ACTIF"

echo
echo "Variantes qui étaient sans trip_geometry avant V7.2 :"
python3 - "$DB" <<'PY' || true
import sqlite3,sys
db=sqlite3.connect(f'file:{sys.argv[1]}?mode=ro',uri=True)
for n in ('5466','5475','9203','9206','8602','9713','6702','9264'):
    total=db.execute('SELECT COUNT(*) FROM trips WHERE number=?',(n,)).fetchone()[0]
    missing=db.execute('''SELECT COUNT(*) FROM trips t LEFT JOIN trip_geometry g ON g.trip_pk=t.trip_pk WHERE t.number=? AND g.trip_pk IS NULL''',(n,)).fetchone()[0]
    print(f'  {n:>5} : variantes={total:>3} | sans trip_geometry={missing:>3}')
db.close()
PY

echo "1/9 Téléchargement de la V7 propre + patch V7.3…"
curl -fsSL "$REPO_RAW/moorail-global-hs-v7.py?$TAG" -o "$BASE_ENGINE"
curl -fsSL "$REPO_RAW/moorail-router-global-v7.py?$TAG" -o "$BASE_ROUTER"
curl -fsSL "$REPO_RAW/patch-moorail-global-hs-v7-lowmem-v7_1.py?$TAG" -o "$PATCHER"
python3 -m py_compile "$BASE_ENGINE" "$BASE_ROUTER" "$PATCHER"
python3 "$PATCHER" "$BASE_ENGINE"
python3 -m py_compile "$BASE_ENGINE"
grep -qF 'MOORAIL_GLOBAL_HS_V7_3_TRANSIENT_SNAPSHOT' "$BASE_ENGINE"
grep -qF 'GRAPH_CACHE_MAX_ITEMS = 32' "$BASE_ENGINE"
grep -qF 'pattern_cache = NoRetentionCache()' "$BASE_ENGINE"
grep -qF 'INSERT INTO trip_geometry' "$BASE_ENGINE"
grep -qF 'systemd-run' "$BASE_ENGINE"

echo "2/9 Sauvegarde de l'installation actuelle…"
[[ -f "$ROUTER" ]] && cp -a "$ROUTER" "$INSTALL_BAK/moorail_router_global_v7.py.previous"
[[ -f "$ENGINE" ]] && cp -a "$ENGINE" "$INSTALL_BAK/moorail_global_hs_v7.py.previous"
[[ -f "$DROPIN" ]] && cp -a "$DROPIN" "$INSTALL_BAK/95-global-hs-v7.conf.previous"
[[ -f "$OLD_OUEST" ]] && cp -a "$OLD_OUEST" "$INSTALL_BAK/90-lgv-ouest-v1.conf.previous"
install -m 0644 "$BASE_ROUTER" "$ROUTER"
install -m 0755 "$BASE_ENGINE" "$ENGINE"
python3 -m py_compile "$ROUTER" "$ENGINE"

echo "3/9 Nettoyage des candidats morts précédents…"
find "$ROOT/tmp" -maxdepth 1 -type d -name 'global-hs-v7-*' -mmin +1 -print -exec rm -rf {} + 2>/dev/null || true

echo "4/9 Calcul + publication sécurisée V7.3…"
set +e
python3 -u "$ENGINE" --apply
RC=$?
set -e
if [[ "$RC" -ne 0 ]]; then
  echo
echo "ERREUR V7.3 : retour $RC"
  free -h || true
  echo "Etat snapshot après rollback :"
  systemctl status "$HOT_UNIT.service" --no-pager -l 2>/dev/null | sed -n '1,16p' || true
  echo "Aucun hook GTFS V7.3 n'est installé tant que la publication n'a pas réussi."
  exit "$RC"
fi

echo "5/9 Installation du hook persistant après GTFS…"
if systemctl cat lb-rail-v3-gtfs-update.service >/dev/null 2>&1; then
  mkdir -p "$DROPIN_DIR"
  rm -f "$OLD_OUEST"
  cat > "$DROPIN" <<EOF
[Service]
# MooRail GLOBAL HIGH-SPEED V7.3 : LOWMEM + UPSERT + recréation du worker France transient.
ExecStartPost=-/usr/bin/python3 $ENGINE --apply --post-update
EOF
  systemctl daemon-reload
else
  echo "ATTENTION : lb-rail-v3-gtfs-update.service absent ; correction active OK mais hook quotidien non installé."
fi

echo "6/9 Contrôles couverture trip_geometry…"
python3 - "$DB" <<'PY'
import sqlite3,sys
db=sqlite3.connect(f'file:{sys.argv[1]}?mode=ro',uri=True)
for n in ('5466','5475','9203','9206','8602','9713','6702','9264'):
    total=db.execute('SELECT COUNT(*) FROM trips WHERE number=?',(n,)).fetchone()[0]
    missing=db.execute('''SELECT COUNT(*) FROM trips t LEFT JOIN trip_geometry g ON g.trip_pk=t.trip_pk WHERE t.number=? AND g.trip_pk IS NULL''',(n,)).fetchone()[0]
    globalp=db.execute('''SELECT COUNT(*) FROM trips t JOIN trip_geometry g ON g.trip_pk=t.trip_pk WHERE t.number=? AND g.path_id LIKE 'p-global-hs-v7-%' ''',(n,)).fetchone()[0]
    print(f'  {n:>5} : variantes={total:>3} | sans trip_geometry={missing:>3} | global={globalp:>3}')
    if total and (missing or globalp != total): raise SystemExit(f'ERREUR couverture {n}')
print('Couverture témoins : OK')
db.close()
PY

echo "7/9 Contrôles snapshot…"
systemctl is-active "$HOT_UNIT.service"
python3 - <<'PY'
import json
from pathlib import Path
p=Path('/opt/labetaillere-map-v2-src/map-v2/public/data/france-v3-active-now.json')
d=json.loads(p.read_text(encoding='utf-8'))
print({'ok':d.get('ok'),'count':d.get('count') or len(d.get('trains') or []),'generatedAt':d.get('generatedAt') or d.get('generated_at'),'size':p.stat().st_size})
assert d.get('ok') is True
PY

echo "8/9 Contrôles santé/hook…"
cat "$STATE/moorail-global-hs-v7-health.json" 2>/dev/null || true
systemctl show lb-rail-v3-gtfs-update.service -p ExecStartPost --no-pager 2>/dev/null || true

echo "9/9 Mémoire finale…"
free -h || true

echo
echo "========================================================================================================================"
echo " FIN OK — GLOBAL HIGH-SPEED V7.3"
echo " Backup : $INSTALL_BAK"
echo " Engine : $ENGINE"
echo " Router : $ROUTER"
echo " HTML   : INCHANGÉ"
echo "========================================================================================================================"
