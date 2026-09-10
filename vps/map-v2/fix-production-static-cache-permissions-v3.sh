#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="${LB_MAP_ROOT:-/opt/labetaillere-map-v2-src}"
MAP="$ROOT/map-v2"
CACHE="$MAP/public/data/carte_static_lite_today.json"
BUILDER="$MAP/scripts/build-map-lite-cache.py"
STAMP="$(date +%Y%m%d-%H%M%S-%N)"
BACKUP="$MAP/backups/static-cache-permissions-v3-$STAMP"

[[ ${EUID:-$(id -u)} -eq 0 ]] || { echo "ERREUR: lancer avec sudo/root" >&2; exit 2; }
[[ -f "$CACHE" ]] || { echo "ERREUR: cache absent: $CACHE" >&2; exit 3; }
[[ -f "$BUILDER" ]] || { echo "ERREUR: builder absent: $BUILDER" >&2; exit 4; }

mkdir -p "$BACKUP"
cp -a "$CACHE" "$BACKUP/carte_static_lite_today.json"
cp -a "$BUILDER" "$BACKUP/build-map-lite-cache.py"

mode_before="$(stat -c '%a' "$CACHE")"
owner_before="$(stat -c '%U:%G' "$CACHE")"
size_before="$(stat -c '%s' "$CACHE")"

probe(){
  local label="$1" url="$2"
  printf '%-28s ' "$label"
  curl -sS --max-time 10 -o /dev/null -w 'HTTP=%{http_code} TTFB=%{time_starttransfer}s TOTAL=%{time_total}s BYTES=%{size_download}\n' "$url" || true
}

echo "============================================================"
echo " LA BETAILLERE — DIAGNOSTIC CACHE LITE"
echo "============================================================"
echo "Cache : $CACHE"
echo "Avant : mode=$mode_before owner=$owner_before size=$size_before"
printf 'Lecture utilisateur ubuntu : '
if sudo -u ubuntu test -r "$CACHE"; then echo OUI; else echo NON; fi
probe "Upstream cache AVANT" "http://127.0.0.1:3111/data/carte_static_lite_today.json?v=$STAMP"

echo
if [[ "$mode_before" != "644" ]] || ! sudo -u ubuntu test -r "$CACHE"; then
  echo "CAUSE CONFIRMEE : le cache lite n'est pas publiquement lisible."
  chmod 0644 "$CACHE"
else
  echo "Cache courant déjà lisible; on conserve son contenu et on sécurise les prochains rebuilds."
fi

# Réinstaller la protection permanente perdue quand un ancien builder a été restauré.
python3 - "$BUILDER" <<'PY'
from pathlib import Path
import re, sys
p=Path(sys.argv[1])
s=p.read_text(encoding='utf-8')
marker='LB_MAP_CACHE_PUBLIC_MODE_V3'
if marker in s:
    print('Protection builder V3 déjà présente.')
    raise SystemExit(0)

m=re.search(r'(?m)^(?P<indent>[ \t]*)def main\s*\([^)]*\)\s*(?:->[^:]+)?\s*:\s*$', s)
if not m:
    raise SystemExit('ERREUR: def main() introuvable; cache réparé mais builder non modifié')
line_end=s.find('\n',m.end())
if line_end<0:
    raise SystemExit('ERREUR: corps main() introuvable')
indent=m.group('indent')+'    '
block=(
    f"\n{indent}# {marker}\n"
    f"{indent}import atexit as _lb_cache_atexit\n"
    f"{indent}from pathlib import Path as _LBPath\n"
    f"{indent}_lb_cache_target = _LBPath(__file__).resolve().parents[1] / 'public' / 'data' / 'carte_static_lite_today.json'\n"
    f"{indent}def _lb_public_cache_mode_v3():\n"
    f"{indent}    try:\n"
    f"{indent}        if _lb_cache_target.exists():\n"
    f"{indent}            _lb_cache_target.chmod(0o644)\n"
    f"{indent}    except Exception as exc:\n"
    f"{indent}        print(f'AVERTISSEMENT chmod cache: {{exc}}')\n"
    f"{indent}_lb_cache_atexit.register(_lb_public_cache_mode_v3)\n"
)
s=s[:line_end+1]+block+s[line_end+1:]
p.write_text(s,encoding='utf-8')
print('Protection permanente 0644 réinjectée dans le builder.')
PY

python3 -m py_compile "$BUILDER"

mode_after="$(stat -c '%a' "$CACHE")"
printf '\nAprès : mode=%s owner=%s size=%s\n' "$mode_after" "$(stat -c '%U:%G' "$CACHE")" "$(stat -c '%s' "$CACHE")"
printf 'Lecture utilisateur ubuntu : '
sudo -u ubuntu test -r "$CACHE" && echo OUI || { echo NON; exit 5; }
[[ "$mode_after" == "644" ]] || { echo "ERREUR: mode final $mode_after au lieu de 644" >&2; exit 6; }

probe "Upstream cache APRES" "http://127.0.0.1:3111/data/carte_static_lite_today.json?v=$STAMP"

python3 - "$CACHE" <<'PY'
import json,sys
p=json.load(open(sys.argv[1],encoding='utf-8'))
data=p.get('data') or p
print('JSON cache : OK')
print('date       :',p.get('date'))
print('trains     :',len(data.get('tripsById') or [] if isinstance(data.get('tripsById'),list) else data.get('tripsById') or {}))
print('services   :',len(data.get('activeServiceIds') or []))
PY

echo
echo "============================================================"
echo " OK — CACHE LITE DE NOUVEAU LISIBLE IMMEDIATEMENT"
echo "============================================================"
echo "Cache contenu             : INCHANGE"
echo "Permissions               : 0644"
echo "Protection prochains builds: OUI"
echo "Core / UI                 : NON TOUCHES"
echo "Réseau cyan               : NON TOUCHE"
echo "TGV / aliases             : NON TOUCHES"
echo "Rollover                  : NON TOUCHE"
echo "France V3                 : NON TOUCHEE"
echo "Rebuild cache             : NON"
echo "Restart service           : NON"
echo "Backup                    : $BACKUP"
echo "============================================================"
