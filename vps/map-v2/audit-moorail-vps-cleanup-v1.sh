#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="/opt/lb-rail-engine-v1"
MAPROOT="/opt/labetaillere-map-v2-src/map-v2"

hr(){ printf '%*s\n' 100 '' | tr ' ' '='; }
section(){ echo; hr; echo "$1"; hr; }
size_path(){ [[ -e "$1" ]] && du -sh "$1" 2>/dev/null || true; }

hr
echo " MOO RAIL — AUDIT NETTOYAGE VPS V1 (LECTURE SEULE)"
echo " AUCUN FICHIER N'EST SUPPRIME"
hr

echo "Date : $(date -Is)"
echo "Host : $(hostname)"
echo
printf 'Disque racine :\n'; df -h /
printf '\nMémoire :\n'; free -h || true

section "1 — EMPRISE DES DEUX ARBRES PRINCIPAUX"
size_path "$ROOT"
size_path "$MAPROOT"

section "2 — TOP 60 DES PLUS GROS ELEMENTS /opt/lb-rail-engine-v1"
if [[ -d "$ROOT" ]]; then
  du -xah "$ROOT" 2>/dev/null | sort -h | tail -60
fi

section "3 — TOP 60 DES PLUS GROS ELEMENTS map-v2"
if [[ -d "$MAPROOT" ]]; then
  du -xah "$MAPROOT" 2>/dev/null | sort -h | tail -60
fi

section "4 — BASES SQLITE ACTIVES ET COPIES"
find "$ROOT" "$MAPROOT" -xdev -type f \
  \( -name '*.sqlite' -o -name '*.sqlite3' -o -name '*.db' -o -name '*.sqlite-*' \) \
  -printf '%s\t%TY-%Tm-%Td %TH:%TM\t%p\n' 2>/dev/null \
  | sort -nr | awk 'BEGIN{OFS="\t"}{mb=$1/1024/1024; printf "%.1f MiB\t%s %s\t%s\n",mb,$2,$3,$4}'

section "5 — CANDIDATS / TMP MOO RAIL"
for d in "$ROOT/tmp" /tmp; do
  [[ -d "$d" ]] || continue
  find "$d" -maxdepth 2 -type d \
    \( -iname '*moorail*' -o -iname '*global-hs*' -o -iname '*lgv*' -o -iname '*rfn*' \) \
    -print0 2>/dev/null \
    | while IFS= read -r -d '' p; do du -sh "$p" 2>/dev/null || true; done

done | sort -h

section "6 — BACKUPS MOO RAIL / MAP-V2"
for d in "$ROOT/data/backups" "$MAPROOT/backups"; do
  echo "--- $d ---"
  if [[ -d "$d" ]]; then
    find "$d" -mindepth 1 -maxdepth 1 -printf '%T@\t%TY-%Tm-%Td %TH:%TM\t%p\n' 2>/dev/null \
      | sort -nr | cut -f2- \
      | while IFS=$'\t' read -r stamp p; do
          s="$(du -sh "$p" 2>/dev/null | awk '{print $1}')"
          printf '%-10s  %s  %s\n' "${s:-?}" "$stamp" "$p"
        done
  fi
  echo
done

section "7 — SCRIPTS / ROUTEURS / INSTALLERS HISTORIQUES"
find "$ROOT/app" "$ROOT/geometry" "$MAPROOT/scripts" /home/ubuntu \
  -maxdepth 2 -type f 2>/dev/null \
  \( -iname '*moorail*' -o -iname '*lgv*' -o -iname '*rfn*' -o -iname '*rail*v[0-9]*' -o -iname '*route*editor*' \) \
  -printf '%TY-%Tm-%Td %TH:%TM\t%s\t%p\n' \
  | sort -r | head -250 | awk 'BEGIN{OFS="\t"}{kb=$3/1024; printf "%s %s\t%.1f KiB\t%s\n",$1,$2,kb,$4}'

