#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="/opt/lb-rail-engine-v1"
APP="$ROOT/app"
GUARD="$APP/moorail_lgv_candidate_guard_v1.py"
GTFS_UNIT="lb-rail-v3-gtfs-update.service"
GLOBAL_GUARD_TIMER="lb-rail-lgv-global-guard.timer"
DROPIN_DIR="/etc/systemd/system/lb-rail-v3-gtfs-update.service.d"
DROPIN="$DROPIN_DIR/95-global-hs-v7.conf"
ENGINE="$APP/moorail_global_hs_v7.py"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$ROOT/data/backups/gtfs-guard-v73-$STAMP"

[[ ${EUID:-$(id -u)} -eq 0 ]] || { echo "ERREUR: lancer avec sudo/root" >&2; exit 2; }
[[ -f "$GUARD" ]] || { echo "ERREUR: guard absent: $GUARD" >&2; exit 2; }
[[ -f "$ENGINE" ]] || { echo "ERREUR: moteur global HGV absent: $ENGINE" >&2; exit 2; }
grep -qF 'MOORAIL_GLOBAL_HS_V7_3_TRANSIENT_SNAPSHOT' "$ENGINE" || {
  echo "ERREUR: le moteur installé n'est pas la V7.3 attendue" >&2
  exit 3
}

mkdir -p "$BACKUP" "$DROPIN_DIR"
cp -a "$GUARD" "$BACKUP/moorail_lgv_candidate_guard_v1.py.before"
[[ -f "$DROPIN" ]] && cp -a "$DROPIN" "$BACKUP/95-global-hs-v7.conf.before"
systemctl cat "$GTFS_UNIT" > "$BACKUP/lb-rail-v3-gtfs-update.service.txt" 2>/dev/null || true

echo "===================================================================================================="
echo " MOO RAIL — GTFS GUARD COMPAT V7.3"
echo " Le vieux guard reste STRUCTUREL, mais ne bloque plus les écarts de tracé que V7.3 répare ensuite."
echo "===================================================================================================="

echo "[1/7] Patch chirurgical du legacy candidate guard…"
python3 - "$GUARD" <<'PY'
from pathlib import Path
import sys

p=Path(sys.argv[1])
s=p.read_text(encoding='utf-8')
marker='GLOBAL_HS_V73_POST_REPAIR_COMPAT = True'
if marker in s:
    print('Patch déjà présent')
    raise SystemExit(0)

anchor='GLOBAL_DELTA_PCT=5.0\n'
if anchor not in s:
    raise SystemExit('ANCRE GLOBAL_DELTA_PCT absente')
s=s.replace(anchor, anchor+'\n# V7.3 répare les géométries HGV APRÈS la construction GTFS.\n# Les écarts de corridor du builder de base sont donc informatifs ici;\n# corruption payload/offset/missing geometry reste bloquante.\nGLOBAL_HS_V73_POST_REPAIR_COMPAT = True\n',1)

old='''    for sig,ov,nv,delta,pct in regressions[:30]:\n        critical.append(\n            f"corridor partagé régressé : "\n            f"{ov/1000:.3f}->{nv/1000:.3f} km "\n            f"delta={delta/1000:.3f} km ({pct:.2f}%) "\n            f"signature={sig[:8]}"\n        )\n'''
new='''    for sig,ov,nv,delta,pct in regressions[:30]:\n        msg=(\n            f"corridor partagé régressé avant post-réparation V7.3 : "\n            f"{ov/1000:.3f}->{nv/1000:.3f} km "\n            f"delta={delta/1000:.3f} km ({pct:.2f}%) "\n            f"signature={sig[:8]}"\n        )\n        if GLOBAL_HS_V73_POST_REPAIR_COMPAT:\n            warnings.append(msg)\n        else:\n            critical.append(msg)\n'''
if old not in s:
    raise SystemExit('BLOC regressions globales attendu introuvable; aucune modification appliquée')
s=s.replace(old,new,1)
p.write_text(s,encoding='utf-8')
print('PATCH OK:',p)
PY
python3 -m py_compile "$GUARD"
grep -qF 'GLOBAL_HS_V73_POST_REPAIR_COMPAT = True' "$GUARD"

