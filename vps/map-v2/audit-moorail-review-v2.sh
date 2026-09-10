#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="/opt/lb-rail-engine-v1"
MAP="/opt/labetaillere-map-v2-src/map-v2"

TARGETS=(
  "$ROOT/router-test"
  "$ROOT/geometry/build-france-v1"
  "$MAP/public/community-site-test-v1"
  "$MAP/public/community-site-test-v1.bak-20260905-120942-374778042"
  "$MAP/public/data/moorail-router-test-backup-20260908-075944"
  "$MAP/public/data/moorail-router-test-current"
)

printf '%s\n' "===================================================================================================="
printf '%s\n' " LA BETAILLERE — AUDIT REVIEW V2 / LECTURE SEULE"
printf '%s\n' " Vérifie les ~1 Gio restants AVANT toute éventuelle suppression."
printf '%s\n' " AUCUN rm, mv, chmod, chown, systemctl stop/disable ou écriture dans la prod."
printf '%s\n' "===================================================================================================="

printf '\n=== 1. TAILLES / DATES / TYPES ===\n'
for p in "${TARGETS[@]}"; do
  if [[ -e "$p" ]]; then
    du -sh -- "$p" 2>/dev/null || true
    stat -c '  mtime=%y owner=%U:%G type=%F' -- "$p" 2>/dev/null || true
  else
    echo "ABSENT  $p"
  fi
done

printf '\n=== 2. PROCESSUS ACTIFS QUI REFERENCENT LES CIBLES ===\n'
ps -eo pid,ppid,user,etime,args --width 300 | grep -E 'router-test|build-france-v1|community-site-test-v1|moorail-router-test-(current|backup)' | grep -v '[g]rep -E' || echo 'AUCUN'

printf '\n=== 3. SYSTEMD : REFERENCES AUX CIBLES ===\n'
for d in /etc/systemd/system /lib/systemd/system /run/systemd/transient; do
  [[ -d "$d" ]] || continue
  grep -RInE --binary-files=without-match \
    'router-test|build-france-v1|community-site-test-v1|moorail-router-test-(current|backup)' \
    "$d" 2>/dev/null || true
done

printf '\n=== 4. NGINX / APACHE : REFERENCES AUX CIBLES ===\n'
for d in /etc/nginx /etc/apache2; do
  [[ -d "$d" ]] || continue
  grep -RInE --binary-files=without-match \
    'router-test|build-france-v1|community-site-test-v1|moorail-router-test-(current|backup)' \
    "$d" 2>/dev/null || true
done

printf '\n=== 5. CODE PROD / SCRIPTS : REFERENCES EXTERNES AUX CIBLES ===\n'
# On exclut les cibles elles-mêmes pour éviter qu'elles se citent entre elles.
for base in "$ROOT/app" "$ROOT/geometry" "$MAP/scripts" "$MAP/server" "$MAP/public" "$MAP/data"; do
  [[ -d "$base" ]] || continue
  grep -RInE --binary-files=without-match \
    --exclude='*.sqlite' --exclude='*.db' --exclude='*.zip' --exclude='*.gz' --exclude='*.tar' --exclude='*.tgz' \
    --exclude-dir='router-test' \
    --exclude-dir='build-france-v1' \
    --exclude-dir='community-site-test-v1' \
    --exclude-dir='community-site-test-v1.bak-20260905-120942-374778042' \
    --exclude-dir='moorail-router-test-current' \
    --exclude-dir='moorail-router-test-backup-20260908-075944' \
    'router-test|build-france-v1|community-site-test-v1|moorail-router-test-(current|backup)' \
    "$base" 2>/dev/null || true
done

printf '\n=== 6. SYMLINKS POINTANT DANS LES CIBLES ===\n'
find "$ROOT" "$MAP" -xdev -type l -print0 2>/dev/null | while IFS= read -r -d '' l; do
  t="$(readlink -f -- "$l" 2>/dev/null || true)"
  case "$t" in
    "$ROOT/router-test"/*|"$ROOT/geometry/build-france-v1"/*|"$MAP/public/community-site-test-v1"/*|"$MAP/public/community-site-test-v1.bak-20260905-120942-374778042"/*|"$MAP/public/data/moorail-router-test-backup-20260908-075944"/*|"$MAP/public/data/moorail-router-test-current"/*)
      printf '%s -> %s\n' "$l" "$t" ;;
  esac
done

printf '\n=== 7. CONTENU PRINCIPAL DE CHAQUE CIBLE ===\n'
for p in "${TARGETS[@]}"; do
  [[ -e "$p" ]] || continue
  echo
  echo "--- $p ---"
  if [[ -d "$p" ]]; then
    find "$p" -maxdepth 2 -mindepth 1 -printf '%y %10s %TY-%Tm-%Td %TH:%TM %p\n' 2>/dev/null | sort -k2 -nr | head -40 || true
  else
    ls -lh -- "$p" || true
  fi
done

printf '\n=== 8. PLUS GROS FICHIERS DANS LE LOT REVIEW ===\n'
for p in "${TARGETS[@]}"; do
  [[ -d "$p" ]] || continue
  find "$p" -type f -printf '%s\t%TY-%Tm-%Td %TH:%TM\t%p\n' 2>/dev/null
done | sort -nr | head -80 | awk -F '\t' '{printf "%.1f MiB\t%s\t%s\n", $1/1048576, $2, $3}'

printf '\n=== 9. TOTAL REVIEW ACTUEL ===\n'
python3 - <<'PY'
from pathlib import Path
import subprocess
paths=[
Path('/opt/lb-rail-engine-v1/router-test'),
Path('/opt/lb-rail-engine-v1/geometry/build-france-v1'),
Path('/opt/labetaillere-map-v2-src/map-v2/public/community-site-test-v1'),
Path('/opt/labetaillere-map-v2-src/map-v2/public/community-site-test-v1.bak-20260905-120942-374778042'),
Path('/opt/labetaillere-map-v2-src/map-v2/public/data/moorail-router-test-backup-20260908-075944'),
Path('/opt/labetaillere-map-v2-src/map-v2/public/data/moorail-router-test-current'),
]
total=0
for p in paths:
    if not p.exists(): continue
    try:
        total += int(subprocess.check_output(['du','-sb','--',str(p)],text=True).split()[0])
    except Exception: pass
print(f'TOTAL: {total/1024/1024:.1f} MiB = {total/1024/1024/1024:.3f} GiB')
PY

printf '\n=== 10. ETAT PROD APRES AUDIT (LECTURE SEULE) ===\n'
systemctl is-active lb-rail-v3-france-hot-snapshot-preview.service 2>/dev/null || true
systemctl is-active labetaillere-map-v2.service 2>/dev/null || true
python3 - <<'PY'
import json,sqlite3
from pathlib import Path
root=Path('/opt/lb-rail-engine-v1')
db=root/'data/timetable-v3-france-preview.sqlite'
h=root/'state/moorail-global-hs-v7-health.json'
if db.exists():
    c=sqlite3.connect(f'file:{db}?mode=ro',uri=True)
    print('DB integrity:',c.execute('PRAGMA integrity_check').fetchone()[0])
    c.close()
if h.exists():
    o=json.loads(h.read_text())
    print('V7 health:',o.get('status'),'changed=',o.get('changed'),'unresolved=',o.get('unresolved'),'post_update=',o.get('post_update'))
PY

echo
printf '%s\n' "===================================================================================================="
printf '%s\n' " FIN AUDIT REVIEW V2 — AUCUNE SUPPRESSION EFFECTUEE"
printf '%s\n' "===================================================================================================="
