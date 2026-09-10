#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="/opt/lb-rail-engine-v1"
APP="$ROOT/app"
STATE="$ROOT/state"
GUARD="$APP/moorail_lgv_candidate_guard_v1.py"
GTFS_UNIT="lb-rail-v3-gtfs-update.service"
GLOBAL_GUARD_TIMER="lb-rail-lgv-global-guard.timer"
DROPIN_DIR="/etc/systemd/system/lb-rail-v3-gtfs-update.service.d"
DROPIN="$DROPIN_DIR/95-global-hs-v7.conf"
ENGINE="$APP/moorail_global_hs_v7.py"
LOCK="$STATE/moorail-global-hs-v7.lock"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$ROOT/data/backups/gtfs-guard-v73-permissions-$STAMP"

[[ ${EUID:-$(id -u)} -eq 0 ]] || { echo "ERREUR: lancer avec sudo/root" >&2; exit 2; }
[[ -f "$GUARD" ]] || { echo "ERREUR: guard absent: $GUARD" >&2; exit 2; }
[[ -f "$ENGINE" ]] || { echo "ERREUR: moteur global HGV absent: $ENGINE" >&2; exit 2; }
grep -qF 'MOORAIL_GLOBAL_HS_V7_3_TRANSIENT_SNAPSHOT' "$ENGINE" || {
  echo "ERREUR: le moteur installé n'est pas la V7.3 attendue" >&2
  exit 3
}

mkdir -p "$BACKUP" "$DROPIN_DIR" "$STATE"
cp -a "$GUARD" "$BACKUP/moorail_lgv_candidate_guard_v1.py.before"
[[ -f "$DROPIN" ]] && cp -a "$DROPIN" "$BACKUP/95-global-hs-v7.conf.before"
systemctl cat "$GTFS_UNIT" > "$BACKUP/lb-rail-v3-gtfs-update.service.txt" 2>/dev/null || true
[[ -e "$LOCK" ]] && stat "$LOCK" > "$BACKUP/moorail-global-hs-v7.lock.stat.txt" 2>/dev/null || true

echo "===================================================================================================="
echo " MOO RAIL — GTFS GUARD COMPAT V7.3.1 / PRIVILEGES POST-UPDATE"
echo " ExecStart reste ubuntu. Seule la post-réparation V7.3 est élevée en root avec le préfixe systemd '+'."
echo " Si le dernier GTFS a déjà réussi, on NE REFAIT PAS les 13 minutes de rebuild : on répare la DB publiée."
echo "===================================================================================================="

echo "[1/8] Legacy candidate guard : structurel oui, comparaison des corridors = warning…"
python3 - "$GUARD" <<'PY'
from pathlib import Path
import sys

p=Path(sys.argv[1])
s=p.read_text(encoding='utf-8')
marker='GLOBAL_HS_V73_POST_REPAIR_COMPAT = True'
if marker in s:
    print('Patch guard déjà présent : OK')
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
print('PATCH GUARD OK:',p)
PY
python3 -m py_compile "$GUARD"
grep -qF 'GLOBAL_HS_V73_POST_REPAIR_COMPAT = True' "$GUARD"

echo "[2/8] Correction réelle de la cause : ExecStartPost V7.3 exécuté en ROOT…"
cat > "$DROPIN" <<EOF
[Service]
# MooRail GLOBAL HIGH-SPEED V7.3.1
# Le rebuild GTFS principal reste sous User=ubuntu.
# '+' demande à systemd d'exécuter uniquement ce post-traitement avec les privilèges système,
# nécessaires au lock historique root et au stop/recreate du snapshot France transient.
ExecStartPost=
ExecStartPost=+/usr/bin/python3 $ENGINE --apply --post-update
EOF
systemctl daemon-reload

# Ne surtout pas faire un chown global de /opt : le modèle de privilèges reste explicite.
echo "Service principal :"
systemctl show "$GTFS_UNIT" -p User -p Group -p ExecStart -p ExecStartPost --no-pager
echo "Lock actuel :"
ls -l "$LOCK" 2>/dev/null || echo "  absent (sera créé par V7.3)"

grep -qF "ExecStartPost=+/usr/bin/python3 $ENGINE --apply --post-update" "$DROPIN" || {
  echo "ERREUR: drop-in root V7.3 non écrit" >&2
  exit 4
}