section "8 — ARCHIVES / ZIP / TAR / GZ POTENTIELLEMENT DUPLIQUES"
find "$ROOT" "$MAPROOT" /home/ubuntu \
  -xdev -type f 2>/dev/null \
  \( -iname '*.zip' -o -iname '*.tar' -o -iname '*.tar.gz' -o -iname '*.tgz' -o -iname '*.gz' \) \
  -printf '%s\t%TY-%Tm-%Td %TH:%TM\t%p\n' \
  | sort -nr | head -200 \
  | awk 'BEGIN{OFS="\t"}{mb=$1/1024/1024; printf "%.1f MiB\t%s %s\t%s\n",mb,$2,$3,$4}'

section "9 — SERVICES / TIMERS MOO RAIL ET SNAPSHOTS"
systemctl list-units --all --no-pager 2>/dev/null \
  | grep -Ei 'lb-rail|moorail|snapshot|map-v2' || true

echo
echo "--- fichiers systemd correspondants ---"
find /etc/systemd/system /run/systemd/transient -maxdepth 3 -type f 2>/dev/null \
  | grep -Ei 'lb-rail|moorail|snapshot|map-v2' \
  | sort || true

echo
echo "--- drop-ins GTFS ---"
find /etc/systemd/system/lb-rail-v3-gtfs-update.service.d -maxdepth 1 -type f -print -exec sed -n '1,120p' {} \; 2>/dev/null || true

section "10 — FICHIERS QUI DOIVENT ETRE CONSERVES"
for p in \
  "$ROOT/data/timetable-v3-france-preview.sqlite" \
  "$ROOT/app/moorail_global_hs_v7.py" \
  "$ROOT/app/moorail_router_global_v7.py" \
  "$ROOT/app/hot_snapshot_v3_france_preview.py" \
  "$ROOT/app/gtfs_auto_update_v3.py" \
  "$MAPROOT/public/data/france-v3-active-now.json" \
  "$MAPROOT/public/data/moorail-live-v1/sections.json" \
  "$MAPROOT/public/data/moorail-code-v1/sections.json" \
  "$MAPROOT/public/france-v3-preview.html"; do
  if [[ -e "$p" ]]; then
    printf 'KEEP  '; du -sh "$p" 2>/dev/null || ls -lh "$p"
  else
    printf 'MISS  %s\n' "$p"
  fi
done

section "11 — SAUVEGARDES GLOBAL-HS RECENTES A CONSERVER POUR L'INSTANT"
find "$ROOT/data/backups" -mindepth 1 -maxdepth 1 -type d -name 'global-hs-v7*' \
  -printf '%T@\t%p\n' 2>/dev/null | sort -nr | head -5 | cut -f2- \
  | while IFS= read -r p; do printf 'KEEP-ROLLBACK  '; du -sh "$p" 2>/dev/null || true; done

section "12 — ESTIMATION BRUTE DES ZONES DE NETTOYAGE (AUCUNE SUPPRESSION)"
python3 - <<'PY'
from pathlib import Path
import os

roots=[
    Path('/opt/lb-rail-engine-v1/tmp'),
    Path('/opt/lb-rail-engine-v1/data/backups'),
    Path('/opt/labetaillere-map-v2-src/map-v2/backups'),
]

def size(p):
    total=0
    try:
        if p.is_file(): return p.stat().st_size
        for root,dirs,files in os.walk(p):
            for f in files:
                try: total += (Path(root)/f).stat().st_size
                except OSError: pass
    except OSError: pass
    return total

def human(n):
    for u in ('B','KiB','MiB','GiB','TiB'):
        if n<1024 or u=='TiB': return f'{n:.1f} {u}'
        n/=1024

for r in roots:
    print(f'{human(size(r)):>12}  {r}')
PY

section "FIN AUDIT"
echo "Aucune suppression effectuée."
echo "Copie toute cette sortie dans ChatGPT : elle servira à fabriquer le plan de purge exact et le dry-run."