echo "[2/7] ExecStartPost V7.3 rendu bloquant en cas d'échec…"
cat > "$DROPIN" <<EOF
[Service]
# MooRail GLOBAL HIGH-SPEED V7.3 : LOWMEM + UPSERT + worker France transient.
# Reset de la liste, puis post-réparation NON ignorée : un échec doit rendre le service rouge.
ExecStartPost=
ExecStartPost=/usr/bin/python3 $ENGINE --apply --post-update
EOF
systemctl daemon-reload

echo "[3/7] Contrôles avant test…"
python3 -m py_compile "$ENGINE" "$GUARD"
systemctl show "$GTFS_UNIT" -p ExecStart -p ExecStartPost --no-pager
systemctl is-active lb-rail-v3-france-hot-snapshot-preview.service >/dev/null

if systemctl is-active --quiet "$GTFS_UNIT"; then
  echo "ERREUR: une mise à jour GTFS tourne déjà; je refuse d'en lancer une seconde." >&2
  exit 4
fi

echo "[4/7] Reset de l'ancien état FAILED…"
systemctl reset-failed "$GTFS_UNIT" || true

echo "[5/7] TEST REEL de la chaîne GTFS + post-réparation V7.3…"
echo "      Cela peut prendre plusieurs minutes. Ne pas interrompre."
set +e
systemctl start "$GTFS_UNIT"
RC=$?
set -e
if [[ $RC -ne 0 ]]; then
  echo
  echo "ECHEC TEST GTFS : rc=$RC"
  systemctl status "$GTFS_UNIT" --no-pager -l | tail -70 || true
  echo
  echo "Rollback du patch disponible dans : $BACKUP"
  exit "$RC"
fi

echo "[6/7] Validation santé après mise à jour…"
systemctl is-failed "$GTFS_UNIT" >/dev/null 2>&1 && { systemctl status "$GTFS_UNIT" --no-pager -l; exit 5; } || true
systemctl is-active --quiet lb-rail-v3-france-hot-snapshot-preview.service
python3 - <<'PY'
import json,sqlite3
from pathlib import Path
root=Path('/opt/lb-rail-engine-v1')
dbpath=root/'data/timetable-v3-france-preview.sqlite'
h=root/'state/moorail-global-hs-v7-health.json'
db=sqlite3.connect(f'file:{dbpath}?mode=ro',uri=True)
assert db.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
orph=db.execute('''SELECT COUNT(*) FROM trip_geometry g LEFT JOIN trips t ON t.trip_pk=g.trip_pk LEFT JOIN rail_paths p ON p.path_id=g.path_id WHERE t.trip_pk IS NULL OR p.path_id IS NULL''').fetchone()[0]
assert orph==0,orph
for n in ('8602','6702','9713','9203','9206','9264'):
    total=db.execute('SELECT COUNT(*) FROM trips WHERE number=?',(n,)).fetchone()[0]
    globalp=db.execute("""SELECT COUNT(*) FROM trips t JOIN trip_geometry g ON g.trip_pk=t.trip_pk WHERE t.number=? AND g.path_id LIKE 'p-global-hs-v7-%'""",(n,)).fetchone()[0]
    print(f'{n}: global={globalp}/{total}')
    if total: assert globalp==total,(n,globalp,total)
db.close()
health=json.loads(h.read_text(encoding='utf-8'))
print('health:',health.get('status'),'changed=',health.get('changed'),'unresolved=',health.get('unresolved'),'post_update=',health.get('post_update'))
assert health.get('status')=='ok'
assert int(health.get('unresolved') or 0)==0
assert health.get('post_update') is True
PY

echo "[7/7] Désactivation de l'ancien GLOBAL GUARD toutes les minutes, devenu redondant…"
if systemctl list-unit-files "$GLOBAL_GUARD_TIMER" --no-legend 2>/dev/null | grep -q .; then
  systemctl disable --now "$GLOBAL_GUARD_TIMER" || true
fi
systemctl reset-failed "$GTFS_UNIT" || true

echo
echo "===================================================================================================="
echo " OK — CHAINE GTFS + V7.3 VALIDEE"
echo " Ancien candidate guard: structurel, écarts de corridor = warnings"
echo " V7.3 post-update      : obligatoire, erreurs NON ignorées"
echo " Ancien global guard   : timer désactivé"
echo " Backup                : $BACKUP"
echo "===================================================================================================="
