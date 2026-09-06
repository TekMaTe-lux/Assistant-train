#!/usr/bin/env bash
set -euo pipefail

ROOT="${LB_MAP_ROOT:-/opt/labetaillere-map-v2-src}"
BUILDER="$ROOT/map-v2/scripts/build-map-lite-cache.py"
CACHE="$ROOT/map-v2/public/data/carte_static_lite_today.json"
CORE="$ROOT/map-v2/public/carte-core-preview.html"
STAMP="$(date +%Y%m%d-%H%M%S-%N)"
BACKUP="$ROOT/backups/map-cache-permissions-v2-$STAMP"
SUCCESS=0

rollback(){
  if [[ "$SUCCESS" -eq 1 ]]; then return; fi
  echo "ERREUR — restauration automatique..." >&2
  [[ -f "$BACKUP/build-map-lite-cache.py" ]] && cp -a "$BACKUP/build-map-lite-cache.py" "$BUILDER"
  [[ -f "$BACKUP/carte_static_lite_today.json" ]] && cp -a "$BACKUP/carte_static_lite_today.json" "$CACHE"
  echo "Rollback terminé." >&2
}
trap rollback EXIT

[[ ${EUID:-$(id -u)} -eq 0 ]] || { echo "ERREUR: lancer avec sudo/root" >&2; exit 2; }
for f in "$BUILDER" "$CACHE" "$CORE"; do
  [[ -f "$f" ]] || { echo "ERREUR: fichier absent: $f" >&2; exit 3; }
done

# Ne jamais réintroduire le moteur lourd J-1/J/J+1.
grep -q 'LB_SERVICE_DAY_ROLLOVER_V1' "$CORE" || { echo "ERREUR: moteur rapide V1 absent" >&2; exit 4; }
! grep -q 'LB_SERVICE_DAY_ROLLOVER_V2' "$CORE" || { echo "ERREUR: moteur V2 encore présent" >&2; exit 5; }
! grep -q 'LB_SERVICE_DAY_CACHE_WINDOW_V2' "$BUILDER" || { echo "ERREUR: builder lourd V2 encore présent" >&2; exit 6; }

mkdir -p "$BACKUP"
cp -a "$BUILDER" "$BACKUP/build-map-lite-cache.py"
cp -a "$CACHE" "$BACKUP/carte_static_lite_today.json"

printf '%s\n' "=== AVANT ==="
stat -c 'mode=%a owner=%U group=%G size=%s' "$CACHE"

# V1 umask a échoué car le builder recrée probablement le fichier via un
# tempfile/mkstemp en 0600. V2 ne dépend plus du mécanisme de création : un
# handler atexit force 0644 APRES le dernier remplacement/écriture du cache.
python3 - "$BUILDER" <<'PY'
from pathlib import Path
import re, sys
p=Path(sys.argv[1])
s=p.read_text(encoding='utf-8')
marker='LB_MAP_CACHE_PUBLIC_MODE_V2'
if marker in s:
    print('Builder déjà protégé V2.')
    raise SystemExit(0)

# Retirer l'ancienne tentative V1 si elle subsiste.
s=re.sub(
    r'\n[ \t]*# LB_MAP_CACHE_PUBLIC_UMASK_V1\n[ \t]*import os as _lb_map_cache_os\n[ \t]*_lb_map_cache_os\.umask\(0o022\)\n',
    '\n', s, count=1
)

m=re.search(r'(?m)^(?P<indent>[ \t]*)def main\s*\([^)]*\)\s*(?:->[^:]+)?\s*:\s*$', s)
if not m:
    raise SystemExit('ERREUR: def main() introuvable dans le builder')
line_end=s.find('\n', m.end())
if line_end < 0:
    raise SystemExit('ERREUR: corps de main() introuvable')
indent=m.group('indent') + '    '
block=(
    f"\n{indent}# {marker}\n"
    f"{indent}import atexit as _lb_cache_atexit\n"
    f"{indent}from pathlib import Path as _LBPath\n"
    f"{indent}_lb_cache_target = _LBPath(__file__).resolve().parents[1] / 'public' / 'data' / 'carte_static_lite_today.json'\n"
    f"{indent}def _lb_public_cache_mode():\n"
    f"{indent}    try:\n"
    f"{indent}        if _lb_cache_target.exists():\n"
    f"{indent}            _lb_cache_target.chmod(0o644)\n"
    f"{indent}    except Exception as exc:\n"
    f"{indent}        print(f'AVERTISSEMENT chmod cache: {{exc}}')\n"
    f"{indent}_lb_cache_atexit.register(_lb_public_cache_mode)\n"
)
s=s[:line_end+1] + block + s[line_end+1:]
p.write_text(s, encoding='utf-8')
print('Protection chmod 0644 post-écriture injectée dans main().')
PY

python3 -m py_compile "$BUILDER"

# Répare l'état courant, puis reconstruit volontairement sous root : le test
# prouve que même si un tempfile remet 0600 en cours de route, atexit finit 0644.
chmod 0644 "$CACHE"
python3 "$BUILDER"

printf '%s\n' "=== APRES REBUILD ROOT ==="
stat -c 'mode=%a owner=%U group=%G size=%s' "$CACHE"
MODE="$(stat -c '%a' "$CACHE")"
[[ "$MODE" == "644" ]] || { echo "ERREUR: le rebuild a produit le mode $MODE au lieu de 644" >&2; exit 7; }
sudo -u ubuntu test -r "$CACHE" || { echo "ERREUR: ubuntu ne peut toujours pas lire le cache" >&2; exit 8; }

python3 - "$CACHE" <<'PY'
import json, os, sys
p=sys.argv[1]
d=json.load(open(p, encoding='utf-8'))
if d.get('service_days'):
    raise SystemExit('ERREUR: cache lourd service_days réapparu')
print('JSON valide; cache rapide journalier:', os.path.getsize(p), 'octets')
PY

# Vérification du moteur conservé après le rebuild.
grep -q 'LB_SERVICE_DAY_ROLLOVER_V1' "$CORE"
! grep -q 'LB_SERVICE_DAY_ROLLOVER_V2' "$CORE"

SUCCESS=1
trap - EXIT
printf '%s\n' "Lecture ubuntu: OUI"
printf '%s\n' "Moteur V1: conserve"
printf '%s\n' "Moteur V2: absent"
printf '%s\n' "OK — cache force en 0644 APRES chaque rebuild du builder."
printf 'Backup: %s\n' "$BACKUP"