echo "[3/8] Contrôles préalables…"
python3 -m py_compile "$ENGINE" "$GUARD"
systemctl is-active --quiet lb-rail-v3-france-hot-snapshot-preview.service || {
  echo "ERREUR: snapshot France inactif avant réparation" >&2
  exit 4
}
if systemctl is-active --quiet "$GTFS_UNIT"; then
  echo "ERREUR: une mise à jour GTFS tourne déjà; je refuse d'en lancer une seconde." >&2
  exit 4
fi

MAIN_STATUS="$(systemctl show "$GTFS_UNIT" -p ExecMainStatus --value 2>/dev/null || echo 255)"
RESULT="$(systemctl show "$GTFS_UNIT" -p Result --value 2>/dev/null || true)"
echo "Dernier ExecStart GTFS : status=${MAIN_STATUS:-?} ; Result=${RESULT:-?}"

RECOVERY=0
if [[ "$MAIN_STATUS" == "0" && "$RESULT" != "success" ]]; then
  RECOVERY=1
fi

if [[ "$RECOVERY" -eq 1 ]]; then
  echo "[4/8] RECOVERY RAPIDE : le rebuild GTFS a déjà fini status=0."
  echo "      Son ExecStartPost seul a échoué : réparation V7.3 directe de la DB déjà publiée."
  echo "      PAS de second téléchargement/rebuild GTFS de 13 minutes."
else
  echo "[4/8] Aucun rebuild GTFS réussi à récupérer : test complet nécessaire."
fi

systemctl reset-failed "$GTFS_UNIT" || true

if [[ "$RECOVERY" -eq 1 ]]; then
  echo "[5/8] Post-réparation V7.3 immédiate sous root…"
  set +e
  /usr/bin/python3 -u "$ENGINE" --apply --post-update
  RC=$?
  set -e
else
  echo "[5/8] TEST REEL complet GTFS + ExecStartPost V7.3 root…"
  echo "      Cela peut prendre plusieurs minutes. Ne pas interrompre."
  set +e
  systemctl start "$GTFS_UNIT"
  RC=$?
  set -e
fi

if [[ $RC -ne 0 ]]; then
  echo
  echo "ECHEC V7.3.1 : rc=$RC"
  systemctl status "$GTFS_UNIT" --no-pager -l | tail -80 || true
  echo
  echo "Dernières lignes V7.3 :"
  journalctl -u "$GTFS_UNIT" -n 100 --no-pager -l 2>/dev/null || true
  echo
  echo "Backup du patch : $BACKUP"
  exit "$RC"
fi

echo "[6/8] Validation DB + témoins + health V7.3…"
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
systemctl is-active --quiet lb-rail-v3-france-hot-snapshot-preview.service

echo "[7/8] Validation configuration future + retrait de l'ancien guard toutes les minutes…"
systemd-analyze verify /etc/systemd/system/lb-rail-v3-gtfs-update.service >/dev/null
if systemctl list-unit-files "$GLOBAL_GUARD_TIMER" --no-legend 2>/dev/null | grep -q .; then
  systemctl disable --now "$GLOBAL_GUARD_TIMER" || true
fi
systemctl reset-failed "$GTFS_UNIT" || true

# Si on était en recovery, le service n'a pas été relancé lui-même; son ancien failure est maintenant effacé.
# Le prochain timer utilisera le '+' root pour V7.3.
echo "[8/8] Etat final…"
systemctl show "$GTFS_UNIT" -p Result -p ExecMainStatus -p ExecStartPost --no-pager
systemctl status lb-rail-v3-france-hot-snapshot-preview.service --no-pager -l | sed -n '1,12p' || true
cat "$ROOT/state/moorail-global-hs-v7-health.json" 2>/dev/null || true

echo
echo "===================================================================================================="
echo " OK — CHAINE GTFS + V7.3.1 SECURISEE"
if [[ "$RECOVERY" -eq 1 ]]; then
  echo " GTFS principal        : déjà réussi, NON recalculé une seconde fois"
  echo " DB courante           : réparée immédiatement par V7.3 sous root"
else
  echo " GTFS principal        : test complet réussi"
fi
echo " ExecStart             : reste sous User=ubuntu"
echo " ExecStartPost V7.3    : ROOT via préfixe systemd '+'"
echo " Legacy candidate guard: structurel, écarts de corridor = warnings"
echo " Ancien global guard   : timer désactivé"
echo " Backup                : $BACKUP"
echo "===================================================================================================="
