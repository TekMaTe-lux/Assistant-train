#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="/opt/lb-rail-engine-v1"
APP="$ROOT/app"
STATE="$ROOT/state"
BACKUPS="$ROOT/data/backups"
DB="$ROOT/data/timetable-v3-france-preview.sqlite"
TAG="$(date +%Y%m%d-%H%M%S)"
INSTALL_BAK="$BACKUPS/install-global-hs-v7_2-lowmem-$TAG"
REPO_RAW="https://raw.githubusercontent.com/TekMaTe-lux/Assistant-train/main/vps/map-v2"
ROUTER="$APP/moorail_router_global_v7.py"
ENGINE="$APP/moorail_global_hs_v7.py"
DROPIN_DIR="/etc/systemd/system/lb-rail-v3-gtfs-update.service.d"
DROPIN="$DROPIN_DIR/95-global-hs-v7.conf"
OLD_OUEST="$DROPIN_DIR/90-lgv-ouest-v1.conf"
TMP="$(mktemp -d /tmp/moorail-global-v7_2.XXXXXX)"
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
echo " MOO RAIL — GLOBAL HIGH-SPEED V7.2 LOWMEM UPSERT"
echo " Même logique nationale/internationale + RAM stable + création des trip_geometry manquants"
echo "========================================================================================================================"

echo "0/8 Diagnostic de l'échec V7.1…"
echo "Mémoire :"
free -h || true
echo
echo "Variantes sans trip_geometry parmi les numéros vus dans l'erreur :"
python3 - "$DB" <<'PY' || true
import sqlite3,sys
p=sys.argv[1]
db=sqlite3.connect(f'file:{p}?mode=ro',uri=True)
for n in ('5466','5475','9203','9206','8602','9713','6702','9264'):
    total=db.execute('SELECT COUNT(*) FROM trips WHERE number=?',(n,)).fetchone()[0]
    missing=db.execute('''
        SELECT COUNT(*) FROM trips t
        LEFT JOIN trip_geometry g ON g.trip_pk=t.trip_pk
        WHERE t.number=? AND g.trip_pk IS NULL
    ''',(n,)).fetchone()[0]
    print(f'  {n:>5} : variantes={total:>3} | sans trip_geometry={missing:>3}')
db.close()
PY

echo
echo "1/8 Téléchargement de la V7 propre + patch V7.2 LOWMEM/UPSERT…"
curl -fsSL "$REPO_RAW/moorail-global-hs-v7.py?$TAG" -o "$BASE_ENGINE"
curl -fsSL "$REPO_RAW/moorail-router-global-v7.py?$TAG" -o "$BASE_ROUTER"
curl -fsSL "$REPO_RAW/patch-moorail-global-hs-v7-lowmem-v7_1.py?$TAG" -o "$PATCHER"
python3 -m py_compile "$BASE_ENGINE" "$BASE_ROUTER" "$PATCHER"
python3 "$PATCHER" "$BASE_ENGINE"
python3 -m py_compile "$BASE_ENGINE"
grep -qF 'MOORAIL_GLOBAL_HS_V7_2_LOWMEM_UPSERT' "$BASE_ENGINE"
grep -qF 'GRAPH_CACHE_MAX_ITEMS = 32' "$BASE_ENGINE"
grep -qF 'pattern_cache = NoRetentionCache()' "$BASE_ENGINE"
grep -qF 'INSERT INTO trip_geometry' "$BASE_ENGINE"

echo "2/8 Sauvegarde de l'installation actuelle…"
[[ -f "$ROUTER" ]] && cp -a "$ROUTER" "$INSTALL_BAK/moorail_router_global_v7.py.previous"
[[ -f "$ENGINE" ]] && cp -a "$ENGINE" "$INSTALL_BAK/moorail_global_hs_v7.py.previous"
[[ -f "$DROPIN" ]] && cp -a "$DROPIN" "$INSTALL_BAK/95-global-hs-v7.conf.previous"
[[ -f "$OLD_OUEST" ]] && cp -a "$OLD_OUEST" "$INSTALL_BAK/90-lgv-ouest-v1.conf.previous"

install -m 0644 "$BASE_ROUTER" "$ROUTER"
install -m 0755 "$BASE_ENGINE" "$ENGINE"
python3 -m py_compile "$ROUTER" "$ENGINE"

echo "3/8 Nettoyage des candidats morts V7/V7.1…"
# Ces répertoires sont des copies candidates jamais swapées si le garde final échoue.
find "$ROOT/tmp" -maxdepth 1 -type d -name 'global-hs-v7-*' -mmin +1 -print -exec rm -rf {} + 2>/dev/null || true

echo "4/8 Calcul + publication sécurisée V7.2…"
set +e
python3 -u "$ENGINE" --apply
RC=$?
set -e
if [[ "$RC" -ne 0 ]]; then
  echo
echo "ERREUR V7.2 : retour $RC"
  echo "Mémoire après échec :"
  free -h || true
  echo "Noyau :"
  journalctl -k --since '-20 min' --no-pager 2>/dev/null | grep -Ei 'out of memory|oom-kill|killed process|memory cgroup' | tail -30 || true
  echo "Aucun hook GTFS V7.2 n'est installé tant que la publication n'a pas réussi."
  exit "$RC"
fi

echo "5/8 Installation du hook persistant après GTFS…"
if systemctl cat lb-rail-v3-gtfs-update.service >/dev/null 2>&1; then
  mkdir -p "$DROPIN_DIR"
  rm -f "$OLD_OUEST"
  cat > "$DROPIN" <<EOF
[Service]
# MooRail GLOBAL HIGH-SPEED V7.2 LOWMEM UPSERT : toutes variantes HGV + international.
ExecStartPost=-/usr/bin/python3 $ENGINE --apply --post-update
EOF
  systemctl daemon-reload
else
  echo "ATTENTION : lb-rail-v3-gtfs-update.service absent ; correction active OK mais hook quotidien non installé."
fi

echo "6/8 Contrôles couverture trip_geometry…"
python3 - "$DB" <<'PY'
import sqlite3,sys
p=sys.argv[1]
db=sqlite3.connect(f'file:{p}?mode=ro',uri=True)
for n in ('5466','5475','9203','9206','8602','9713','6702','9264'):
    total=db.execute('SELECT COUNT(*) FROM trips WHERE number=?',(n,)).fetchone()[0]
    missing=db.execute('''
        SELECT COUNT(*) FROM trips t
        LEFT JOIN trip_geometry g ON g.trip_pk=t.trip_pk
        WHERE t.number=? AND g.trip_pk IS NULL
    ''',(n,)).fetchone()[0]
    print(f'  {n:>5} : variantes={total:>3} | sans trip_geometry={missing:>3}')
    if total and missing:
        raise SystemExit(f'ERREUR: {n} garde {missing} variante(s) sans trip_geometry')
print('Couverture témoins : OK')
db.close()
PY

echo "7/8 Contrôles santé…"
cat "$STATE/moorail-global-hs-v7-health.json" 2>/dev/null || true
systemctl is-active lb-rail-v3-france-hot-snapshot-preview || true
systemctl show lb-rail-v3-gtfs-update.service -p ExecStartPost --no-pager 2>/dev/null || true

echo "8/8 Mémoire finale…"
free -h || true

echo
echo "========================================================================================================================"
echo " FIN OK — GLOBAL HIGH-SPEED V7.2 LOWMEM UPSERT"
echo " Backup : $INSTALL_BAK"
echo " Engine : $ENGINE"
echo " Router : $ROUTER"
echo " HTML   : INCHANGÉ"
echo "========================================================================================================================"
